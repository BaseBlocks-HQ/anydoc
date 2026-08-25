//! The workbook model serialized across the Wasm boundary.
//!
//! Shapes mirror the TypeScript viewer types exactly: `SpreadsheetCell`,
//! `SpreadsheetSheet` metadata, `SpreadsheetRenderedChart`, diagnostics,
//! features, and the axis structures whose `Set`/`Map` fields arrive as arrays
//! and entry pairs for the worker adapter to reconstruct.

use serde::Serialize;

pub type Color = String;

#[derive(Serialize, Clone, PartialEq)]
#[serde(untagged)]
pub enum Scalar {
    Null,
    Bool(bool),
    Number(f64),
    Text(String),
}

impl Scalar {
    pub fn as_number(&self) -> Option<f64> {
        match self {
            Scalar::Number(value) => Some(*value),
            _ => None,
        }
    }

    pub fn is_null(&self) -> bool {
        matches!(self, Scalar::Null)
    }
}

#[derive(Serialize, Clone, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CellStyle {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub background: Option<Color>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bold: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub border_bottom: Option<Color>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub border_left: Option<Color>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub border_right: Option<Color>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub border_top: Option<Color>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<Color>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_family: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_size: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub horizontal: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub italic: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub number_format: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub underline: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vertical: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wrap_text: Option<bool>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Hyperlink {
    pub kind: &'static str,
    pub target: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tooltip: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Cell {
    pub address: String,
    pub column: u32,
    pub display_value: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub formula: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub formula_result: Option<Scalar>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hyperlink: Option<Hyperlink>,
    pub row: u32,
    pub style: CellStyle,
    pub value: Scalar,
}

#[derive(Serialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Range {
    pub bottom: u32,
    pub left: u32,
    pub right: u32,
    pub top: u32,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Axis {
    pub default_size: f64,
    /// Column or row numbers hidden on this axis.
    pub hidden: Vec<u32>,
    /// `[index, size]` entries overriding the default size.
    pub sizes: Vec<(u32, f64)>,
}

#[derive(Serialize, Clone)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum ConditionalFormat {
    #[serde(rename_all = "camelCase")]
    DuplicateValues { id: String, range: Range, style: CellStyle },
    #[serde(rename_all = "camelCase")]
    UniqueValues { id: String, range: Range, style: CellStyle },
    #[serde(rename_all = "camelCase")]
    CellIs { formula: Scalar, id: String, operator: &'static str, range: Range, style: CellStyle },
}

#[derive(Serialize, Clone)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ValidationSource {
    Range { formula: String },
    Values { values: Vec<String> },
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DataValidation {
    pub allow_blank: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_title: Option<String>,
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompt: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompt_title: Option<String>,
    pub range: Range,
    pub source: ValidationSource,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Table {
    pub columns: Vec<String>,
    pub id: String,
    pub name: String,
    pub range: Range,
    pub show_filter_buttons: bool,
    pub style: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PivotValue {
    pub field: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    pub summarize_by: &'static str,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PivotTable {
    pub id: String,
    pub name: String,
    pub row_fields: Vec<String>,
    pub source_range: Range,
    pub source_sheet_id: String,
    pub target_range: Range,
    pub values: Vec<PivotValue>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AnchorPoint {
    pub column: u32,
    pub column_offset_emu: f64,
    pub row: u32,
    pub row_offset_emu: f64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Point2D {
    pub x_emu: f64,
    pub y_emu: f64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Size {
    pub height_emu: f64,
    pub width_emu: f64,
}

#[derive(Serialize, Clone)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum ObjectAnchor {
    #[serde(rename_all = "camelCase")]
    OneCell { from: AnchorPoint, size: Size },
    #[serde(rename_all = "camelCase")]
    TwoCell { from: AnchorPoint, to: AnchorPoint },
    #[serde(rename_all = "camelCase")]
    Absolute { position: Point2D, size: Size },
}

#[derive(Serialize, Clone)]
pub struct ChartGroup {
    pub series: Vec<ChartSeries>,
    pub r#type: &'static str,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ChartSeries {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub categories: Option<ChartDataSource>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    pub values: ChartDataSource,
}

#[derive(Serialize, Clone)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ChartReference {
    Areas { areas: Vec<ChartAreaReference>, formula: String },
    Opaque { formula: String },
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ChartAreaReference {
    pub range: Range,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sheet_name: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ChartDataSource {
    pub cache: Vec<Scalar>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reference: Option<ChartReference>,
    pub value_type: &'static str,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Chart {
    pub groups: Vec<ChartGroup>,
    pub id: String,
    pub legend: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SpreadsheetObject {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub anchor: Option<ObjectAnchor>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chart: Option<Chart>,
    pub id: String,
    pub kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    pub relationship_target: String,
    pub sheet_id: String,
}

/// A chart resolved to renderable values against the parsed workbook.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RenderedChart {
    pub chart_id: String,
    pub categories: Vec<String>,
    pub legend: &'static str,
    pub series: Vec<RenderedChartSeries>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    pub r#type: &'static str,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RenderedChartSeries {
    pub name: String,
    pub r#type: &'static str,
    pub values: Vec<f64>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Feature {
    pub count: u64,
    pub editable_count: u64,
    pub id: &'static str,
    pub renderable_count: u64,
    pub round_trip_preserved: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostic {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub address: Option<String>,
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub part: Option<String>,
    pub severity: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sheet_id: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Sheet {
    pub cells: Vec<Cell>,
    pub conditional_formats: Vec<ConditionalFormat>,
    pub columns: Axis,
    pub data_validations: Vec<DataValidation>,
    pub frozen_columns: f64,
    pub frozen_rows: f64,
    pub hidden: bool,
    pub id: String,
    pub merges: Vec<Range>,
    pub name: String,
    pub objects: Vec<SpreadsheetObject>,
    pub pivot_tables: Vec<PivotTable>,
    pub rows: Axis,
    pub show_grid_lines: bool,
    pub tables: Vec<Table>,
    pub used_range: Option<Range>,
    /// Charts resolved at open; the worker serves them from memory.
    pub rendered_charts: Vec<RenderedChart>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WorkbookModel {
    pub date_system: &'static str,
    pub diagnostics: Vec<Diagnostic>,
    pub features: Vec<Feature>,
    pub objects: Vec<SpreadsheetObject>,
    pub sheets: Vec<Sheet>,
}
