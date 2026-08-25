//! CSV parsing mirroring `parseCsv` in the engine's read session: BOM
//! handling, delimiter sniffing, and identical limit semantics.

use crate::limits::ResolvedLimits;
use crate::model::{Axis, Cell, Range, Scalar, Sheet, WorkbookModel};
use crate::xmlutil::decode_xml;

const MAX_CSV_BYTES: u64 = 25 * 1024 * 1024;
const MAX_CSV_ROWS: usize = 100_000;
const MAX_CSV_COLUMNS: usize = 100;
const MAX_CSV_CELLS: u64 = 100_000;
const MAX_CSV_CELL_CHARACTERS: usize = 1_000_000;

/// Decode bytes like `decodeCsv`: UTF-16 BOMs first, then lossy UTF-8.
fn decode_csv(bytes: &[u8]) -> String {
    if bytes.first() == Some(&0xff) && bytes.get(1) == Some(&0xfe) {
        return decode_utf16(&bytes[2..], true);
    }
    if bytes.first() == Some(&0xfe) && bytes.get(1) == Some(&0xff) {
        return decode_utf16(&bytes[2..], false);
    }
    let offset = if bytes.starts_with(&[0xef, 0xbb, 0xbf]) { 3 } else { 0 };
    String::from_utf8_lossy(&bytes[offset..]).into_owned()
}

/// WHATWG UTF-16 decoding with replacement for ill-formed sequences.
fn decode_utf16(bytes: &[u8], little_endian: bool) -> String {
    let units: Vec<u16> = bytes
        .chunks_exact(2)
        .map(|pair| {
            if little_endian {
                u16::from_le_bytes([pair[0], pair[1]])
            } else {
                u16::from_be_bytes([pair[0], pair[1]])
            }
        })
        .collect();
    String::from_utf16_lossy(&units)
}

/// Score a delimiter like `delimiterScore`: mode count times frequency over
/// the first lines.
fn delimiter_score(source: &str, delimiter: char) -> u64 {
    let mut counts: Vec<u64> = Vec::new();
    let mut count: u64 = 0;
    let mut quoted = false;
    let characters: Vec<char> = source.chars().collect();
    let mut index = 0usize;
    while index < characters.len() && counts.len() < 20 {
        let character = characters[index];
        if character == '"' {
            if quoted && characters.get(index + 1) == Some(&'"') {
                index += 1;
            } else {
                quoted = !quoted;
            }
        } else if !quoted && character == delimiter {
            count += 1;
        } else if !quoted && character == '\n' {
            if count > 0 {
                counts.push(count);
            }
            count = 0;
        }
        index += 1;
    }
    if count > 0 {
        counts.push(count);
    }
    if counts.is_empty() {
        return 0;
    }
    // Mode by frequency, ties broken by the larger count.
    let mut frequencies: std::collections::BTreeMap<u64, u64> = std::collections::BTreeMap::new();
    for value in &counts {
        *frequencies.entry(*value).or_insert(0) += 1;
    }
    frequencies
        .into_iter()
        .max_by(|(left_count, left_frequency), (right_count, right_frequency)| {
            right_frequency.cmp(left_frequency).then(right_count.cmp(left_count))
        })
        .map(|(mode, frequency)| mode * frequency)
        .unwrap_or(0)
}

fn sniff_delimiter(source: &str) -> char {
    let best = [',', ';', '\t'].into_iter().reduce(|best, candidate| {
        if delimiter_score(source, candidate) > delimiter_score(source, best) {
            candidate
        } else {
            best
        }
    });
    best.unwrap_or(',')
}

pub fn parse(bytes: &[u8], limits: &ResolvedLimits) -> Result<WorkbookModel, String> {
    let max_bytes = MAX_CSV_BYTES.min(limits.max_input_bytes);
    let max_cells = MAX_CSV_CELLS.min(limits.max_cells);
    if bytes.len() as u64 > max_bytes {
        return Err("CSV input exceeds the byte limit.".to_string());
    }
    let source = decode_csv(bytes);
    let delimiter = sniff_delimiter(&source);

    let characters: Vec<char> = source.chars().collect();
    let mut rows: Vec<Vec<String>> = vec![Vec::new()];
    let mut value = String::new();
    let mut quoted = false;
    let mut cell_count: u64 = 0;
    macro_rules! commit_cell {
        () => {{
            if value.chars().count() > MAX_CSV_CELL_CHARACTERS {
                return Err("CSV cell is too large.".to_string());
            }
            let row = rows.last_mut().ok_or("CSV parser state is invalid.")?;
            if row.len() >= MAX_CSV_COLUMNS {
                return Err("CSV exceeds the 100 column limit.".to_string());
            }
            row.push(std::mem::take(&mut value));
            cell_count += 1;
            if cell_count > max_cells {
                return Err("CSV exceeds the configured cell limit.".to_string());
            }
        }};
    }

    let mut index = 0usize;
    while index < characters.len() {
        let character = characters[index];
        if quoted {
            if character == '"' && characters.get(index + 1) == Some(&'"') {
                value.push('"');
                index += 1;
            } else if character == '"' {
                quoted = false;
            } else {
                value.push(character);
            }
        } else if character == '"' && value.is_empty() {
            quoted = true;
        } else if character == delimiter {
            commit_cell!();
        } else if character == '\n' {
            commit_cell!();
            if rows.len() >= MAX_CSV_ROWS {
                return Err("CSV exceeds the 100,000 row limit.".to_string());
            }
            rows.push(Vec::new());
        } else if character != '\r' {
            value.push(character);
        }
        index += 1;
    }
    if quoted {
        return Err("CSV contains an unterminated quoted field.".to_string());
    }
    commit_cell!();
    if rows.last().is_some_and(|row| row.iter().all(|cell| cell.is_empty())) {
        rows.pop();
    }

    let mut cells: Vec<Cell> = Vec::new();
    let mut right: usize = 0;
    for (row_index, row) in rows.iter().enumerate() {
        right = right.max(row.len());
        for (column_index, display_value) in row.iter().enumerate() {
            if display_value.is_empty() {
                continue;
            }
            let row_number = row_index as u32 + 1;
            let column = column_index as u32 + 1;
            cells.push(Cell {
                address: crate::coordinates::cell_address(row_number, column)?,
                column,
                display_value: display_value.clone(),
                formula: None,
                formula_result: None,
                hyperlink: None,
                row: row_number,
                style: Default::default(),
                value: Scalar::Text(display_value.clone()),
            });
        }
    }
    let used_range = if !rows.is_empty() {
        Some(Range { bottom: rows.len() as u32, left: 1, right: right as u32, top: 1 })
    } else {
        None
    };
    Ok(WorkbookModel {
        date_system: "1900",
        diagnostics: Vec::new(),
        features: Vec::new(),
        objects: Vec::new(),
        sheets: vec![Sheet {
            cells,
            conditional_formats: Vec::new(),
            columns: Axis { default_size: 12.0, hidden: Vec::new(), sizes: Vec::new() },
            data_validations: Vec::new(),
            frozen_columns: 0.0,
            frozen_rows: 0.0,
            hidden: false,
            id: "csv-sheet-1".to_string(),
            merges: Vec::new(),
            name: "CSV".to_string(),
            objects: Vec::new(),
            pivot_tables: Vec::new(),
            rows: Axis { default_size: 20.0, hidden: Vec::new(), sizes: Vec::new() },
            show_grid_lines: true,
            tables: Vec::new(),
            used_range,
            rendered_charts: Vec::new(),
        }],
    })
}

// Silence unused-import lint when decode_xml is only used in future ports.
#[allow(unused)]
fn _unused(value: &str) -> String {
    decode_xml(value)
}
