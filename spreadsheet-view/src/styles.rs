//! OOXML style resolution mirroring `styles.ts`: fonts, fills, borders,
//! number formats, cellXfs, and differential formats for conditional rules.

use std::collections::BTreeMap;

use crate::model::CellStyle;
use crate::xmlutil::{attributes, find_close_tag, find_open_tag};

const BUILTIN_FORMATS: &[(u32, &str)] =
    &[(0, "General"), (1, "0"), (2, "0.00"), (9, "0%"), (10, "0.00%"), (14, "m/d/yy"), (49, "@")];

/// Normalize an ARGB/RGB color to `#rrggbb`, dropping alpha exactly like the
/// engine.
pub fn normalize_color(value: Option<&str>) -> Option<String> {
    let value = value?;
    let normalized = value.trim_start_matches('#').to_uppercase();
    if normalized.len() == 8 && normalized.chars().all(|c| c.is_ascii_hexdigit()) {
        return Some(format!("#{}", &normalized[2..]));
    }
    if normalized.len() == 6 && normalized.chars().all(|c| c.is_ascii_hexdigit()) {
        return Some(format!("#{normalized}"));
    }
    None
}

fn tag_attributes(source: &str, tag: &str) -> BTreeMap<String, String> {
    match find_open_tag(source, tag, 0) {
        Some((_, attrs, _, _)) => attributes(&attrs),
        None => BTreeMap::new(),
    }
}

fn parse_font(source: &str) -> CellStyle {
    let color_attributes = tag_attributes(source, "color");
    let font_color = normalize_color(color_attributes.get("rgb").map(String::as_str));
    let font_family = tag_attributes(source, "name").get("val").cloned();
    let font_size = tag_attributes(source, "sz")
        .get("val")
        .and_then(|value| crate::jsnumber::parse(value))
        .filter(|value| *value > 0.0);
    CellStyle {
        bold: source.contains("<b").then_some(true),
        color: font_color,
        font_family: font_family.filter(|family| !family.is_empty()),
        font_size,
        italic: source.contains("<i").then_some(true),
        underline: source.contains("<u").then_some(true),
        ..Default::default()
    }
}

fn parse_fill(source: &str) -> CellStyle {
    let foreground =
        normalize_color(tag_attributes(source, "fgColor").get("rgb").map(String::as_str));
    CellStyle { background: foreground, ..Default::default() }
}

fn border_side_color(source: &str, side: &str) -> Option<String> {
    let (_, _, inner_start, self_closing) = find_open_tag(source, side, 0)?;
    if self_closing {
        return None;
    }
    let end = find_close_tag(source, side, inner_start)?;
    let block = &source[..end];
    normalize_color(tag_attributes(block, "color").get("rgb").map(String::as_str))
}

fn parse_border(source: &str) -> CellStyle {
    CellStyle {
        border_bottom: border_side_color(source, "bottom"),
        border_left: border_side_color(source, "left"),
        border_right: border_side_color(source, "right"),
        border_top: border_side_color(source, "top"),
        ..Default::default()
    }
}

fn child_elements(source: &str, collection: &str) -> Vec<String> {
    // The block between <collection ...> and </collection>.
    let (block_start, _, mut cursor, self_closing) = match find_open_tag(source, collection, 0) {
        Some(found) => found,
        None => return Vec::new(),
    };
    if self_closing {
        return Vec::new();
    }
    let block_end = match find_close_tag(source, collection, cursor) {
        Some(end) => end - collection.len() - 3,
        None => return Vec::new(),
    };
    let _ = block_start;
    let singular = if collection == "cellXfs" { "xf" } else { &collection[..collection.len() - 1] };
    let mut items = Vec::new();
    while let Some((start, _, inner_start, self_closing)) = find_open_tag(source, singular, cursor)
    {
        if start >= block_end {
            break;
        }
        let item_end = if self_closing {
            // Find the '>' that closes this singleton: re-scan from start.
            close_of_singleton(source, start)
        } else {
            find_close_tag(source, singular, inner_start).unwrap_or(inner_start)
        };
        items.push(source[start..item_end].to_string());
        cursor = item_end.max(inner_start);
    }
    items
}

fn close_of_singleton(source: &str, open_start: usize) -> usize {
    let bytes = source.as_bytes();
    let mut cursor = open_start;
    while cursor < bytes.len() {
        match bytes[cursor] {
            b'"' | b'\'' => {
                let quote = bytes[cursor];
                cursor += 1;
                while cursor < bytes.len() && bytes[cursor] != quote {
                    cursor += 1;
                }
            }
            b'>' => return cursor + 1,
            _ => cursor += 1,
        }
    }
    cursor
}

#[derive(Clone, Copy)]
struct StyleReference {
    border_id: u32,
    fill_id: u32,
    font_id: u32,
    num_fmt_id: u32,
}

fn reference_number(attrs: &BTreeMap<String, String>, key: &str) -> u32 {
    attrs
        .get(key)
        .and_then(|value| crate::jsnumber::parse(value))
        .filter(|value| value.is_finite() && *value >= 0.0 && value.fract() == 0.0)
        .map(|value| value as u32)
        .unwrap_or(0)
}

pub struct StyleStore {
    resolved: Vec<CellStyle>,
    differentials: Vec<CellStyle>,
}

impl StyleStore {
    pub fn parse(source: &str) -> Self {
        let fonts: Vec<CellStyle> =
            child_elements(source, "fonts").iter().map(|s| parse_font(s)).collect();
        let fills: Vec<CellStyle> =
            child_elements(source, "fills").iter().map(|s| parse_fill(s)).collect();
        let borders: Vec<CellStyle> =
            child_elements(source, "borders").iter().map(|s| parse_border(s)).collect();
        let mut formats: BTreeMap<u32, String> =
            BUILTIN_FORMATS.iter().map(|(id, format)| (*id, format.to_string())).collect();
        let mut cursor = 0;
        while let Some((_, attrs_source, _, _)) = find_open_tag(source, "numFmt", cursor) {
            let attrs = attributes(&attrs_source);
            if let (Some(id), Some(code)) = (
                attrs
                    .get("numFmtId")
                    .and_then(|value| crate::jsnumber::parse(value))
                    .filter(|v| v.fract() == 0.0 && *v >= 0.0),
                attrs.get("formatCode"),
            ) {
                formats.insert(id as u32, code.clone());
            }
            cursor += 1;
        }
        let xfs = child_elements(source, "cellXfs");
        let references: Vec<StyleReference> = xfs
            .iter()
            .map(|xf| {
                let attrs = match find_open_tag(xf, "xf", 0) {
                    Some((_, attrs_source, _, _)) => attributes(&attrs_source),
                    None => BTreeMap::new(),
                };
                StyleReference {
                    border_id: reference_number(&attrs, "borderId"),
                    fill_id: reference_number(&attrs, "fillId"),
                    font_id: reference_number(&attrs, "fontId"),
                    num_fmt_id: reference_number(&attrs, "numFmtId"),
                }
            })
            .collect();
        let mut resolved: Vec<CellStyle> = xfs
            .iter()
            .zip(references.iter())
            .map(|(xf, reference)| {
                let alignment = tag_attributes(xf, "alignment");
                let number_format = formats.get(&reference.num_fmt_id);
                let horizontal = alignment.get("horizontal").map(String::as_str);
                let vertical = alignment.get("vertical").map(String::as_str);
                CellStyle {
                    number_format: number_format.cloned(),
                    horizontal: horizontal
                        .filter(|value| matches!(*value, "center" | "right" | "left"))
                        .map(str::to_string),
                    vertical: vertical
                        .map(|value| match value {
                            "center" => "middle",
                            "top" | "bottom" => value,
                            _ => "",
                        })
                        .filter(|value| !value.is_empty())
                        .map(str::to_string),
                    wrap_text: (alignment.get("wrapText").map(String::as_str) == Some("1"))
                        .then_some(true),
                    ..merge_styles(
                        merge_styles(
                            fonts.get(reference.font_id as usize).cloned().unwrap_or_default(),
                            fills.get(reference.fill_id as usize).cloned().unwrap_or_default(),
                        ),
                        borders.get(reference.border_id as usize).cloned().unwrap_or_default(),
                    )
                }
            })
            .collect();
        if resolved.is_empty() {
            resolved.push(CellStyle {
                number_format: Some("General".to_string()),
                ..Default::default()
            });
        }
        let differentials: Vec<CellStyle> = child_elements(source, "dxfs")
            .iter()
            .map(|dxf| {
                let mut style = merge_styles(parse_font(dxf), parse_fill(dxf));
                style = merge_styles(style, parse_border(dxf));
                if let Some(format_code) = tag_attributes(dxf, "numFmt").get("formatCode") {
                    style.number_format = Some(format_code.clone());
                }
                style
            })
            .collect();
        drop((fonts, fills, borders, formats));
        Self { resolved, differentials }
    }

    /// The fully-resolved style for a cellXfs index.
    pub fn resolve(&self, style_id: u32) -> CellStyle {
        self.resolved
            .get(style_id as usize)
            .or_else(|| self.resolved.first())
            .cloned()
            .unwrap_or_default()
    }

    /// The differential (dxf) style used by conditional formatting rules.
    pub fn resolve_differential(&self, style_id: u32) -> CellStyle {
        self.differentials.get(style_id as usize).cloned().unwrap_or_default()
    }
}

fn merge_styles(mut base: CellStyle, update: CellStyle) -> CellStyle {
    macro_rules! overlay {
        ($($field:ident),* $(,)?) => {
            $(if update.$field.is_some() {
                base.$field = update.$field;
            })*
        };
    }
    overlay!(
        background,
        bold,
        border_bottom,
        border_left,
        border_right,
        border_top,
        color,
        font_family,
        font_size,
        horizontal,
        italic,
        number_format,
        underline,
        vertical,
        wrap_text,
    );
    base
}

/// Merge two styles with later values winning, mirroring the spread order the
/// engine used when composing font/fill/border parts.
pub fn merged_style(base: CellStyle, update: CellStyle) -> CellStyle {
    merge_styles(base, update)
}
