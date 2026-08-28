//! Read-only projection of legacy Excel form-control checkboxes.
//!
//! Excel stores these controls in a VML drawing related from the worksheet.
//! They float over the sheet, but their anchor identifies the cell where the
//! viewer should show them.

use std::collections::BTreeSet;

use quick_xml::Reader;
use quick_xml::events::{BytesStart, Event};

use crate::archive::OoxmlArchive;
use crate::model::{Checkbox, Diagnostic};
use crate::objects::{directory, read_relationships, relationships_part, resolve_part};

const VML_DRAWING_REL: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/vmlDrawing";
const MAX_PROJECTED_CHECKBOXES: usize = 10_000;
const MAX_CHECKBOX_CAPTION_BYTES: usize = 16_384;

struct ShapeState {
    depth: usize,
    hidden: bool,
    object_type: Option<String>,
    anchor: Option<String>,
    checked: Option<String>,
    caption: String,
    client_data_depth: Option<usize>,
    textbox_depth: Option<usize>,
    capture: Option<CaptureState>,
}

struct CaptureState {
    kind: CaptureKind,
    depth: usize,
    value: String,
}

#[derive(Clone, Copy)]
enum CaptureKind {
    Anchor,
    Checked,
}

/// Read visible form-control checkboxes related from one worksheet.
///
/// Coordinates are one-based to match the public viewer model. Controls in
/// hidden rows or columns are omitted, like hidden cells and sheets.
pub fn read_checkboxes(
    archive: &OoxmlArchive,
    sheet_part: &str,
    sheet_id: &str,
    hidden_rows: &[u32],
    hidden_columns: &[u32],
    diagnostics: &mut Vec<Diagnostic>,
) -> Vec<Checkbox> {
    let mut targets = BTreeSet::new();
    let relationships = read_relationships(archive, sheet_part, diagnostics, sheet_id);
    for relationship in relationships.values() {
        if relationship.relation_type != VML_DRAWING_REL
            || relationship.target_mode.as_deref() == Some("External")
        {
            continue;
        }
        targets.insert(resolve_part(&directory(sheet_part), &relationship.target));
    }

    let mut result = Vec::new();
    for target in targets {
        if !archive.has(&target) {
            continue;
        }
        let Ok(xml) = archive.text(&target) else { continue };
        if let Err(message) = crate::xmlutil::assert_well_formed_xml(&xml, &target) {
            diagnostics.push(Diagnostic {
                address: None,
                code: "xlsx.checkbox.vml.malformed".to_string(),
                message,
                part: Some(target),
                severity: "warning",
                sheet_id: Some(sheet_id.to_string()),
            });
            continue;
        }
        result.extend(parse_vml(&xml, hidden_rows, hidden_columns));
        if result.len() >= MAX_PROJECTED_CHECKBOXES {
            result.truncate(MAX_PROJECTED_CHECKBOXES);
            diagnostics.push(Diagnostic {
                address: None,
                code: "xlsx.checkbox.too-many".to_string(),
                message: format!(
                    "Workbook exceeds the {MAX_PROJECTED_CHECKBOXES} checkbox projection limit."
                ),
                part: Some(relationships_part(sheet_part)),
                severity: "warning",
                sheet_id: Some(sheet_id.to_string()),
            });
            break;
        }
    }
    result
}

fn parse_vml(xml: &str, hidden_rows: &[u32], hidden_columns: &[u32]) -> Vec<Checkbox> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(false);
    reader.config_mut().check_end_names = true;
    let mut depth = 0usize;
    let mut current: Option<ShapeState> = None;
    let mut result = Vec::new();

    loop {
        match reader.read_event() {
            Ok(Event::Start(start)) => {
                let name = local_name(start.name().as_ref()).to_vec();
                if name.eq_ignore_ascii_case(b"shape") {
                    current = Some(ShapeState {
                        depth,
                        hidden: attribute(&start, b"style")
                            .is_some_and(|style| is_hidden_style(&style)),
                        object_type: None,
                        anchor: None,
                        checked: None,
                        caption: String::new(),
                        client_data_depth: None,
                        textbox_depth: None,
                        capture: None,
                    });
                } else if let Some(state) = current.as_mut() {
                    if name.eq_ignore_ascii_case(b"clientdata") {
                        state.client_data_depth = Some(depth);
                        state.object_type = attribute(&start, b"ObjectType");
                    } else if name.eq_ignore_ascii_case(b"textbox") {
                        state.textbox_depth = Some(depth);
                    } else if name.eq_ignore_ascii_case(b"anchor")
                        && state.client_data_depth.is_some_and(|value| depth > value)
                    {
                        state.capture = Some(CaptureState {
                            kind: CaptureKind::Anchor,
                            depth,
                            value: String::new(),
                        });
                    } else if name.eq_ignore_ascii_case(b"checked")
                        && state.client_data_depth.is_some_and(|value| depth > value)
                    {
                        state.capture = Some(CaptureState {
                            kind: CaptureKind::Checked,
                            depth,
                            value: String::new(),
                        });
                    }
                }
                depth += 1;
            }
            Ok(Event::Empty(empty)) => {
                if let Some(state) = current.as_mut() {
                    let name = local_name(empty.name().as_ref()).to_vec();
                    if name.eq_ignore_ascii_case(b"clientdata") {
                        state.object_type = attribute(&empty, b"ObjectType");
                    } else if name.eq_ignore_ascii_case(b"anchor") {
                        state.anchor = Some(String::new());
                    } else if name.eq_ignore_ascii_case(b"checked") {
                        state.checked = Some(String::new());
                    }
                }
            }
            Ok(Event::Text(text)) => {
                if let Some(state) = current.as_mut() {
                    let value = String::from_utf8_lossy(text.as_ref());
                    if state.textbox_depth.is_some_and(|value_depth| depth > value_depth) {
                        if state.caption.len() < MAX_CHECKBOX_CAPTION_BYTES {
                            state.caption.push_str(&value);
                        }
                    }
                    if let Some(capture) = state.capture.as_mut()
                        && depth > capture.depth
                    {
                        capture.value.push_str(&value);
                    }
                }
            }
            Ok(Event::CData(text)) => {
                if let Some(state) = current.as_mut() {
                    let value = String::from_utf8_lossy(text.as_ref());
                    if state.textbox_depth.is_some_and(|value_depth| depth > value_depth) {
                        if state.caption.len() < MAX_CHECKBOX_CAPTION_BYTES {
                            state.caption.push_str(&value);
                        }
                    }
                    if let Some(capture) = state.capture.as_mut()
                        && depth > capture.depth
                    {
                        capture.value.push_str(&value);
                    }
                }
            }
            Ok(Event::GeneralRef(reference)) => {
                if let Some(state) = current.as_mut() {
                    let value = format!("&{};", String::from_utf8_lossy(reference.as_ref()));
                    if state.textbox_depth.is_some_and(|value_depth| depth > value_depth) {
                        if state.caption.len() < MAX_CHECKBOX_CAPTION_BYTES {
                            state.caption.push_str(&value);
                        }
                    }
                    if let Some(capture) = state.capture.as_mut()
                        && depth > capture.depth
                    {
                        capture.value.push_str(&value);
                    }
                }
            }
            Ok(Event::End(end)) => {
                depth = depth.saturating_sub(1);
                let name = local_name(end.name().as_ref()).to_vec();
                if let Some(state) = current.as_mut() {
                    if state.capture.as_ref().is_some_and(|capture| capture.depth == depth) {
                        if let Some(capture) = state.capture.take() {
                            match capture.kind {
                                CaptureKind::Anchor => state.anchor = Some(capture.value),
                                CaptureKind::Checked => state.checked = Some(capture.value),
                            }
                        }
                    }
                    if state.textbox_depth == Some(depth) && name.eq_ignore_ascii_case(b"textbox") {
                        state.textbox_depth = None;
                    }
                    if state.client_data_depth == Some(depth)
                        && name.eq_ignore_ascii_case(b"clientdata")
                    {
                        state.client_data_depth = None;
                    }
                    if state.depth == depth && name.eq_ignore_ascii_case(b"shape") {
                        if let Some(state) = current.take()
                            && let Some(checkbox) = finish_shape(state, hidden_rows, hidden_columns)
                        {
                            result.push(checkbox);
                        }
                    }
                }
            }
            Ok(Event::Eof) => break,
            Err(_) => break,
            _ => {}
        }
    }
    result
}

fn finish_shape(
    state: ShapeState,
    hidden_rows: &[u32],
    hidden_columns: &[u32],
) -> Option<Checkbox> {
    if state.hidden
        || !state.object_type.as_deref().is_some_and(|value| value.eq_ignore_ascii_case("Checkbox"))
    {
        return None;
    }
    let (row, column) = anchor_cell(state.anchor.as_deref()?)?;
    if hidden_rows.contains(&row) || hidden_columns.contains(&column) {
        return None;
    }
    let checked = match state.checked.as_deref().map(str::trim) {
        None | Some("") | Some("0") => false,
        Some("1") => true,
        Some(_) => return None,
    };
    let caption = normalize_caption(&state.caption);
    Some(Checkbox { checked, caption, column, row })
}

fn anchor_cell(value: &str) -> Option<(u32, u32)> {
    let mut parts = value.split(',').map(|part| part.trim().parse::<u32>().ok());
    let column = parts.next()??.checked_add(1)?;
    parts.next()??;
    let row = parts.next()??.checked_add(1)?;
    Some((row, column))
}

fn normalize_caption(value: &str) -> String {
    let mut text = String::with_capacity(value.len());
    let mut in_tag = false;
    for character in value.chars() {
        match character {
            '<' => in_tag = true,
            '>' => in_tag = false,
            character if !in_tag => text.push(character),
            _ => {}
        }
    }
    let decoded = crate::xmlutil::decode_xml(&text);
    let mut result = String::with_capacity(decoded.len());
    let mut previous_space = false;
    for character in decoded.trim().chars() {
        if character.is_whitespace() {
            if !previous_space {
                result.push(' ');
            }
            previous_space = true;
        } else {
            result.push(character);
            previous_space = false;
        }
    }
    result
}

fn is_hidden_style(style: &str) -> bool {
    style.to_ascii_lowercase().replace(' ', "").contains("visibility:hidden")
}

fn attribute(start: &BytesStart<'_>, wanted: &[u8]) -> Option<String> {
    start.attributes().flatten().find_map(|attribute| {
        let name = local_name(attribute.key.as_ref());
        if !name.eq_ignore_ascii_case(wanted) {
            return None;
        }
        Some(crate::xmlutil::decode_xml(&String::from_utf8_lossy(attribute.value.as_ref())))
    })
}

fn local_name(name: &[u8]) -> &[u8] {
    name.rsplit(|byte| *byte == b':').next().unwrap_or(name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn projects_visible_checkbox_states_and_captions() {
        let xml = r#"<xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:x="urn:schemas-microsoft-com:office:excel">
            <v:shape style="position:absolute">
                <v:textbox><div><font>Roof &amp; Wall</font></div></v:textbox>
                <x:ClientData ObjectType="Checkbox"><x:Anchor>1, 5, 0, 2, 2, 10, 1, 1</x:Anchor><x:Checked>1</x:Checked></x:ClientData>
            </v:shape>
            <v:shape style="position:absolute">
                <x:ClientData ObjectType="Checkbox"><x:Anchor>2, 5, 1, 2, 3, 10, 1, 1</x:Anchor></x:ClientData>
            </v:shape>
            <v:shape style="position:absolute;visibility:hidden">
                <x:ClientData ObjectType="Checkbox"><x:Anchor>3, 5, 2, 2, 4, 10, 1, 1</x:Anchor><x:Checked>1</x:Checked></x:ClientData>
            </v:shape>
        </xml>"#;
        let result = parse_vml(xml, &[], &[]);
        assert_eq!(
            result
                .iter()
                .map(|checkbox| (
                    checkbox.row,
                    checkbox.column,
                    checkbox.checked,
                    checkbox.caption.as_str()
                ))
                .collect::<Vec<_>>(),
            vec![(1, 2, true, "Roof & Wall"), (2, 3, false, "")]
        );
    }

    #[test]
    fn skips_controls_in_hidden_rows_and_columns() {
        let xml = r#"<xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:x="urn:schemas-microsoft-com:office:excel"><v:shape><x:ClientData ObjectType="Checkbox"><x:Anchor>1,0,0,0,0,0,0,0</x:Anchor><x:Checked>1</x:Checked></x:ClientData></v:shape><v:shape><x:ClientData ObjectType="Checkbox"><x:Anchor>2,0,1,0,0,0,0,0</x:Anchor></x:ClientData></v:shape></xml>"#;
        let result = parse_vml(xml, &[2], &[2]);
        assert!(result.is_empty());
    }
}
