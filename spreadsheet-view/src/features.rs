//! Feature manifest and diagnostics mirroring `engine.ts#featureManifest`.

use crate::archive::OoxmlArchive;
use crate::model::{Diagnostic, Feature};

pub struct SheetFeatureInput {
    pub objects: Vec<crate::model::SpreadsheetObject>,
    pub pivot_tables: usize,
    pub tables: usize,
    pub conditional_formats: usize,
    pub data_validations: usize,
    /// Raw `<conditionalFormatting` tag occurrences in the sheet XML.
    pub conditional_formatting_tag_count: u64,
    /// Raw `<dataValidation` tag occurrences in the sheet XML.
    pub data_validation_tag_count: u64,
    pub hyperlink_count: u64,
    pub surfaced_hyperlink_count: u64,
}

fn matches_suffix(name: &str, suffix: &str) -> bool {
    name.len() >= suffix.len() && name.ends_with(suffix)
}

/// Build the feature manifest exactly as the engine ordered it.
pub fn feature_manifest(
    archive: &OoxmlArchive,
    sheets: &[SheetFeatureInput],
    workbook_xml: &str,
) -> Vec<Feature> {
    let names = archive.names();
    // Insertion order defines output order; mirrors the engine's Map.
    let mut counts: Vec<(&'static str, u64)> = Vec::new();
    let mut editable: std::collections::BTreeMap<&str, u64> = std::collections::BTreeMap::new();
    let mut renderable: std::collections::BTreeMap<&str, u64> = std::collections::BTreeMap::new();

    let set = |counts: &mut Vec<(&'static str, u64)>, id: &'static str, count: u64| {
        if count > 0 && !counts.iter().any(|(existing, _)| *existing == id) {
            counts.push((id, count));
        } else if count > 0
            && let Some(entry) = counts.iter_mut().find(|(existing, _)| *existing == id)
        {
            entry.1 = count;
        }
    };

    let chart_objects: usize = sheets
        .iter()
        .flat_map(|sheet| sheet.objects.iter())
        .filter(|object| object.kind == "chart")
        .count();
    let charts_with_models = sheets
        .iter()
        .flat_map(|sheet| sheet.objects.iter())
        .filter(|object| object.kind == "chart" && object.chart.is_some())
        .count();
    set(&mut counts, "charts", chart_objects as u64);
    editable.insert("charts", charts_with_models as u64);
    renderable.insert("charts", charts_with_models as u64);

    set(
        &mut counts,
        "comments",
        names
            .iter()
            .filter(|name| {
                matches_suffix(name, ".xml")
                    && name.rfind("xl/comments").is_some_and(|index| {
                        let tail = &name[index + "xl/comments".len()..];
                        tail.strip_suffix(".xml").is_some_and(|digits| {
                            !digits.is_empty() && digits.chars().all(|c| c.is_ascii_digit())
                        })
                    })
            })
            .count() as u64,
    );
    set(
        &mut counts,
        "drawings",
        names
            .iter()
            .filter(|name| {
                name.starts_with("xl/drawings/drawing")
                    && name.ends_with(".xml")
                    && name["xl/drawings/drawing".len()..name.len() - 4]
                        .chars()
                        .all(|c| c.is_ascii_digit())
            })
            .count() as u64,
    );
    let image_count = sheets
        .iter()
        .flat_map(|sheet| sheet.objects.iter())
        .filter(|object| object.kind == "image")
        .count();
    set(&mut counts, "images", image_count as u64);
    set(
        &mut counts,
        "external-links",
        names
            .iter()
            .filter(|name| name.starts_with("xl/externalLinks/") && name.ends_with(".xml"))
            .count() as u64,
    );
    set(
        &mut counts,
        "macros",
        names.iter().filter(|name| name.ends_with("vbaProject.bin")).count() as u64,
    );
    let pivot_part_count = names
        .iter()
        .filter(|name| {
            name.starts_with("xl/pivotTables/pivotTable")
                && name.ends_with(".xml")
                && name["xl/pivotTables/pivotTable".len()..name.len() - 4]
                    .chars()
                    .all(|c| c.is_ascii_digit())
        })
        .count();
    let typed_pivot_count: usize = sheets.iter().map(|sheet| sheet.pivot_tables).sum();
    set(&mut counts, "pivot-tables", pivot_part_count.max(typed_pivot_count) as u64);
    editable.insert("pivot-tables", typed_pivot_count as u64);
    renderable.insert("pivot-tables", typed_pivot_count as u64);
    let table_part_count = names.iter().filter(|name| name.starts_with("xl/tables/")).count();
    let typed_table_count: usize = sheets.iter().map(|sheet| sheet.tables).sum();
    set(&mut counts, "tables", table_part_count.max(typed_table_count) as u64);
    editable.insert("tables", typed_table_count as u64);
    renderable.insert("tables", typed_table_count as u64);
    set(
        &mut counts,
        "defined-names",
        crate::worksheet::count_tag_occurrences(workbook_xml, "definedName"),
    );
    let typed_conditional_count: usize = sheets.iter().map(|sheet| sheet.conditional_formats).sum();
    // The engine counted `<conditionalFormatting` occurrences across the
    // concatenated original sheet XML, which equals the per-sheet sum here.
    let total_conditional_tags: u64 =
        sheets.iter().map(|sheet| sheet.conditional_formatting_tag_count).sum();
    set(
        &mut counts,
        "conditional-formatting",
        total_conditional_tags.max(typed_conditional_count as u64),
    );
    editable.insert("conditional-formatting", typed_conditional_count as u64);
    renderable.insert("conditional-formatting", typed_conditional_count as u64);
    let typed_validation_count: usize = sheets.iter().map(|sheet| sheet.data_validations).sum();
    let total_validation_tags: u64 =
        sheets.iter().map(|sheet| sheet.data_validation_tag_count).sum();
    set(&mut counts, "data-validation", total_validation_tags.max(typed_validation_count as u64));
    editable.insert("data-validation", typed_validation_count as u64);
    renderable.insert("data-validation", typed_validation_count as u64);
    let hyperlinks: u64 = sheets.iter().map(|sheet| sheet.hyperlink_count).sum();
    set(&mut counts, "hyperlinks", hyperlinks);
    let surfaced: u64 = sheets.iter().map(|sheet| sheet.surfaced_hyperlink_count).sum();
    renderable.insert("hyperlinks", surfaced);

    counts
        .into_iter()
        .map(|(id, count)| Feature {
            count,
            editable_count: count.min(editable.get(id).copied().unwrap_or(0)),
            id,
            renderable_count: count.min(renderable.get(id).copied().unwrap_or(0)),
            round_trip_preserved: true,
        })
        .collect()
}

/// Warnings for features that are preserved but not fully editable or
/// renderable, mirroring `featureDiagnostics`.
pub fn feature_diagnostics(features: &[Feature]) -> Vec<Diagnostic> {
    features
        .iter()
        .filter(|feature| {
            feature.editable_count < feature.count || feature.renderable_count < feature.count
        })
        .map(|feature| Diagnostic {
            address: None,
            code: format!("xlsx.feature.{}", feature.id),
            message: format!(
                "{} {} object(s) are preserved; {} are editable and {} are renderable.",
                feature.count, feature.id, feature.editable_count, feature.renderable_count
            ),
            part: None,
            severity: "warning",
            sheet_id: None,
        })
        .collect()
}
