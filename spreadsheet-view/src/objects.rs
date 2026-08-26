//! Worksheet drawing and hyperlink projection mirroring `objects.ts`.

use std::collections::BTreeMap;

use crate::archive::OoxmlArchive;
use crate::charts::{Chart, parse_chart};
use crate::coordinates::parse_range_address;
use crate::model::{
    AnchorPoint, Diagnostic, Hyperlink, ObjectAnchor, Point2D, Size, SpreadsheetObject,
};
use crate::xmlutil::{attributes, decode_xml};

const MAX_PROJECTED_HYPERLINK_CELLS: usize = 100_000;
const MAX_PROJECTED_OBJECTS: usize = 10_000;

pub struct Relationship {
    pub id: String,
    pub target: String,
    pub target_mode: Option<String>,
    pub relation_type: String,
}

pub struct WorksheetProjection {
    pub diagnostics: Vec<Diagnostic>,
    /// Cell-keyed hyperlink projection: `(row, column)` keys.
    pub hyperlinks: Vec<((u32, u32), Hyperlink)>,
    pub hyperlink_count: u64,
    pub surfaced_hyperlink_count: u64,
    pub objects: Vec<SpreadsheetObject>,
}

pub(crate) fn directory(part: &str) -> String {
    match part.rfind('/') {
        Some(index) => part[..index].to_string(),
        None => String::new(),
    }
}

fn base_name(part: &str) -> &str {
    match part.rfind('/') {
        Some(index) => &part[index + 1..],
        None => part,
    }
}

pub(crate) fn relationships_part(part: &str) -> String {
    format!("{}/_rels/{}.rels", directory(part), base_name(part))
}

pub fn resolve_part(base: &str, target: &str) -> String {
    if let Some(stripped) = target.strip_prefix('/') {
        return stripped.to_string();
    }
    let joined = format!("{base}/{target}");
    let mut resolved: Vec<&str> = Vec::new();
    for segment in joined.split('/') {
        if segment.is_empty() || segment == "." {
            continue;
        }
        if segment == ".." {
            resolved.pop();
        } else {
            resolved.push(segment);
        }
    }
    resolved.join("/")
}

pub fn parse_relationships(xml: &str) -> BTreeMap<String, Relationship> {
    let mut result = BTreeMap::new();
    let mut cursor = 0usize;
    while let Some((start, attrs_source, inner_start, _)) =
        crate::xmlutil::find_open_tag(xml, "Relationship", cursor)
    {
        let attrs = attributes(&attrs_source);
        if let (Some(id), Some(target), Some(relation_type)) =
            (attrs.get("Id"), attrs.get("Target"), attrs.get("Type"))
        {
            result.insert(
                id.clone(),
                Relationship {
                    id: id.clone(),
                    target: target.clone(),
                    target_mode: attrs.get("TargetMode").cloned(),
                    relation_type: relation_type.clone(),
                },
            );
        }
        cursor = if cursor == start { start + 1 } else { inner_start.max(start + 1) };
    }
    result
}

pub(crate) fn read_relationships(
    archive: &OoxmlArchive,
    owner_part: &str,
    diagnostics: &mut Vec<Diagnostic>,
    sheet_id: &str,
) -> BTreeMap<String, Relationship> {
    let part = relationships_part(owner_part);
    if !archive.has(&part) {
        return BTreeMap::new();
    }
    let Ok(xml) = archive.text(&part) else {
        return BTreeMap::new();
    };
    match crate::xmlutil::assert_well_formed_xml(&xml, &part) {
        Ok(()) => parse_relationships(&xml),
        Err(message) => {
            diagnostics.push(Diagnostic {
                address: None,
                code: "xlsx.relationships.malformed".to_string(),
                message,
                part: Some(part),
                severity: "warning",
                sheet_id: Some(sheet_id.to_string()),
            });
            BTreeMap::new()
        }
    }
}

/// WHATWG-normalized href for the protocols the engine surfaces.
pub(crate) fn safe_external_target(target: &str) -> Option<String> {
    let url = url::Url::parse(target).ok()?;
    match url.scheme() {
        "http" | "https" | "mailto" | "tel" => Some(url.as_str().to_string()),
        _ => None,
    }
}

fn local_text(source: &str, name: &str) -> Option<f64> {
    // <(?:[\w.-]+:)?name\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?name>
    let value = prefixed_element_inner(source, name)?;
    let cleaned = decode_xml(&strip_markup(&value));
    crate::jsnumber::parse(cleaned.trim())
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

/// First paired block whose open or close tag carries an arbitrary namespace
/// prefix, returning the inner content.
fn prefixed_element_inner(source: &str, name: &str) -> Option<String> {
    let lower = source.to_ascii_lowercase();
    let bytes = lower.as_bytes();
    let wanted = name.to_ascii_lowercase();
    let is_name_byte =
        |byte: u8| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'_' | b':');
    let mut position = 0usize;
    while let Some(found) = lower[position..].find('<') {
        let start = position + found;
        let tag_start = start + 1;
        if bytes.get(tag_start) == Some(&b'/') {
            position = tag_start;
            continue;
        }

        let mut tag_end = tag_start;
        while tag_end < bytes.len() && is_name_byte(bytes[tag_end]) {
            tag_end += 1;
        }
        if tag_end == tag_start
            || lower[tag_start..tag_end].rsplit(':').next() != Some(wanted.as_str())
        {
            position = tag_start;
            continue;
        }

        // Scan to the end of the opening tag, ignoring `>` inside quoted attributes.
        let mut cursor = tag_end;
        let mut quote = None;
        while cursor < bytes.len() {
            match bytes[cursor] {
                b'\'' | b'"' if quote.is_none() => quote = Some(bytes[cursor]),
                byte if quote == Some(byte) => quote = None,
                b'>' if quote.is_none() => break,
                _ => {}
            }
            cursor += 1;
        }
        if cursor >= bytes.len() {
            return None;
        }
        let inner_start = cursor + 1;
        if source[tag_start..cursor].trim_end().ends_with('/') {
            return Some(String::new());
        }

        // Find the closing tag with the same prefix: </prefix:name>.
        let close_needle = format!("</{}>", &lower[tag_start..tag_end]);
        if let Some(close) = lower[inner_start..].find(&close_needle) {
            let close_start = inner_start + close;
            return Some(source[inner_start..close_start].to_string());
        }
        return None;
    }
    None
}

fn anchor_point(source: &str) -> Option<AnchorPoint> {
    let column = local_text(source, "col")?;
    let row = local_text(source, "row")?;
    if column < 0.0 || row < 0.0 {
        return None;
    }
    Some(AnchorPoint {
        column: column as u32 + 1,
        column_offset_emu: local_text(source, "colOff").unwrap_or(0.0),
        row: row as u32 + 1,
        row_offset_emu: local_text(source, "rowOff").unwrap_or(0.0),
    })
}

fn child_block(source: &str, name: &str) -> Option<String> {
    prefixed_element_inner(source, name)
}

fn singleton_attributes(source: &str, name: &str) -> BTreeMap<String, String> {
    // <(?:[\w.-]+:)?name\b([^>]*)\/?> — a naive scan to the first '>'.
    let lower = source.to_ascii_lowercase();
    let needle = format!("<{name}");
    let mut position = 0usize;
    while let Some(found) = lower[position..].find(&needle) {
        let start = position + found;
        let after = lower.as_bytes().get(start + needle.len());
        let boundary = after.is_none_or(|byte| !byte.is_ascii_alphanumeric() && *byte != b'_');
        if boundary {
            let bytes = source.as_bytes();
            let mut cursor = start + needle.len();
            while cursor < bytes.len() && bytes[cursor] != b'>' {
                cursor += 1;
            }
            if cursor >= bytes.len() {
                return BTreeMap::new();
            }
            let attrs = attributes(&source[start + needle.len()..cursor]);
            return attrs;
        }
        position = start + 1;
    }
    BTreeMap::new()
}

fn number_or_nan(value: Option<&str>) -> f64 {
    value.and_then(crate::jsnumber::parse).unwrap_or(f64::NAN)
}

fn finite(values: &[f64]) -> bool {
    values.iter().all(|value| value.is_finite())
}

fn parse_anchor(kind: &str, source: &str) -> Option<ObjectAnchor> {
    let extent = singleton_attributes(source, "ext");
    if kind == "absolute" {
        let position = singleton_attributes(source, "pos");
        let values = [
            number_or_nan(position.get("x").map(String::as_str)),
            number_or_nan(position.get("y").map(String::as_str)),
            number_or_nan(extent.get("cx").map(String::as_str)),
            number_or_nan(extent.get("cy").map(String::as_str)),
        ];
        if !finite(&values) {
            return None;
        }
        return Some(ObjectAnchor::Absolute {
            position: Point2D { x_emu: values[0], y_emu: values[1] },
            size: Size { height_emu: values[3], width_emu: values[2] },
        });
    }
    let from = anchor_point(&child_block(source, "from")?)?;
    if kind == "two-cell" {
        let to = anchor_point(&child_block(source, "to")?);
        return to.map(|to| ObjectAnchor::TwoCell { from, to });
    }
    let cx = number_or_nan(extent.get("cx").map(String::as_str));
    let cy = number_or_nan(extent.get("cy").map(String::as_str));
    if !(cx.is_finite() && cy.is_finite()) {
        return None;
    }
    Some(ObjectAnchor::OneCell { from, size: Size { height_emu: cy, width_emu: cx } })
}

struct AnchorMatch {
    kind: &'static str,
    body: (usize, usize),
}

/// Find anchored drawing objects in document order with the same-prefix
/// backreference semantics of the engine's anchor expression.
fn anchor_matches(xml: &str) -> Vec<AnchorMatch> {
    const KINDS: [&str; 3] = ["twoCellAnchor", "oneCellAnchor", "absoluteAnchor"];
    let lower = xml.to_ascii_lowercase();
    let bytes = lower.as_bytes();
    let is_name_byte =
        |byte: u8| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'_');
    let mut result = Vec::new();
    let mut position = 0usize;
    while position <= lower.len() {
        // Earliest candidate across the three anchor kinds.
        let mut best: Option<(usize, &'static str)> = None;
        for kind in KINDS {
            let needle = kind.to_ascii_lowercase();
            let mut cursor = position;
            while let Some(found) = lower[cursor..].find(&needle) {
                let start = cursor + found;
                // Boundary after the kind name.
                let after_ok = bytes
                    .get(start + needle.len())
                    .is_none_or(|byte| !(*byte == b'_' || byte.is_ascii_alphanumeric()));
                if !after_ok {
                    cursor = start + 1;
                    continue;
                }
                // Walk back over [\w.-]+; accept either '<name' or a
                // namespace-prefixed '<prefix:name'.
                let mut scan = start;
                while scan > 0 && is_name_byte(bytes[scan - 1]) {
                    scan -= 1;
                }
                if !(scan > 0 && (bytes[scan - 1] == b':' || bytes[scan - 1] == b'<')) {
                    cursor = start + 1;
                    continue;
                }
                if best.is_none_or(|(best_start, _)| start < best_start) {
                    best = Some((start, kind));
                }
                break;
            }
        }
        let Some((start, kind)) = best else { break };
        // Reconstruct the full namespace prefix ("xdr:") for the closing tag.
        let mut scan = start;
        while scan > 0 && is_name_byte(bytes[scan - 1]) {
            scan -= 1;
        }
        let prefix_start = if scan > 0 && bytes[scan - 1] == b':' {
            let colon = scan - 1;
            let mut prefix = colon;
            while prefix > 0 && is_name_byte(bytes[prefix - 1]) {
                prefix -= 1;
            }
            prefix
        } else {
            start
        };
        let prefix_end = start;
        // End of the opening tag.
        let mut attr_cursor = start + kind.len();
        while attr_cursor < bytes.len() && bytes[attr_cursor] != b'>' {
            attr_cursor += 1;
        }
        if attr_cursor >= bytes.len() {
            break;
        }
        let inner_start = attr_cursor + 1;
        let close_needle =
            format!("</{}{}", &lower[prefix_start..prefix_end], kind.to_ascii_lowercase());
        match lower[inner_start..].find(&close_needle) {
            Some(close) => {
                let close_start = inner_start + close;
                result.push(AnchorMatch {
                    kind: match kind {
                        "twoCellAnchor" => "two-cell",
                        "oneCellAnchor" => "one-cell",
                        _ => "absolute",
                    },
                    body: (inner_start, close_start),
                });
                position = close_start + close_needle.len();
            }
            None => position = inner_start,
        }
    }
    result
}

fn chart_diagnostics(chart: &Chart, part: &str, sheet_id: &str) -> Vec<Diagnostic> {
    let mut diagnostics = Vec::new();
    let mut formulas: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
    for group in &chart.groups {
        for series in &group.series {
            for source in [series.categories.as_ref(), Some(&series.values)] {
                let Some(source) = source else { continue };
                let ChartReferenceShape::Opaque { formula } = opaque_formula(source) else {
                    continue;
                };
                if !formulas.insert(formula.clone()) {
                    continue;
                }
                diagnostics.push(Diagnostic {
                    address: None,
                    code: "xlsx.chart.reference.unsupported".to_string(),
                    message: format!(
                        "Chart data uses an unsupported reference expression and will use its authored cache: {formula}"
                    ),
                    part: Some(part.to_string()),
                    severity: "warning",
                    sheet_id: Some(sheet_id.to_string()),
                });
            }
        }
    }
    diagnostics
}

enum ChartReferenceShape {
    Opaque { formula: String },
    Other,
}

fn opaque_formula(source: &crate::model::ChartDataSource) -> ChartReferenceShape {
    match &source.reference {
        Some(crate::model::ChartReference::Opaque { formula }) => {
            ChartReferenceShape::Opaque { formula: formula.clone() }
        }
        _ => ChartReferenceShape::Other,
    }
}

fn diagnostic(
    code: &str,
    message: impl Into<String>,
    part: Option<String>,
    sheet_id: &str,
) -> Diagnostic {
    Diagnostic {
        address: None,
        code: code.to_string(),
        message: message.into(),
        part,
        severity: "warning",
        sheet_id: Some(sheet_id.to_string()),
    }
}

fn drawing_objects(
    archive: &OoxmlArchive,
    diagnostics: &mut Vec<Diagnostic>,
    drawing_part: &str,
    sheet_id: &str,
) -> Vec<SpreadsheetObject> {
    if !archive.has(drawing_part) {
        diagnostics.push(diagnostic(
            "xlsx.drawing.missing",
            format!("Drawing part is missing: {drawing_part}"),
            Some(drawing_part.to_string()),
            sheet_id,
        ));
        return vec![SpreadsheetObject {
            anchor: None,
            chart: None,
            id: format!("{sheet_id}:{drawing_part}:missing"),
            kind: "drawing",
            name: None,
            relationship_target: drawing_part.to_string(),
            sheet_id: sheet_id.to_string(),
        }];
    }
    let Ok(xml) = archive.text(drawing_part) else {
        return Vec::new();
    };
    if let Err(message) = crate::xmlutil::assert_well_formed_xml(&xml, drawing_part) {
        diagnostics.push(diagnostic(
            "xlsx.drawing.malformed",
            message,
            Some(drawing_part.to_string()),
            sheet_id,
        ));
        return vec![SpreadsheetObject {
            anchor: None,
            chart: None,
            id: format!("{sheet_id}:{drawing_part}:malformed"),
            kind: "drawing",
            name: None,
            relationship_target: drawing_part.to_string(),
            sheet_id: sheet_id.to_string(),
        }];
    }
    let relationships = read_relationships(archive, drawing_part, diagnostics, sheet_id);
    let mut objects = Vec::new();
    for (index, anchor) in anchor_matches(&xml).into_iter().enumerate() {
        let index = index + 1;
        if index > MAX_PROJECTED_OBJECTS {
            diagnostics.push(diagnostic(
                "xlsx.drawing.too-many-objects",
                format!(
                    "Drawing part exceeds the {MAX_PROJECTED_OBJECTS} object projection limit."
                ),
                Some(drawing_part.to_string()),
                sheet_id,
            ));
            break;
        }
        let body = &xml[anchor.body.0..anchor.body.1];
        let chart_relationship_id = relationship_reference(body, "chart", "r:id");
        let image_relationship_id = relationship_reference(body, "blip", "r:embed");
        let relationship_id = chart_relationship_id.as_ref().or(image_relationship_id.as_ref());
        let relationship = relationship_id.and_then(|id| relationships.get(id));
        let kind = if chart_relationship_id.is_some() {
            "chart"
        } else if image_relationship_id.is_some() {
            "image"
        } else {
            "drawing"
        };
        let non_visual = singleton_attributes(body, "cNvPr");
        let parsed_anchor = parse_anchor(anchor.kind, body);
        if parsed_anchor.is_none() {
            diagnostics.push(diagnostic(
                "xlsx.drawing.anchor",
                format!(
                    "Drawing object {} has incomplete {} anchor metadata.",
                    non_visual.get("name").cloned().unwrap_or_else(|| index.to_string()),
                    anchor.kind
                ),
                Some(drawing_part.to_string()),
                sheet_id,
            ));
        }
        if let (Some(relationship_id), None) = (&relationship_id, relationship) {
            diagnostics.push(diagnostic(
                "xlsx.drawing.relationship",
                format!("Drawing object references missing relationship {relationship_id}."),
                Some(relationships_part(drawing_part)),
                sheet_id,
            ));
        }
        let chart_part = if kind == "chart" {
            relationship
                .map(|relationship| resolve_part(&directory(drawing_part), &relationship.target))
        } else {
            None
        };
        let chart = chart_part
            .as_ref()
            .filter(|part| archive.has(part))
            .and_then(|part| archive.text(part).ok())
            .zip(chart_part.clone())
            .and_then(|(text, part)| parse_chart(&part, &text));
        if let (Some(chart), Some(part)) = (&chart, &chart_part) {
            diagnostics.extend(chart_diagnostics(chart, part, sheet_id));
        } else if kind == "chart" {
            diagnostics.push(diagnostic(
                "xlsx.chart.unavailable",
                if chart_part.is_some() {
                    "The chart part could not be projected and was preserved without blocking the worksheet."
                } else {
                    "The chart relationship target is missing and was preserved without blocking the worksheet."
                },
                Some(chart_part.unwrap_or_else(|| drawing_part.to_string())),
                sheet_id,
            ));
        }
        objects.push(SpreadsheetObject {
            anchor: parsed_anchor,
            chart,
            id: format!(
                "{sheet_id}:{drawing_part}:{}",
                non_visual.get("id").cloned().unwrap_or_else(|| index.to_string())
            ),
            kind,
            name: non_visual.get("name").filter(|name| !name.is_empty()).cloned(),
            relationship_target: relationship
                .map(|relationship| resolve_part(&directory(drawing_part), &relationship.target))
                .unwrap_or_else(|| drawing_part.to_string()),
            sheet_id: sheet_id.to_string(),
        });
    }
    objects
}

/// The value of an attribute like `r:id` on a prefix-agnostic `<tag>` element
/// inside `body`, mirroring the engine's regex.
fn relationship_reference(body: &str, tag: &str, attribute: &str) -> Option<String> {
    let lower = body.to_ascii_lowercase();
    let bytes = lower.as_bytes();
    let is_name_byte =
        |byte: u8| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'_');
    let needle = tag.to_ascii_lowercase();
    let mut cursor = 0usize;
    while let Some(found) = lower[cursor..].find(&needle) {
        let start = cursor + found;
        // Boundary after the tag name.
        if bytes
            .get(start + needle.len())
            .is_some_and(|byte| *byte == b'_' || byte.is_ascii_alphanumeric())
        {
            cursor = start + 1;
            continue;
        }
        // Optional namespace prefix before the tag name, opened by '<'.
        let mut scan = start;
        while scan > 0 && is_name_byte(bytes[scan - 1]) {
            scan -= 1;
        }
        if scan == 0 {
            cursor = start + 1;
            continue;
        }
        if bytes[scan - 1] == b':' {
            let mut prefix = scan - 1;
            while prefix > 0 && is_name_byte(bytes[prefix - 1]) {
                prefix -= 1;
            }
            if !(prefix > 0 && bytes[prefix - 1] == b'<') {
                cursor = start + 1;
                continue;
            }
        } else if bytes[scan - 1] != b'<' {
            cursor = start + 1;
            continue;
        }
        // Scan to the end of the opening tag and read its attributes.
        let mut attr_cursor = start + needle.len();
        while attr_cursor < bytes.len() && bytes[attr_cursor] != b'>' {
            attr_cursor += 1;
        }
        if attr_cursor >= bytes.len() {
            return None;
        }
        let attrs = attributes(&body[scan..attr_cursor]);
        if let Some(value) = attrs.get(attribute).filter(|value| !value.is_empty()) {
            return Some(value.clone());
        }
        cursor = start + 1;
    }
    None
}

pub fn project_worksheet_objects(
    archive: &OoxmlArchive,
    sheet_id: &str,
    sheet_part: &str,
    sheet_xml: &str,
) -> WorksheetProjection {
    let mut diagnostics = Vec::new();
    let relationships = read_relationships(archive, sheet_part, &mut diagnostics, sheet_id);

    let mut hyperlinks: std::collections::BTreeMap<(u32, u32), Hyperlink> =
        std::collections::BTreeMap::new();
    let mut hyperlink_count: u64 = 0;
    let mut surfaced_hyperlink_count: u64 = 0;
    let mut cursor = 0usize;
    while let Some((start, attrs_source, inner_start, _)) =
        crate::xmlutil::find_open_tag(sheet_xml, "hyperlink", cursor)
    {
        hyperlink_count += 1;
        let attrs = attributes(&attrs_source);
        let mut link: Option<Hyperlink> = None;
        if let Some(location) = attrs.get("location").filter(|value| !value.is_empty()) {
            link = Some(Hyperlink {
                kind: "internal",
                target: location.clone(),
                tooltip: attrs.get("tooltip").cloned(),
            });
        } else if let Some(relationship_id) = attrs.get("r:id") {
            let relationship = relationships.get(relationship_id);
            let target =
                relationship.map(|rel| safe_external_target(&rel.target)).unwrap_or_else(|| None);
            let external = relationship.is_some_and(|rel| {
                rel.relation_type.ends_with("/hyperlink")
                    && rel.target_mode.as_deref() == Some("External")
            });
            if external && let Some(target) = target {
                link = Some(Hyperlink {
                    kind: "external",
                    target,
                    tooltip: attrs.get("tooltip").cloned(),
                });
            }
        }
        let Some(link) = link else {
            diagnostics.push(diagnostic(
                "xlsx.hyperlink.unsafe",
                format!(
                    "Hyperlink {} has no safe surfaced target.",
                    attrs
                        .get("ref")
                        .filter(|value| !value.is_empty())
                        .cloned()
                        .unwrap_or_else(|| hyperlink_count.to_string())
                ),
                Some(sheet_part.to_string()),
                sheet_id,
            ));
            cursor = inner_start.max(start + 1);
            continue;
        };
        let reference = attrs.get("ref").cloned();
        match place_hyperlink(&mut hyperlinks, reference.as_deref(), link) {
            Ok(()) => surfaced_hyperlink_count += 1,
            Err(()) => {
                diagnostics.push(diagnostic(
                    "xlsx.hyperlink.reference",
                    format!(
                        "Hyperlink has an invalid cell reference: {}.",
                        reference.unwrap_or_else(|| "missing".to_string())
                    ),
                    Some(sheet_part.to_string()),
                    sheet_id,
                ));
            }
        }
        cursor = inner_start.max(start + 1);
    }

    let mut objects = Vec::new();
    let mut cursor = 0usize;
    while let Some((start, attrs_source, inner_start, _)) =
        crate::xmlutil::find_open_tag(sheet_xml, "drawing", cursor)
    {
        let attrs = attributes(&attrs_source);
        let relationship_id = attrs.get("r:id").cloned();
        let relationship = relationship_id.as_deref().and_then(|id| relationships.get(id));
        let ok = relationship.is_some_and(|rel| rel.relation_type.ends_with("/drawing"));
        if !ok {
            diagnostics.push(diagnostic(
                "xlsx.drawing.relationship",
                format!(
                    "Worksheet drawing relationship is unavailable: {}.",
                    relationship_id.unwrap_or_else(|| "missing".to_string())
                ),
                Some(relationships_part(sheet_part)),
                sheet_id,
            ));
        } else {
            let target = resolve_part(
                &directory(sheet_part),
                &relationship.map(|rel| rel.target.clone()).unwrap_or_default(),
            );
            objects.extend(drawing_objects(archive, &mut diagnostics, &target, sheet_id));
        }
        cursor = inner_start.max(start + 1);
    }

    WorksheetProjection {
        diagnostics,
        hyperlinks: hyperlinks.into_iter().collect(),
        hyperlink_count,
        surfaced_hyperlink_count,
        objects,
    }
}

fn place_hyperlink(
    hyperlinks: &mut std::collections::BTreeMap<(u32, u32), Hyperlink>,
    reference: Option<&str>,
    link: Hyperlink,
) -> Result<(), ()> {
    let Some(reference) = reference else {
        return Err(());
    };
    let range = parse_range_address(reference).map_err(|_| ())?;
    let cell_count =
        (range.bottom - range.top + 1) as usize * (range.right - range.left + 1) as usize;
    if cell_count > MAX_PROJECTED_HYPERLINK_CELLS {
        return Err(());
    }
    for row in range.top..=range.bottom {
        for column in range.left..=range.right {
            hyperlinks.insert(
                (row, column),
                Hyperlink {
                    kind: link.kind,
                    target: link.target.clone(),
                    tooltip: link.tooltip.clone(),
                },
            );
            if hyperlinks.len() > MAX_PROJECTED_HYPERLINK_CELLS {
                return Err(());
            }
        }
    }
    Ok(())
}
