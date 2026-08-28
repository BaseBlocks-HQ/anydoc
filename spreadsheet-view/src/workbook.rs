//! Workbook open flow mirroring `SpreadsheetEngine.open` plus the read-only
//! projections (`model`, `renderCharts`) that the viewer consumes.

use std::collections::BTreeMap;

use crate::archive::OoxmlArchive;
use crate::charts::{SheetView, render_chart_model};
use crate::features::{SheetFeatureInput, feature_diagnostics, feature_manifest};
use crate::limits::ResolvedLimits;
use crate::model::{
    Axis, Cell, Diagnostic, PivotTable, Range, Sheet as ModelSheet, Table, WorkbookModel,
};
use crate::objects::{
    WorksheetProjection, parse_relationships, project_worksheet_objects, relationships_part,
    resolve_part,
};
use crate::worksheet::{ParsedSheetInput, apply_hyperlinks, parse_sheet};
use crate::xmlutil::{assert_well_formed_xml, attributes, find_open_tag};

const MAIN_WORKBOOK: &str = "xl/workbook.xml";
const WORKBOOK_RELS: &str = "xl/_rels/workbook.xml.rels";
const STYLES: &str = "xl/styles.xml";

pub const DEFAULT_STYLES: &str = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><styleSheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"><fonts count=\"1\"><font/></fonts><fills count=\"1\"><fill><patternFill patternType=\"none\"/></fill></fills><borders count=\"1\"><border/></borders><cellStyleXfs count=\"1\"><xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\"/></cellStyleXfs><cellXfs count=\"1\"><xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\" xfId=\"0\"/></cellXfs></styleSheet>";

struct SheetState {
    checkboxes: Vec<crate::model::Checkbox>,
    parsed: crate::worksheet::ParsedSheet,
    projection: WorksheetProjection,
    id: String,
    name: String,
    hidden: bool,
    part_name: String,
}

fn first_tag_attributes(xml: &str, tag: &str) -> BTreeMap<String, String> {
    match find_open_tag(xml, tag, 0) {
        Some((_, attrs, _, _)) => attributes(&attrs),
        None => BTreeMap::new(),
    }
}

fn parse_shared_strings(xml: &str) -> Vec<String> {
    let mut strings = Vec::new();
    let mut cursor = 0usize;
    while let Some((_, _, inner_start, self_closing)) = find_open_tag(xml, "si", cursor) {
        if self_closing {
            strings.push(String::new());
            continue;
        }
        let Some(end) = crate::xmlutil::find_close_tag(xml, "si", inner_start) else {
            break;
        };
        let block = &xml[inner_start..end - "</si>".len()];
        let mut text = String::new();
        let mut t_cursor = 0usize;
        while let Some((_, _, t_inner, t_self_closing)) = find_open_tag(block, "t", t_cursor) {
            if t_self_closing {
                t_cursor = t_inner.max(t_cursor + 1);
                continue;
            }
            let Some(t_end) = crate::xmlutil::find_close_tag(block, "t", t_inner) else {
                break;
            };
            text.push_str(&crate::xmlutil::decode_xml(&strip_markup(
                &block[t_inner..t_end - "</t>".len()],
            )));
            t_cursor = t_end.max(t_cursor + 1);
        }
        strings.push(text);
        cursor = end.max(cursor + 1);
    }
    strings
}

fn strip_markup(source: &str) -> String {
    let mut result = String::with_capacity(source.len());
    let mut depth = false;
    for character in source.chars() {
        match character {
            '<' => depth = true,
            '>' => depth = false,
            c if !depth => result.push(c),
            _ => {}
        }
    }
    result
}

struct ParsedTable {
    columns: Vec<String>,
    id: String,
    name: String,
    range: Range,
    show_filter_buttons: bool,
    style: String,
}

fn parse_table(part: &str, xml: &str) -> Option<ParsedTable> {
    let root = first_tag_attributes(xml, "table");
    let reference = root.get("ref").filter(|value| !value.is_empty())?;
    let name = root.get("name").filter(|value| !value.is_empty())?;
    let range = crate::coordinates::parse_range_address(reference).ok()?;
    let mut columns = Vec::new();
    let mut cursor = 0usize;
    while let Some((_, attrs_source, inner_start, _)) = find_open_tag(xml, "tableColumn", cursor) {
        cursor = inner_start.max(cursor + 1);
        let attrs = attributes(&attrs_source);
        if let Some(column_name) = attrs.get("name").filter(|value| !value.is_empty()) {
            columns.push(crate::xmlutil::decode_xml(column_name));
        }
    }
    let id = root
        .get("id")
        .filter(|value| !value.is_empty())
        .cloned()
        .or_else(|| {
            let base = part.rsplit('/').next().unwrap_or(part);
            let dot = base.find('.')?;
            let digits = &base[..dot];
            digits.chars().all(|c| c.is_ascii_digit()).then(|| digits.to_string())
        })
        .unwrap_or_else(|| part.to_string());
    let lower = xml.to_ascii_lowercase();
    let style = first_tag_attributes(xml, "tableStyleInfo")
        .get("name")
        .cloned()
        .unwrap_or_else(|| "TableStyleMedium2".to_string());
    Some(ParsedTable {
        columns,
        id,
        name: crate::xmlutil::decode_xml(name),
        range,
        show_filter_buttons: lower.contains("<autofilter"),
        style,
    })
}

struct ParsedPivot {
    id: String,
    name: String,
    row_fields: Vec<String>,
    source_range: Range,
    source_sheet_id: String,
    target_range: Range,
    values: Vec<crate::model::PivotValue>,
}

fn parse_pivot_table(
    cache_xml: &str,
    pivot_xml: &str,
    sheets: &[SheetState],
) -> Option<ParsedPivot> {
    let pivot_root = first_tag_attributes(pivot_xml, "pivotTableDefinition");
    let location = first_tag_attributes(pivot_xml, "location");
    let source = first_tag_attributes(cache_xml, "worksheetSource");
    let name = pivot_root.get("name").filter(|value| !value.is_empty())?;
    let location_ref = location.get("ref").filter(|value| !value.is_empty())?;
    let source_ref = source.get("ref").filter(|value| !value.is_empty())?;
    // The engine decoded this attribute twice (once while scanning
    // attributes, once explicitly); keep the same behavior.
    let source_sheet_name = crate::xmlutil::decode_xml(source.get("sheet")?);
    let target_range = crate::coordinates::parse_range_address(location_ref).ok()?;
    let source_range = crate::coordinates::parse_range_address(source_ref).ok()?;

    let mut headers: Vec<String> = Vec::new();
    let mut cursor = 0usize;
    while let Some((_, attrs_source, inner_start, _)) =
        find_open_tag(cache_xml, "cacheField", cursor)
    {
        cursor = inner_start.max(cursor + 1);
        let attrs = attributes(&attrs_source);
        if let Some(header) = attrs.get("name").filter(|value| !value.is_empty()) {
            headers.push(crate::xmlutil::decode_xml(header));
        }
    }

    let row_fields_block = prefixed_block(pivot_xml, "rowFields").unwrap_or_default();
    let mut row_fields: Vec<String> = Vec::new();
    let mut cursor = 0usize;
    while let Some((_, attrs_source, inner_start, _)) =
        find_open_tag(&row_fields_block, "field", cursor)
    {
        cursor = inner_start.max(cursor + 1);
        let attrs = attributes(&attrs_source);
        let index = crate::jsnumber::parse(attrs.get("x").map(String::as_str).unwrap_or(""));
        if let Some(field) = index.and_then(|index| headers.get(index as usize)) {
            row_fields.push(field.clone());
        }
    }

    let mut values: Vec<crate::model::PivotValue> = Vec::new();
    let mut cursor = 0usize;
    while let Some((_, attrs_source, inner_start, _)) =
        find_open_tag(pivot_xml, "dataField", cursor)
    {
        cursor = inner_start.max(cursor + 1);
        let attrs = attributes(&attrs_source);
        let field_index =
            crate::jsnumber::parse(attrs.get("fld").map(String::as_str).unwrap_or(""));
        let Some(field) = field_index.and_then(|index| headers.get(index as usize)) else {
            continue;
        };
        let summarize_by = match attrs.get("subtotal").map(String::as_str).unwrap_or("sum") {
            "average" => "average",
            "count" => "count",
            "max" => "maximum",
            "min" => "minimum",
            _ => "sum",
        };
        values.push(crate::model::PivotValue {
            field: field.clone(),
            name: attrs
                .get("name")
                .filter(|value| !value.is_empty())
                .map(|value| crate::xmlutil::decode_xml(value)),
            summarize_by,
        });
    }

    let lowered = source_sheet_name.to_lowercase();
    let source_sheet_id = sheets
        .iter()
        .find(|sheet| sheet.name.to_lowercase() == lowered)
        .map(|sheet| sheet.id.clone())?;

    Some(ParsedPivot {
        id: pivot_root
            .get("cacheId")
            .filter(|value| !value.is_empty())
            .cloned()
            .unwrap_or_else(|| name.clone()),
        name: crate::xmlutil::decode_xml(name),
        row_fields,
        source_range,
        source_sheet_id,
        target_range,
        values,
    })
}

fn prefixed_block(source: &str, name: &str) -> Option<String> {
    let (_, _, inner_start, self_closing) = find_open_tag(source, name, 0)?;
    if self_closing {
        return Some(String::new());
    }
    let end = crate::xmlutil::find_close_tag(source, name, inner_start)?;
    Some(source[inner_start..end - name.len() - 3].to_string())
}

fn sheet_used_range(sheet: &SheetState) -> Option<Range> {
    let mut result: Option<Range> = None;
    let expand = |range: &mut Option<Range>, row: u32, column: u32| match range {
        Some(existing) => {
            existing.bottom = existing.bottom.max(row);
            existing.left = existing.left.min(column);
            existing.right = existing.right.max(column);
            existing.top = existing.top.min(row);
        }
        None => {
            *range = Some(Range { bottom: row, left: column, right: column, top: row });
        }
    };
    for (row, column) in sheet.parsed.cells.keys() {
        expand(&mut result, *row, *column);
    }
    for merge in sheet.parsed.merges.iter() {
        for corner in [
            (merge.top, merge.left),
            (merge.top, merge.right),
            (merge.bottom, merge.left),
            (merge.bottom, merge.right),
        ] {
            expand(&mut result, corner.0, corner.1);
        }
    }
    for checkbox in &sheet.checkboxes {
        expand(&mut result, checkbox.row, checkbox.column);
    }
    result
}

fn to_axis(axis: &crate::worksheet::AxisData) -> Axis {
    Axis { default_size: axis.default_size, hidden: axis.hidden.clone(), sizes: axis.sizes.clone() }
}

/// Parse an XLSX package into the complete workbook model.
pub fn open(bytes: &[u8], limits: &ResolvedLimits) -> Result<WorkbookModel, String> {
    if limits.max_cells < 1 {
        return Err("Spreadsheet cell limit is invalid.".to_string());
    }
    let mut remaining_cells: i64 = limits.max_cells as i64;
    let archive = OoxmlArchive::open(bytes, limits)?;
    for required in ["[Content_Types].xml", "_rels/.rels", MAIN_WORKBOOK, WORKBOOK_RELS] {
        if !archive.has(required) {
            return Err(format!("Workbook is missing required OOXML part: {required}"));
        }
        if required.ends_with(".xml") || required.ends_with(".rels") {
            assert_well_formed_xml(&archive.text(required)?, required)?;
        }
    }
    let workbook_xml = archive.text(MAIN_WORKBOOK)?;
    let date_system_1904 =
        first_tag_attributes(&workbook_xml, "workbookPr").get("date1904").map(String::as_str)
            == Some("1");

    let relationship_map = parse_relationships(&archive.text(WORKBOOK_RELS)?);
    let shared_part = relationship_map
        .values()
        .find(|relationship| relationship.relation_type.ends_with("/sharedStrings"))
        .map(|relationship| resolve_part("xl", &relationship.target));
    if let Some(shared_part) = &shared_part {
        if !archive.has(shared_part) {
            return Err(format!("Shared strings part is missing: {shared_part}"));
        }
        assert_well_formed_xml(&archive.text(shared_part)?, shared_part)?;
    }
    let shared_strings: Vec<String> = match &shared_part {
        Some(part) => parse_shared_strings(&archive.text(part)?),
        None => Vec::new(),
    };

    let styles_part = relationship_map
        .values()
        .find(|relationship| relationship.relation_type.ends_with("/styles"))
        .map(|relationship| resolve_part("xl", &relationship.target));
    if let Some(styles_part) = &styles_part
        && !archive.has(styles_part)
    {
        return Err(format!("Styles part is missing: {styles_part}"));
    }
    let styles_xml = match (&styles_part, archive.has(STYLES)) {
        (Some(part), _) => archive.text(part)?,
        (None, true) => archive.text(STYLES)?,
        (None, false) => DEFAULT_STYLES.to_string(),
    };
    assert_well_formed_xml(&styles_xml, styles_part.as_deref().unwrap_or(STYLES))?;
    let styles = crate::styles::StyleStore::parse(&styles_xml);

    // Parse worksheets in workbook order.
    let mut sheets: Vec<SheetState> = Vec::new();
    let mut cursor = 0usize;
    while let Some((start, attrs_source, inner_start, _)) =
        find_open_tag(&workbook_xml, "sheet", cursor)
    {
        cursor = inner_start.max(start + 1);
        let attrs = attributes(&attrs_source);
        let Some(relationship_id) = attrs.get("r:id") else {
            continue;
        };
        let Some(relationship) = relationship_map.get(relationship_id) else {
            continue;
        };
        if !relationship.relation_type.ends_with("/worksheet") {
            continue;
        }
        let part_name = resolve_part("xl", &relationship.target);
        if !archive.has(&part_name) {
            return Err(format!("Worksheet part is missing: {part_name}"));
        }
        let sheet_xml = archive.text(&part_name)?;
        assert_well_formed_xml(&sheet_xml, &part_name)?;
        let sheet_id = attrs.get("sheetId").cloned().unwrap_or_else(|| relationship_id.clone());
        let name = attrs
            .get("name")
            .filter(|name| !name.is_empty())
            .cloned()
            .unwrap_or_else(|| format!("Sheet {}", sheets.len() + 1));
        let hidden =
            matches!(attrs.get("state").map(String::as_str), Some("hidden") | Some("veryHidden"));
        let mut projection = project_worksheet_objects(&archive, &sheet_id, &part_name, &sheet_xml);
        let mut parsed = parse_sheet(ParsedSheetInput {
            date_system_1904,
            shared_strings: &shared_strings,
            styles: &styles,
            xml: &sheet_xml,
            remaining_cells: &mut remaining_cells,
        })?;
        apply_hyperlinks(
            &mut parsed.cells,
            std::mem::take(&mut { Vec::from_iter(projection.hyperlinks.iter().cloned()) }),
            &styles.resolve(0),
            date_system_1904,
            &mut remaining_cells,
        )?;
        let checkboxes = crate::controls::read_checkboxes(
            &archive,
            &part_name,
            &sheet_id,
            &parsed.rows.hidden,
            &parsed.columns.hidden,
            &mut projection.diagnostics,
        );
        sheets.push(SheetState {
            checkboxes,
            parsed,
            projection,
            id: sheet_id,
            name,
            hidden,
            part_name,
        });
    }
    if sheets.is_empty() {
        return Err("Workbook contains no readable worksheets.".to_string());
    }

    // Pivot caches declared in the workbook.
    let mut pivot_cache_parts: BTreeMap<u32, String> = BTreeMap::new();
    let mut cursor = 0usize;
    while let Some((start, attrs_source, inner_start, _)) =
        find_open_tag(&workbook_xml, "pivotCache", cursor)
    {
        cursor = inner_start.max(start + 1);
        let attrs = attributes(&attrs_source);
        let cache_id =
            crate::jsnumber::parse(attrs.get("cacheId").map(String::as_str).unwrap_or(""))
                .filter(|value| value.is_finite());
        let relationship = attrs.get("r:id").and_then(|id| relationship_map.get(id));
        if let (Some(cache_id), Some(relationship)) = (cache_id, relationship) {
            pivot_cache_parts.insert(cache_id as u32, resolve_part("xl", &relationship.target));
        }
    }

    // Tables and pivot tables referenced from each worksheet's relationships.
    let mut table_entries: Vec<Vec<Table>> = vec![Vec::new(); sheets.len()];
    let mut pivot_entries: Vec<Vec<PivotTable>> = vec![Vec::new(); sheets.len()];
    for (sheet_index, sheet) in sheets.iter().enumerate() {
        let relationship_part = relationships_part(&sheet.part_name);
        if !archive.has(&relationship_part) {
            continue;
        }
        let sheet_relationships =
            read_relationships_for_tables(&archive, &sheet.part_name, &relationship_part)?;
        for relationship in sheet_relationships.values() {
            let base_directory = match sheet.part_name.rfind('/') {
                Some(index) => sheet.part_name[..index].to_string(),
                None => String::new(),
            };
            let feature_part = resolve_part(&base_directory, &relationship.target);
            if !archive.has(&feature_part) {
                continue;
            }
            if relationship.relation_type.ends_with("/table") {
                let xml = archive.text(&feature_part)?;
                if let Some(table) = parse_table(&feature_part, &xml) {
                    table_entries[sheet_index].push(Table {
                        columns: table.columns,
                        id: table.id,
                        name: table.name,
                        range: table.range,
                        show_filter_buttons: table.show_filter_buttons,
                        style: table.style,
                    });
                }
            } else if relationship.relation_type.ends_with("/pivotTable") {
                let pivot_xml = archive.text(&feature_part)?;
                let cache_id = crate::jsnumber::parse(
                    first_tag_attributes(&pivot_xml, "pivotTableDefinition")
                        .get("cacheId")
                        .map(String::as_str)
                        .unwrap_or(""),
                );
                let cache_part = cache_id.and_then(|id| pivot_cache_parts.get(&(id as u32)));
                let Some(cache_part) = cache_part else { continue };
                if !archive.has(cache_part) {
                    continue;
                }
                let cache_xml = archive.text(cache_part)?;
                if let Some(pivot) = parse_pivot_table(&cache_xml, &pivot_xml, &sheets) {
                    pivot_entries[sheet_index].push(PivotTable {
                        id: pivot.id,
                        name: pivot.name,
                        row_fields: pivot.row_fields,
                        source_range: pivot.source_range,
                        source_sheet_id: pivot.source_sheet_id,
                        target_range: pivot.target_range,
                        values: pivot.values,
                    });
                }
            }
        }
    }

    // Assemble the public model.
    let mut model_sheets: Vec<ModelSheet> = Vec::new();
    for (sheet_index, sheet) in sheets.iter().enumerate() {
        let mut cells: Vec<Cell> = Vec::with_capacity(sheet.parsed.cells.len());
        for raw in sheet.parsed.cells.values() {
            cells.push(Cell {
                address: raw.address.clone(),
                column: raw.column,
                display_value: raw.display_value.clone(),
                formula: raw.formula.clone(),
                formula_result: raw.formula_result.clone(),
                hyperlink: raw.hyperlink.clone(),
                row: raw.row,
                style: raw.style.clone(),
                value: raw.value.clone(),
            });
        }
        model_sheets.push(ModelSheet {
            checkboxes: sheet.checkboxes.clone(),
            cells,
            conditional_formats: sheet.parsed.conditional_formats.clone(),
            columns: to_axis(&sheet.parsed.columns),
            data_validations: sheet.parsed.data_validations.clone(),
            frozen_columns: sheet.parsed.frozen_columns,
            frozen_rows: sheet.parsed.frozen_rows,
            hidden: sheet.hidden,
            id: sheet.id.clone(),
            merges: sheet.parsed.merges.clone(),
            name: sheet.name.clone(),
            objects: sheet.projection.objects.clone(),
            pivot_tables: core::mem::take(&mut pivot_entries[sheet_index]),
            rows: to_axis(&sheet.parsed.rows),
            show_grid_lines: sheet.parsed.show_grid_lines,
            tables: core::mem::take(&mut table_entries[sheet_index]),
            used_range: sheet_used_range(sheet),
            rendered_charts: Vec::new(),
        });
    }

    // Resolve rendered charts against every sheet's effective values.
    let views: Vec<SheetView> = sheets
        .iter()
        .map(|sheet| SheetView {
            cells: sheet
                .parsed
                .cells
                .iter()
                .map(|((row, column), raw)| {
                    (
                        (*row, *column),
                        if raw.formula.is_some() {
                            raw.formula_result.clone().unwrap_or(crate::model::Scalar::Null)
                        } else {
                            raw.value.clone()
                        },
                    )
                })
                .collect(),
            id: sheet.id.clone(),
            name: sheet.name.clone(),
        })
        .collect();
    for (index, sheet) in sheets.iter().enumerate() {
        let mut rendered = Vec::new();
        for object in &sheet.projection.objects {
            if let Some(chart) = &object.chart
                && let Some(model) = render_chart_model(chart, &views[index], &views)
            {
                rendered.push(model);
            }
        }
        model_sheets[index].rendered_charts = rendered;
    }

    let feature_inputs: Vec<SheetFeatureInput> = model_sheets
        .iter()
        .zip(sheets.iter())
        .map(|(model_sheet, sheet)| SheetFeatureInput {
            objects: model_sheet.objects.clone(),
            pivot_tables: model_sheet.pivot_tables.len(),
            tables: model_sheet.tables.len(),
            conditional_formats: sheet.parsed.conditional_formats.len(),
            data_validations: sheet.parsed.data_validations.len(),
            conditional_formatting_tag_count: sheet.parsed.raw_conditional_formatting_tags,
            data_validation_tag_count: sheet.parsed.raw_data_validation_tags,
            hyperlink_count: sheet.projection.hyperlink_count,
            surfaced_hyperlink_count: sheet.projection.surfaced_hyperlink_count,
        })
        .collect();
    let features = feature_manifest(&archive, &feature_inputs, &workbook_xml);
    let mut diagnostics: Vec<Diagnostic> = feature_diagnostics(&features);
    for sheet in &sheets {
        diagnostics.extend(sheet.projection.diagnostics.clone());
    }

    Ok(WorkbookModel {
        date_system: if date_system_1904 { "1904" } else { "1900" },
        diagnostics,
        features,
        objects: model_sheets.iter().flat_map(|sheet| sheet.objects.iter().cloned()).collect(),
        sheets: model_sheets,
    })
}

/// Relationships for a worksheet part without emitting diagnostics (the
/// engine's table/pivot pass ignored malformed rels silently at this stage).
fn read_relationships_for_tables(
    archive: &OoxmlArchive,
    owner_part: &str,
    relationship_part: &str,
) -> Result<BTreeMap<String, crate::objects::Relationship>, String> {
    let _ = owner_part;
    if !archive.has(relationship_part) {
        return Ok(BTreeMap::new());
    }
    let xml = archive.text(relationship_part)?;
    Ok(parse_relationships(&xml))
}
