use serde::Deserialize;
use wasm_bindgen::prelude::*;

pub const DEFAULT_MAX_ENTRIES: u64 = 10_000;
pub const DEFAULT_MAX_INPUT_BYTES: u64 = 100 * 1024 * 1024;
pub const DEFAULT_MAX_PART_BYTES: u64 = 32 * 1024 * 1024;
pub const DEFAULT_MAX_UNCOMPRESSED_BYTES: u64 = 250 * 1024 * 1024;
pub const DEFAULT_MAX_CELLS: u64 = 100_000;

#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct RawLimits {
    max_entries: Option<f64>,
    max_input_bytes: Option<f64>,
    max_part_bytes: Option<f64>,
    max_uncompressed_bytes: Option<f64>,
    max_cells: Option<f64>,
}

#[derive(Clone, Copy)]
pub struct ResolvedLimits {
    pub max_entries: u64,
    pub max_input_bytes: u64,
    pub max_part_bytes: u64,
    pub max_uncompressed_bytes: u64,
    pub max_cells: u64,
}

fn number(value: Option<f64>) -> Option<u64> {
    let value = value?;
    if !value.is_finite() || value < 0.0 || value.fract() != 0.0 {
        return None;
    }
    Some(value as u64)
}

impl ResolvedLimits {
    pub fn from_value(value: JsValue) -> Result<Self, JsValue> {
        let raw: RawLimits = if value.is_undefined() || value.is_null() {
            RawLimits::default()
        } else {
            serde_wasm_bindgen::from_value(value)
                .map_err(|error| crate::error(error.to_string()))?
        };
        Ok(Self {
            max_entries: number(raw.max_entries).unwrap_or(DEFAULT_MAX_ENTRIES),
            max_input_bytes: number(raw.max_input_bytes).unwrap_or(DEFAULT_MAX_INPUT_BYTES),
            max_part_bytes: number(raw.max_part_bytes).unwrap_or(DEFAULT_MAX_PART_BYTES),
            max_uncompressed_bytes: number(raw.max_uncompressed_bytes)
                .unwrap_or(DEFAULT_MAX_UNCOMPRESSED_BYTES),
            max_cells: number(raw.max_cells).unwrap_or(DEFAULT_MAX_CELLS),
        })
    }
}
