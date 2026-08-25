//! Chart part parsing and data resolution mirroring `charts.ts` and
//! `chart-references.ts`.

use crate::model::{
    ChartAreaReference, ChartDataSource, ChartGroup, ChartReference, ChartSeries, RenderedChart,
    RenderedChartSeries, Scalar,
};
use crate::xmlutil::decode_xml;

pub use crate::model::Chart;

const MAX_FORMULA_CHARACTERS: usize = 32_768;
const MAX_REFERENCE_AREAS: usize = 4_096;
const MAX_RESOLVED_POINTS: usize = 1_000_000;
/// The engine clamps cache lengths to one million points.
pub const MAX_CHART_CACHE_POINTS: f64 = 1_000_000.0;

/// A minimal XML element with local (namespace-stripped) names.
#[derive(Default)]
pub struct Node {
    pub name: String,
    pub attributes: std::collections::BTreeMap<String, String>,
    pub children: Vec<Node>,
    pub text: String,
}

impl Node {
    pub fn attr(&self, name: &str) -> Option<&str> {
        self.attributes.get(name).map(String::as_str)
    }

    pub fn child(&self, name: &str) -> Option<&Node> {
        self.children.iter().find(|candidate| candidate.name == name)
    }

    pub fn children(&self, name: &str) -> Vec<&Node> {
        self.children.iter().filter(|candidate| candidate.name == name).collect()
    }

    /// All descendants named `name` in document order.
    pub fn descendants<'a>(&'a self, name: &str) -> Vec<&'a Node> {
        let mut matches = Vec::new();
        self.collect(name, &mut matches);
        matches
    }

    fn collect<'a>(&'a self, name: &str, matches: &mut Vec<&'a Node>) {
        if self.name == name {
            matches.push(self);
        }
        for nested in &self.children {
            nested.collect(name, matches);
        }
    }
}

/// Parse XML into a namespace-stripped node tree; `None` when malformed or
/// over the engine's 100k node budget.
pub fn parse_chart_xml(source: &str) -> Option<Node> {
    use quick_xml::events::Event;

    let mut reader = quick_xml::Reader::from_str(source);
    reader.config_mut().check_end_names = true;
    let mut roots: Vec<Node> = Vec::new();
    let mut stack: Vec<Node> = Vec::new();
    let mut count = 0usize;
    let mut buffer = Vec::new();
    loop {
        let event = match reader.read_event_into(&mut buffer) {
            Ok(event) => event,
            Err(_) => return None,
        };
        match event {
            Event::Start(start) => {
                count += 1;
                if count > 100_000 {
                    return None;
                }
                let raw_name = String::from_utf8_lossy(start.name().as_ref()).into_owned();
                let mut attributes_map = std::collections::BTreeMap::new();
                for attribute in start.attributes() {
                    let attribute = match attribute {
                        Ok(attribute) => attribute,
                        Err(_) => return None,
                    };
                    let key = String::from_utf8_lossy(attribute.key.as_ref()).into_owned();
                    let local = key.rsplit(':').next().unwrap_or(&key).to_string();
                    let value = attribute
                        .normalized_value(quick_xml::XmlVersion::Implicit1_0)
                        .map(|value| value.into_owned())
                        .unwrap_or_default();
                    attributes_map.insert(local, value);
                }
                stack.push(Node {
                    name: raw_name.rsplit(':').next().unwrap_or("").to_string(),
                    attributes: attributes_map,
                    children: Vec::new(),
                    text: String::new(),
                });
            }
            Event::End(_) => {
                let finished = stack.pop()?;
                if let Some(parent) = stack.last_mut() {
                    parent.children.push(finished);
                } else {
                    roots.push(finished);
                }
            }
            Event::Empty(start) => {
                count += 1;
                if count > 100_000 {
                    return None;
                }
                let raw_name = String::from_utf8_lossy(start.name().as_ref()).into_owned();
                let mut attributes_map = std::collections::BTreeMap::new();
                for attribute in start.attributes() {
                    let attribute = match attribute {
                        Ok(attribute) => attribute,
                        Err(_) => return None,
                    };
                    let key = String::from_utf8_lossy(attribute.key.as_ref()).into_owned();
                    let local = key.rsplit(':').next().unwrap_or(&key).to_string();
                    let value = attribute
                        .normalized_value(quick_xml::XmlVersion::Implicit1_0)
                        .map(|value| value.into_owned())
                        .unwrap_or_default();
                    attributes_map.insert(local, value);
                }
                let node = Node {
                    name: raw_name.rsplit(':').next().unwrap_or("").to_string(),
                    attributes: attributes_map,
                    children: Vec::new(),
                    text: String::new(),
                };
                if let Some(parent) = stack.last_mut() {
                    parent.children.push(node);
                } else {
                    roots.push(node);
                }
            }
            Event::Text(text) => {
                let content = String::from_utf8_lossy(text.as_ref()).into_owned();
                let decoded = decode_xml(&content);
                if let Some(frame) = stack.last_mut() {
                    frame.text.push_str(&decoded);
                }
            }
            Event::CData(text) => {
                let content = String::from_utf8_lossy(text.as_ref()).into_owned();
                if let Some(frame) = stack.last_mut() {
                    frame.text.push_str(&content);
                }
            }
            Event::Eof => break,
            _ => {}
        }
        buffer.clear();
    }
    roots.into_iter().next()
}

fn first_trimmed_text(node: Option<&Node>, names: &[&str]) -> Option<String> {
    let node = node?;
    for candidate in names {
        if let Some(found) = node.descendants(candidate).first() {
            let value = found.text.trim();
            if !value.is_empty() {
                return Some(value.to_string());
            }
        }
    }
    None
}

/// The authored cache points behind a data source, padded to the declared
/// point count exactly like `cachedValues`.
fn cached_values(container: &Node, number_type: bool) -> Vec<Scalar> {
    let cache = container
        .descendants(if number_type { "numCache" } else { "strCache" })
        .into_iter()
        .next()
        .or_else(|| container.descendants("multiLvlStrCache").into_iter().next())
        .or_else(|| {
            container.descendants(if number_type { "numLit" } else { "strLit" }).into_iter().next()
        });
    let cache = match cache {
        Some(cache) => cache,
        None => return Vec::new(),
    };
    let point_count = cache
        .child("ptCount")
        .and_then(|point| point.attr("val"))
        .and_then(crate::jsnumber::parse)
        .filter(|value| value.fract() == 0.0 && *value >= 0.0)
        .map(|value| value as i64)
        .unwrap_or(0);
    let points: Vec<(i64, String)> = cache
        .descendants("pt")
        .into_iter()
        .filter_map(|point| {
            let index = point.attr("idx").and_then(crate::jsnumber::parse)?;
            if index.fract() != 0.0 || !(0.0..MAX_CHART_CACHE_POINTS).contains(&index) {
                return None;
            }
            let value = point.child("v").map(|v| v.text.clone()).unwrap_or_default();
            Some((index as i64, value))
        })
        .collect();
    let length =
        point_count.max(points.iter().map(|(index, _)| index + 1).max().unwrap_or(0)).max(0);
    let length = (length.min(MAX_CHART_CACHE_POINTS as i64)) as usize;
    let mut values: Vec<Scalar> = vec![Scalar::Null; length];
    for (index, value) in points {
        if number_type {
            values[index as usize] = crate::jsnumber::parse(&value)
                .filter(|parsed| parsed.is_finite())
                .map_or(Scalar::Null, Scalar::Number);
        } else {
            values[index as usize] = Scalar::Text(value);
        }
    }
    values
}

fn data_source(series: &Node, role: &str) -> Option<ChartDataSource> {
    let container = series.child(role)?;
    let source_kind = ["numRef", "numLit", "strRef", "strLit", "multiLvlStrRef"]
        .into_iter()
        .find(|name| !container.descendants(name).is_empty())?;
    let number_type = source_kind.starts_with("num");
    let formula = container
        .descendants("f")
        .first()
        .map(|found| found.text.trim().to_string())
        .filter(|text| !text.is_empty());
    Some(ChartDataSource {
        cache: cached_values(container, number_type),
        reference: formula.as_deref().map(parse_chart_reference_formula),
        value_type: if number_type { "number" } else { "string" },
    })
}

fn chart_group_type(group: &Node) -> Option<&'static str> {
    match group.name.as_str() {
        "lineChart" => Some("line"),
        "pieChart" => Some("pie"),
        "barChart" => {
            Some(if group.child("barDir").and_then(|dir| dir.attr("val")) == Some("bar") {
                "bar"
            } else {
                "column"
            })
        }
        _ => None,
    }
}

/// Parse a chart part; `id` mirrors the part name the engine attached.
pub fn parse_chart(id: &str, source: &str) -> Option<Chart> {
    let root = parse_chart_xml(source)?;
    let plot_area = root.descendants("plotArea").into_iter().next()?;
    let mut groups: Vec<ChartGroup> = Vec::new();
    for group_node in &plot_area.children {
        let Some(group_type) = chart_group_type(group_node) else {
            continue;
        };
        let mut series: Vec<ChartSeries> = Vec::new();
        for series_node in group_node.children("ser") {
            let Some(values) = data_source(series_node, "val") else {
                continue;
            };
            let categories = data_source(series_node, "cat");
            let name = first_trimmed_text(series_node.child("tx"), &["v"]);
            series.push(ChartSeries {
                categories,
                name: name.filter(|name| !name.is_empty()),
                values,
            });
        }
        if !series.is_empty() {
            groups.push(ChartGroup { series, r#type: group_type });
        }
    }
    if groups.is_empty() {
        return None;
    }
    let legend_node = root.descendants("legend").into_iter().next();
    let legend_position = legend_node
        .as_ref()
        .and_then(|legend| legend.descendants("legendPos").into_iter().next())
        .and_then(|position| position.attr("val").map(str::to_string));
    let legend = match legend_node {
        None => "none",
        Some(_) => match legend_position.as_deref() {
            Some("b") => "bottom",
            Some("l") => "left",
            Some("r") => "right",
            Some("t") => "top",
            _ => "right",
        },
    };
    let title = first_trimmed_text(root.descendants("title").into_iter().next(), &["t", "v"])
        .filter(|title| !title.is_empty());
    Some(Chart { groups, id: id.to_string(), legend, title })
}

// ---------------------------------------------------------------------------
// Reference formulas
// ---------------------------------------------------------------------------

fn strip_outer_parentheses(source: &str) -> String {
    let trimmed = source.trim();
    if !trimmed.starts_with('(') || !trimmed.ends_with(')') {
        return trimmed.to_string();
    }
    let characters: Vec<char> = trimmed.chars().collect();
    let mut depth = 0i32;
    let mut quoted = false;
    let mut index = 0;
    while index < characters.len() {
        let character = characters[index];
        if character == '\'' {
            if quoted && characters.get(index + 1) == Some(&'\'') {
                index += 1;
            } else {
                quoted = !quoted;
            }
            index += 1;
            continue;
        }
        if !quoted {
            if character == '(' {
                depth += 1;
            } else if character == ')' {
                depth -= 1;
            }
            if depth == 0 && index < characters.len() - 1 {
                return trimmed.to_string();
            }
            if depth < 0 {
                return trimmed.to_string();
            }
        }
        index += 1;
    }
    if depth == 0 && !quoted {
        return trimmed[1..trimmed.len() - 1].trim().to_string();
    }
    trimmed.to_string()
}

fn split_union(source: &str) -> Option<Vec<String>> {
    let characters: Vec<char> = source.chars().collect();
    let mut parts: Vec<String> = Vec::new();
    let mut start = 0usize;
    let mut depth = 0i32;
    let mut quoted = false;
    let mut index = 0;
    while index < characters.len() {
        let character = characters[index];
        if character == '\'' {
            if quoted && characters.get(index + 1) == Some(&'\'') {
                index += 1;
            } else {
                quoted = !quoted;
            }
        } else if !quoted {
            if character == '(' {
                depth += 1;
            } else if character == ')' {
                depth -= 1;
                if depth < 0 {
                    return None;
                }
            } else if character == ',' && depth == 0 {
                parts.push(characters[start..index].iter().collect::<String>().trim().to_string());
                start = index + 1;
            }
        }
        index += 1;
    }
    if quoted || depth != 0 {
        return None;
    }
    parts.push(characters[start..].iter().collect::<String>().trim().to_string());
    if parts.iter().all(|part| !part.is_empty()) { Some(parts) } else { None }
}

fn reference_separator(source: &str) -> isize {
    let characters: Vec<char> = source.chars().collect();
    let mut quoted = false;
    let mut separator: isize = -1;
    let mut index = 0;
    while index < characters.len() {
        if characters[index] == '\'' {
            if quoted && characters.get(index + 1) == Some(&'\'') {
                index += 1;
            } else {
                quoted = !quoted;
            }
        } else if !quoted && characters[index] == '!' {
            separator = index as isize;
        }
        index += 1;
    }
    if quoted { -1 } else { separator }
}

fn reference_sheet_name(source: &str) -> Option<String> {
    let trimmed = source.trim();
    if trimmed.is_empty() || trimmed.contains('[') || trimmed.contains(']') {
        return None;
    }
    if trimmed.starts_with('\'') && trimmed.ends_with('\'') {
        return Some(trimmed[1..trimmed.len() - 1].replace("''", "'"));
    }
    if !trimmed.contains('\'') && !trimmed.contains('!') {
        return Some(trimmed.to_string());
    }
    None
}

/// Parse a chart data reference like `'Sheet 1'!$A$2:$A$5` into typed areas or
/// an opaque fallback, mirroring `parseChartReferenceFormula`.
pub fn parse_chart_reference_formula(formula: &str) -> ChartReference {
    let raw = formula.trim();
    if raw.is_empty() || raw.chars().count() > MAX_FORMULA_CHARACTERS {
        return ChartReference::Opaque { formula: raw.to_string() };
    }
    let Some(operands) = split_union(&strip_outer_parentheses(raw)) else {
        return ChartReference::Opaque { formula: raw.to_string() };
    };
    if operands.len() > MAX_REFERENCE_AREAS {
        return ChartReference::Opaque { formula: raw.to_string() };
    }
    let mut areas: Vec<ChartAreaReference> = Vec::new();
    for operand in operands {
        let separator = reference_separator(&operand);
        let qualifier = if separator < 0 {
            None
        } else {
            let split_index =
                operand.char_indices().nth(separator as usize).map(|(byte_index, _)| byte_index);
            match split_index {
                Some(byte_index) => reference_sheet_name(&operand[..byte_index]),
                None => None,
            }
        };
        if separator >= 0 && qualifier.is_none() {
            return ChartReference::Opaque { formula: raw.to_string() };
        }
        let address_part: String = if separator < 0 {
            operand.clone()
        } else {
            operand
                .char_indices()
                .nth(separator as usize)
                .map(|(byte_index, _)| operand[byte_index + 1..].to_string())
                .unwrap_or_default()
        };
        let address = address_part.replace('$', "");
        let Ok(range) = crate::coordinates::parse_range_address(&address) else {
            return ChartReference::Opaque { formula: raw.to_string() };
        };
        areas.push(ChartAreaReference { range, sheet_name: qualifier });
    }
    ChartReference::Areas { areas, formula: raw.to_string() }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/// A resolved view of one sheet used during chart rendering.
pub struct SheetView {
    /// Effective values: formula cells expose their cached result.
    pub cells: std::collections::BTreeMap<(u32, u32), Scalar>,
    pub id: String,
    pub name: String,
}

pub fn resolve_chart_data_source(
    source: &ChartDataSource,
    current: &SheetView,
    sheets: &[SheetView],
) -> Vec<Scalar> {
    let Some(reference) = &source.reference else {
        return source.cache.clone();
    };
    let areas = match reference {
        ChartReference::Areas { areas, .. } => areas,
        ChartReference::Opaque { .. } => return source.cache.clone(),
    };
    let mut values: Vec<Scalar> = Vec::new();
    for area in areas {
        let sheet = match &area.sheet_name {
            Some(name) => find_sheet(sheets, name),
            None => Some(current),
        };
        let Some(sheet) = sheet else {
            return source.cache.clone();
        };
        let count = (area.range.bottom - area.range.top + 1) as usize
            * (area.range.right - area.range.left + 1) as usize;
        if values.len() + count > MAX_RESOLVED_POINTS {
            return source.cache.clone();
        }
        for row in area.range.top..=area.range.bottom {
            for column in area.range.left..=area.range.right {
                values.push(sheet.cells.get(&(row, column)).cloned().unwrap_or(Scalar::Null));
            }
        }
    }
    values
}

/// Resolution matches a sheet by id or exact name, mirroring the engine.
pub fn find_sheet<'a>(sheets: &'a [SheetView], name: &str) -> Option<&'a SheetView> {
    sheets.iter().find(|sheet| sheet.id == name || sheet.name == name)
}

/// Resolve a parsed chart to its renderable form, mirroring
/// `renderChartModel`.
pub fn render_chart_model(
    chart: &Chart,
    sheet: &SheetView,
    sheets: &[SheetView],
) -> Option<RenderedChart> {
    let first_group = chart.groups.first()?;
    let first = first_group.series.first();
    let categories = first
        .and_then(|series| series.categories.as_ref())
        .map(|source| {
            resolve_chart_data_source(source, sheet, sheets)
                .into_iter()
                .map(|value| match value {
                    Scalar::Null => String::new(),
                    Scalar::Bool(value) => if value { "true" } else { "false" }.to_string(),
                    Scalar::Text(text) => text,
                    Scalar::Number(number) => crate::jsnumber::to_js_string(number),
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let mut rendered_series: Vec<RenderedChartSeries> = Vec::new();
    for group in &chart.groups {
        for (index, item) in group.series.iter().enumerate() {
            let values = resolve_chart_data_source(&item.values, sheet, sheets)
                .into_iter()
                .map(|value| match value {
                    Scalar::Number(number) if number.is_finite() => number,
                    _ => 0.0,
                })
                .collect();
            rendered_series.push(RenderedChartSeries {
                name: item.name.clone().unwrap_or_else(|| format!("Series {}", index + 1)),
                r#type: group.r#type,
                values,
            });
        }
    }
    Some(RenderedChart {
        chart_id: chart.id.clone(),
        categories,
        legend: chart.legend,
        series: rendered_series,
        title: chart.title.clone(),
        r#type: first_group.r#type,
    })
}
