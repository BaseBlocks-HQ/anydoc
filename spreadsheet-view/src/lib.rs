//! Read-only XLSX and CSV workbook model parser for the AnyDoc viewer.
//!
//! The crate owns every fact about a spreadsheet document: it enforces the
//! archive, part, cell, and string limits at `open`, resolves styles and
//! number/date display strings, projects drawings and charts, and serializes
//! the complete workbook model across the Wasm boundary exactly once.

pub mod archive;
pub mod charts;
pub mod coordinates;
pub mod csv;
pub mod display;
pub mod features;
pub mod jsnumber;
pub mod limits;
pub mod model;
pub mod objects;
pub mod styles;
pub mod workbook;
pub mod worksheet;
pub mod xmlutil;

use serde::Serialize;
use wasm_bindgen::prelude::*;

fn to_js_value<T: Serialize>(value: &T) -> Result<JsValue, JsValue> {
    // JSON-shaped output: absent values arrive as null so the session adapter
    // sees a stable shape.
    value
        .serialize(&serde_wasm_bindgen::Serializer::new().serialize_missing_as_null(true))
        .map_err(|error| js_sys::Error::new(&error.to_string()).into())
}

/// Parse an XLSX workbook into the complete read-only workbook model.
///
/// `limits` is a plain object with optional `maxEntries`, `maxInputBytes`,
/// `maxPartBytes`, `maxUncompressedBytes`, and `maxCells` numbers; missing
/// fields fall back to the same defaults the TypeScript engine enforced.
///
/// Throws when the archive violates a limit or a required OOXML part is
/// missing, malformed, or unreadable; error messages mirror the engine that
/// this crate replaces.
#[wasm_bindgen(js_name = openWorkbook)]
pub fn open_workbook(bytes: &[u8], limits: JsValue) -> Result<JsValue, JsValue> {
    let resolved = limits::ResolvedLimits::from_value(limits)?;
    let model = workbook::open(bytes, &resolved)?;
    to_js_value(&model)
}

/// Parse CSV bytes into the single-sheet workbook model the viewer renders.
///
/// Applies the CSV byte, row, column, cell, and character caps and mirrors the
/// delimiter sniffing and BOM handling of the previous parser.
#[wasm_bindgen(js_name = parseCsvBytes)]
pub fn parse_csv_bytes(bytes: &[u8], limits: JsValue) -> Result<JsValue, JsValue> {
    let resolved = limits::ResolvedLimits::from_value(limits)?;
    let model = csv::parse(bytes, &resolved)?;
    to_js_value(&model)
}

pub(crate) fn error(message: impl AsRef<str>) -> JsValue {
    JsValue::from_str(message.as_ref())
}
