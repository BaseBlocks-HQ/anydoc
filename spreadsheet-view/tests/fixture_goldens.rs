use serde_json::Value;
use spreadsheet_view::limits::{
    DEFAULT_MAX_CELLS, DEFAULT_MAX_ENTRIES, DEFAULT_MAX_INPUT_BYTES, DEFAULT_MAX_PART_BYTES,
    DEFAULT_MAX_UNCOMPRESSED_BYTES, ResolvedLimits,
};

fn default_limits() -> ResolvedLimits {
    ResolvedLimits {
        max_entries: DEFAULT_MAX_ENTRIES,
        max_input_bytes: DEFAULT_MAX_INPUT_BYTES,
        max_part_bytes: DEFAULT_MAX_PART_BYTES,
        max_uncompressed_bytes: DEFAULT_MAX_UNCOMPRESSED_BYTES,
        max_cells: DEFAULT_MAX_CELLS,
    }
}

fn normalize(value: &mut Value) {
    match value {
        Value::Number(number) => {
            if let Some(f) = number.as_f64()
                && f.fract() == 0.0
                && f.abs() < 9_007_199_254_740_992.0
            {
                *value = Value::from(f as i64);
            }
        }
        Value::Array(items) => items.iter_mut().for_each(normalize),
        Value::Object(map) => map.values_mut().for_each(normalize),
        _ => {}
    }
}

fn fixture(name: &str) -> Vec<u8> {
    std::fs::read(format!(
        "/Users/naaiyy/Developer/BaseBlocks-HQ/Any Doc/tests/fixtures/xlsx/{name}"
    ))
    .expect("fixture")
}

fn golden(name: &str) -> Value {
    serde_json::from_str(
        &std::fs::read_to_string(format!(
            "/Users/naaiyy/Developer/BaseBlocks-HQ/Any Doc/packages/viewer/test/goldens/xlsx-{name}.json"
        ))
        .expect("golden"),
    )
    .unwrap()
}

#[test]
fn sheet_xlsx_matches_golden_metadata() {
    let model =
        spreadsheet_view::workbook::open(&fixture("sheet.xlsx"), &default_limits()).unwrap();
    let golden = golden("sheet.xlsx");
    assert_eq!(model.date_system, "1900");
    let metadata_sheets = golden["metadata"]["sheets"].as_array().unwrap();
    let query_sheets = golden["sheets"].as_array().unwrap();
    assert_eq!(model.sheets.len(), metadata_sheets.len());
    for (index, sheet) in model.sheets.iter().enumerate() {
        let meta = &metadata_sheets[index];
        let expected = &query_sheets[index];
        assert_eq!(serde_json::to_value(&sheet.id).unwrap(), meta["id"]);
        assert_eq!(serde_json::to_value(&sheet.name).unwrap(), meta["name"]);
        assert_eq!(serde_json::to_value(sheet.used_range).unwrap(), meta["usedRange"], "usedRange");
        let cells = expected["readRange"]["cells"].as_array().unwrap();
        for cell in cells {
            let address = cell["address"].as_str().unwrap();
            let found = sheet
                .cells
                .iter()
                .find(|c| c.address == address)
                .unwrap_or_else(|| panic!("cell {address} missing"));
            let mut actual = serde_json::to_value(found).unwrap();
            normalize(&mut actual);
            assert_eq!(actual, *cell, "cell {address}");
        }
        assert_eq!(
            serde_json::to_value(&sheet.rendered_charts).unwrap(),
            expected["readCharts"],
            "charts"
        );
        assert_eq!(
            serde_json::to_value(sheet.columns.default_size).unwrap(),
            meta["columns"]["defaultSize"]
        );
        assert_eq!(
            sheet.rows.hidden.len(),
            meta["rows"]["hidden"].as_array().map(|a| a.len()).unwrap_or(0)
        );
    }
}

#[test]
fn merged_xlsx_matches_golden() {
    let model =
        spreadsheet_view::workbook::open(&fixture("handmade-merged.xlsx"), &default_limits())
            .unwrap();
    let golden = golden("handmade-merged.xlsx");
    assert_eq!(
        model.diagnostics.is_empty(),
        golden["metadata"]["diagnostics"].as_array().unwrap().is_empty()
    );
    assert_eq!(model.sheets[0].merges.len(), 2);
    let cells = golden["sheets"][0]["readRange"]["cells"].as_array().unwrap();
    for cell in cells {
        let address = cell["address"].as_str().unwrap();
        let found = model.sheets[0]
            .cells
            .iter()
            .find(|c| c.address == address)
            .unwrap_or_else(|| panic!("cell {address} missing"));
        assert_eq!(serde_json::to_value(found).unwrap(), *cell, "cell {address}");
    }
}
