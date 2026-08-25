//! Sheet XML parsing mirroring `engine.ts#parseSheet` and the rule parsers in
//! `worksheet-features.ts`.

use std::collections::BTreeMap;

use crate::coordinates::{cell_address, parse_range_address};
use crate::model::{
    CellStyle, ConditionalFormat, DataValidation, Hyperlink, Range, Scalar, ValidationSource,
};
use crate::styles::StyleStore;
use crate::xmlutil::{attributes, decode_xml, element_text};

/// An axis with its default size plus hidden and sized entries.
#[derive(Default)]
pub struct AxisData {
    pub default_size: f64,
    pub hidden: Vec<u32>,
    pub sizes: Vec<(u32, f64)>,
}

pub struct RawCell {
    pub address: String,
    pub column: u32,
    pub display_value: String,
    pub formula: Option<String>,
    pub formula_result: Option<Scalar>,
    pub hyperlink: Option<Hyperlink>,
    pub row: u32,
    pub style: CellStyle,
    pub value: Scalar,
}

pub struct ParsedSheet {
    pub cells: BTreeMap<(u32, u32), RawCell>,
    pub columns: AxisData,
    pub conditional_formats: Vec<ConditionalFormat>,
    pub data_validations: Vec<DataValidation>,
    /// Occurrences of `<conditionalFormatting` in the raw sheet XML.
    pub raw_conditional_formatting_tags: u64,
    /// Occurrences of `<dataValidation` in the raw sheet XML.
    pub raw_data_validation_tags: u64,
    pub frozen_columns: f64,
    pub frozen_rows: f64,
    pub merges: Vec<Range>,
    pub rows: AxisData,
    pub show_grid_lines: bool,
}

fn attribute_number(attrs: &BTreeMap<String, String>, key: &str) -> Option<f64> {
    attrs.get(key).and_then(|value| crate::jsnumber::parse(value))
}

/// Parse one worksheet part into cells and metadata.
///
/// Returns an error message string when a coordinate reference is invalid;
/// the engine treated those as fatal open failures.
pub fn parse_sheet(input: ParsedSheetInput) -> Result<ParsedSheet, String> {
    let ParsedSheetInput { date_system_1904, shared_strings, styles, xml, remaining_cells } = input;

    let format_attrs = first_tag_attributes(xml, "sheetFormatPr");
    let view_attrs = first_tag_attributes(xml, "sheetView");
    let pane_attrs = first_tag_attributes(xml, "pane");

    let mut rows = AxisData {
        default_size: attribute_number(&format_attrs, "defaultRowHeight")
            .filter(|value| *value != 0.0)
            .unwrap_or(15.0),
        hidden: Vec::new(),
        sizes: Vec::new(),
    };
    let mut columns = AxisData {
        default_size: attribute_number(&format_attrs, "defaultColWidth")
            .filter(|value| *value != 0.0)
            .unwrap_or(8.43),
        hidden: Vec::new(),
        sizes: Vec::new(),
    };
    // Note: `Number(...) || fallback` treats NaN and every zero value alike.
    let mut cursor = 0usize;
    while let Some((_, attrs_source, inner_start, _)) =
        crate::xmlutil::find_open_tag(xml, "col", cursor)
    {
        let attrs = attributes(&attrs_source);
        let minimum = attribute_number(&attrs, "min").filter(|v| *v != 0.0).unwrap_or(1.0);
        let maximum = attribute_number(&attrs, "max").filter(|v| *v != 0.0).unwrap_or(minimum);
        let minimum = minimum.max(1.0);
        let maximum = maximum.min(16_384.0);
        if maximum >= minimum && maximum.fract() == 0.0 && minimum.fract() == 0.0 {
            let width = attribute_number(&attrs, "width");
            for index in minimum as u32..=maximum as u32 {
                if attrs.get("hidden").map(String::as_str) == Some("1") {
                    columns.hidden.push(index);
                }
                if width.is_some_and(|width| width >= 0.0) {
                    columns.sizes.push((index, width.unwrap()));
                }
            }
        }
        cursor = inner_start.max(cursor + 1);
    }

    let mut cells: BTreeMap<(u32, u32), RawCell> = BTreeMap::new();
    let mut cursor = 0usize;
    while let Some((row_start, row_attrs_source, row_inner_start, row_self_closing)) =
        crate::xmlutil::find_open_tag(xml, "row", cursor)
    {
        if !row_self_closing {
            // The engine's row expression requires a paired close.
            if let Some(row_body_end) = crate::xmlutil::find_close_tag(xml, "row", row_inner_start)
            {
                let row_attrs = attributes(&row_attrs_source);
                let row_number = attribute_number(&row_attrs, "r");
                let valid_row = row_number.is_some_and(|value| value.fract() == 0.0 && value > 0.0);
                if valid_row {
                    let row_number = row_number.unwrap() as u32;
                    if row_attrs.get("hidden").map(String::as_str) == Some("1") {
                        rows.hidden.push(row_number);
                    }
                    let height = attribute_number(&row_attrs, "ht");
                    if height.is_some_and(|height| height >= 0.0) {
                        rows.sizes.push((row_number, height.unwrap()));
                    }
                }
                let row_body = &xml[row_inner_start..row_body_end - 6];
                parse_row_cells(
                    row_body,
                    date_system_1904,
                    shared_strings,
                    styles,
                    &mut cells,
                    remaining_cells,
                )?;
            }
        }
        cursor = row_inner_start.max(row_start + 1);
    }

    let mut merges = Vec::new();
    let mut cursor = 0usize;
    while let Some((_, attrs_source, inner_start, _)) =
        crate::xmlutil::find_open_tag(xml, "mergeCell", cursor)
    {
        let attrs = attributes(&attrs_source);
        if let Some(reference) = attrs.get("ref").filter(|value| !value.is_empty()) {
            merges.push(parse_range_address(reference)?);
        }
        cursor = inner_start.max(cursor + 1);
    }

    let conditional_formats = parse_conditional_formats(xml, styles)?;
    let data_validations = parse_data_validations(xml);

    Ok(ParsedSheet {
        raw_conditional_formatting_tags: count_tag_occurrences(xml, "conditionalFormatting"),
        raw_data_validation_tags: count_tag_occurrences(xml, "dataValidation"),
        cells,
        columns,
        conditional_formats,
        data_validations,
        frozen_columns: attribute_number(&pane_attrs, "xSplit")
            .filter(|value| *value > 0.0)
            .unwrap_or(0.0),
        frozen_rows: attribute_number(&pane_attrs, "ySplit")
            .filter(|value| *value > 0.0)
            .unwrap_or(0.0),
        merges,
        rows,
        show_grid_lines: view_attrs.get("showGridLines").map(String::as_str) != Some("0"),
    })
}

pub struct ParsedSheetInput<'a> {
    pub date_system_1904: bool,
    pub shared_strings: &'a [String],
    pub styles: &'a StyleStore,
    pub xml: &'a str,
    /// Shared open budget across all sheets; decremented per parsed cell.
    pub remaining_cells: &'a mut i64,
}

/// The engine threw once the shared cell budget went negative.
fn consume_cell_budget(remaining: &mut i64) -> Result<(), String> {
    *remaining -= 1;
    if *remaining < 0 {
        return Err("Workbook exceeds the spreadsheet cell limit.".to_string());
    }
    Ok(())
}

fn first_tag_attributes(xml: &str, tag: &str) -> BTreeMap<String, String> {
    match crate::xmlutil::find_open_tag(xml, tag, 0) {
        Some((_, attrs, _, _)) => attributes(&attrs),
        None => BTreeMap::new(),
    }
}

pub fn count_tag_occurrences(xml: &str, tag: &str) -> u64 {
    let lower = xml.to_ascii_lowercase();
    let needle = format!("<{tag}");
    let mut count = 0u64;
    let mut position = 0usize;
    while let Some(found) = lower[position..].find(&needle) {
        let start = position + found;
        let after = lower.as_bytes().get(start + needle.len());
        if after.is_none_or(|byte| !(byte.is_ascii_alphanumeric() || *byte == b'_')) {
            count += 1;
        }
        position = start + 1;
    }
    count
}

#[allow(clippy::too_many_arguments)]
fn parse_row_cells(
    row_body: &str,
    date_system_1904: bool,
    shared_strings: &[String],
    styles: &StyleStore,
    cells: &mut BTreeMap<(u32, u32), RawCell>,
    remaining_cells: &mut i64,
) -> Result<(), String> {
    let mut cursor = 0usize;
    while let Some((start, attrs_source, inner_start, self_closing)) =
        crate::xmlutil::find_open_tag(row_body, "c", cursor)
    {
        let end = if self_closing {
            inner_start
        } else {
            crate::xmlutil::find_close_tag(row_body, "c", inner_start)
                .ok_or_else(|| "Workbook XML part is malformed.".to_string())?
        };
        consume_cell_budget(remaining_cells)?;
        let body = if self_closing { "" } else { &row_body[inner_start..end - 4] };
        let attrs = attributes(&attrs_source);
        let Some(reference) = attrs.get("r").filter(|value| !value.is_empty()) else {
            cursor = end.max(start + 1);
            continue;
        };
        let (row, column) = crate::coordinates::parse_cell_address(reference)?;
        let formula = element_text(body, "f").filter(|text| !text.is_empty());
        let inline = if attrs.get("t").map(String::as_str) == Some("inlineStr") {
            element_text(body, "t")
        } else {
            None
        };
        let scalar = match inline {
            Some(inline) => Scalar::Text(inline),
            None => parse_scalar(
                element_text(body, "v"),
                attrs.get("t").map(String::as_str),
                shared_strings,
            ),
        };
        let style_id = attribute_number(&attrs, "s")
            .filter(|value| *value != 0.0)
            .map(|value| value as u32)
            .unwrap_or(0);
        let style = styles.resolve(style_id);
        let display_value = crate::display::cell_display_value(
            formula.as_deref(),
            if formula.is_some() { Some(&scalar) } else { None },
            &scalar,
            &style,
            date_system_1904,
        );
        cells.insert(
            (row, column),
            RawCell {
                address: cell_address(row, column)?,
                column,
                display_value,
                formula: formula.clone(),
                formula_result: formula.as_ref().map(|_| scalar.clone()),
                hyperlink: None,
                row,
                style,
                value: if formula.is_some() { Scalar::Null } else { scalar },
            },
        );
        cursor = end.max(start + 1);
    }
    Ok(())
}

fn parse_scalar(raw: Option<String>, cell_type: Option<&str>, shared: &[String]) -> Scalar {
    use crate::jsnumber;
    let Some(raw) = raw else {
        return Scalar::Null;
    };
    match cell_type {
        Some("s") => {
            let index = jsnumber::parse(&raw).unwrap_or(f64::NAN);
            if index.fract() == 0.0 && index >= 0.0 {
                shared
                    .get(index as usize)
                    .cloned()
                    .map(Scalar::Text)
                    .unwrap_or(Scalar::Text(String::new()))
            } else {
                Scalar::Text(String::new())
            }
        }
        Some("b") => Scalar::Bool(raw == "1"),
        Some("str") | Some("inlineStr") | Some("e") => Scalar::Text(decode_xml(&raw)),
        _ => match jsnumber::parse(&raw) {
            Some(number) if number.is_finite() => Scalar::Number(number),
            _ => Scalar::Text(decode_xml(&raw)),
        },
    }
}

fn formula_scalar(value: Option<String>) -> Scalar {
    let Some(value) = value else {
        return Scalar::Null;
    };
    let decoded = decode_xml(&value);
    if decoded.eq_ignore_ascii_case("true") || decoded.eq_ignore_ascii_case("false") {
        return Scalar::Bool(decoded.eq_ignore_ascii_case("true"));
    }
    match crate::jsnumber::parse(&decoded) {
        Some(number) if number.is_finite() => Scalar::Number(number),
        _ => Scalar::Text(decoded),
    }
}

pub fn parse_conditional_formats(
    xml: &str,
    styles: &StyleStore,
) -> Result<Vec<ConditionalFormat>, String> {
    let mut rules: Vec<ConditionalFormat> = Vec::new();
    let mut cursor = 0usize;
    while let Some((_, block_attrs, block_inner, _)) =
        crate::xmlutil::find_open_tag(xml, "conditionalFormatting", cursor)
    {
        let block_end = crate::xmlutil::find_close_tag(xml, "conditionalFormatting", block_inner);
        let block_attrs_map = attributes(&block_attrs);
        let range_text = block_attrs_map
            .get("sqref")
            .map(|value| value.split_whitespace().next().unwrap_or("").to_string())
            .unwrap_or_default();
        let content_end = block_end.unwrap_or(block_inner);
        let block_content = &xml[block_inner..content_end];
        if !range_text.is_empty() {
            let range = parse_range_address(&range_text)?;
            let mut rule_cursor = 0usize;
            while let Some((_, rule_attrs, rule_inner, rule_self_closing)) =
                crate::xmlutil::find_open_tag(block_content, "cfRule", rule_cursor)
            {
                let rule_attrs_map = attributes(&rule_attrs);
                let id = format!("cf-{}", rules.len() + 1);
                let dxf_id = crate::jsnumber::parse(
                    rule_attrs_map.get("dxfId").map(String::as_str).unwrap_or(""),
                )
                .filter(|value| value.fract() == 0.0 && *value >= 0.0);
                let style = match dxf_id {
                    Some(id) => styles.resolve_differential(id as u32),
                    None => CellStyle::default(),
                };
                let rule_type = rule_attrs_map.get("type").map(String::as_str);
                match rule_type {
                    Some("duplicateValues") | Some("uniqueValues") => {
                        rules.push(if rule_type == Some("duplicateValues") {
                            ConditionalFormat::DuplicateValues { id, range, style }
                        } else {
                            ConditionalFormat::UniqueValues { id, range, style }
                        });
                    }
                    Some("cellIs") => {
                        const OPERATORS: [(&str, &str); 6] = [
                            ("equal", "equal"),
                            ("greaterThan", "greater-than"),
                            ("greaterThanOrEqual", "greater-than-or-equal"),
                            ("lessThan", "less-than"),
                            ("lessThanOrEqual", "less-than-or-equal"),
                            ("notEqual", "not-equal"),
                        ];
                        let operator = rule_attrs_map.get("operator").and_then(|value| {
                            OPERATORS
                                .iter()
                                .find(|(source, _)| source == value)
                                .map(|(_, target)| *target)
                        });
                        if let Some(operator) = operator {
                            let formula_text = if rule_self_closing {
                                None
                            } else {
                                element_text(
                                    &block_content[rule_inner
                                        ..crate::xmlutil::find_close_tag(
                                            block_content,
                                            "cfRule",
                                            rule_inner,
                                        )
                                        .unwrap_or(rule_inner)],
                                    "formula",
                                )
                            };
                            rules.push(ConditionalFormat::CellIs {
                                formula: formula_scalar(formula_text),
                                id,
                                operator,
                                range,
                                style,
                            });
                        }
                    }
                    _ => {}
                }
                rule_cursor = if rule_self_closing {
                    rule_inner.max(rule_cursor + 1)
                } else {
                    crate::xmlutil::find_close_tag(block_content, "cfRule", rule_inner)
                        .unwrap_or(rule_inner)
                        .max(rule_cursor + 1)
                };
            }
        }
        cursor = match block_end {
            Some(end) => end.max(cursor + 1),
            None => break,
        };
    }
    Ok(rules)
}

pub fn parse_data_validations(xml: &str) -> Vec<DataValidation> {
    let mut validations = Vec::new();
    // The engine numbered ids by the overall match index, including entries it
    // filtered out.
    let mut seen_tags: u64 = 0;
    let mut cursor = 0usize;
    while let Some((_, attrs_source, inner_start, self_closing)) =
        crate::xmlutil::find_open_tag(xml, "dataValidation", cursor)
    {
        seen_tags += 1;
        let index = seen_tags;
        let next_cursor = if self_closing {
            inner_start.max(cursor + 1)
        } else {
            crate::xmlutil::find_close_tag(xml, "dataValidation", inner_start)
                .unwrap_or(inner_start)
                .max(cursor + 1)
        };
        let attrs = attributes(&attrs_source);
        let range_text = attrs
            .get("sqref")
            .map(|value| value.split_whitespace().next().unwrap_or("").to_string())
            .unwrap_or_default();
        let content = if self_closing {
            ""
        } else {
            &xml[inner_start
                ..crate::xmlutil::find_close_tag(xml, "dataValidation", inner_start)
                    .unwrap_or(inner_start)]
        };
        if attrs.get("type").map(String::as_str) != Some("list") || range_text.is_empty() {
            cursor = next_cursor;
            continue;
        }
        let formula = decode_xml(&element_text(content, "formula1").unwrap_or_default());
        let quoted = formula
            .strip_prefix('"')
            .and_then(|rest| rest.strip_suffix('"'))
            .map(|inner| inner.to_string());
        let Ok(range) = parse_range_address(&range_text) else {
            cursor = next_cursor;
            continue;
        };
        validations.push(DataValidation {
            allow_blank: attrs.get("allowBlank").map(String::as_str) == Some("1"),
            error: attrs
                .get("error")
                .filter(|value| !value.is_empty())
                .map(|value| decode_xml(value)),
            error_title: attrs
                .get("errorTitle")
                .filter(|value| !value.is_empty())
                .map(|value| decode_xml(value)),
            id: format!("validation-{index}"),
            prompt: attrs
                .get("prompt")
                .filter(|value| !value.is_empty())
                .map(|value| decode_xml(value)),
            prompt_title: attrs
                .get("promptTitle")
                .filter(|value| !value.is_empty())
                .map(|value| decode_xml(value)),
            range,
            source: match quoted {
                Some(inner) => {
                    ValidationSource::Values { values: inner.split(',').map(decode_xml).collect() }
                }
                None => ValidationSource::Range { formula },
            },
        });
        cursor = next_cursor;
    }
    validations
}

/// Attach projected hyperlinks onto parsed cells, creating empty styled cells
/// where the engine did.
pub fn apply_hyperlinks(
    cells: &mut BTreeMap<(u32, u32), RawCell>,
    hyperlinks: Vec<((u32, u32), Hyperlink)>,
    base_style: &CellStyle,
    date_system_1904: bool,
    remaining_cells: &mut i64,
) -> Result<(), String> {
    for ((row, column), link) in hyperlinks {
        if let Some(existing) = cells.get_mut(&(row, column)) {
            existing.hyperlink = Some(link);
            continue;
        }
        consume_cell_budget(remaining_cells)?;
        let style = base_style.clone();
        let cell = RawCell {
            address: cell_address(row, column)?,
            display_value: crate::display::cell_display_value(
                None,
                None,
                &Scalar::Null,
                &style,
                date_system_1904,
            ),
            column,
            formula: None,
            formula_result: None,
            hyperlink: Some(link),
            row,
            style,
            value: Scalar::Null,
        };
        cells.insert((row, column), cell);
    }
    Ok(())
}
