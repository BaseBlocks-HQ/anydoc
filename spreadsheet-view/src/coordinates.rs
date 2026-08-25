//! A1 coordinate helpers mirroring the engine's `coordinates.ts`.

use crate::model::Range;

pub const XLSX_MAX_ROWS: u32 = 1_048_576;
pub const XLSX_MAX_COLUMNS: u32 = 16_384;

pub fn cell_key(row: u32, column: u32) -> String {
    format!("{row}:{column}")
}

pub fn assert_coordinate(row: u32, column: u32) -> Result<(), String> {
    if !(1..=XLSX_MAX_ROWS).contains(&row) {
        return Err(format!("Row must be between 1 and {XLSX_MAX_ROWS}."));
    }
    if !(1..=XLSX_MAX_COLUMNS).contains(&column) {
        return Err(format!("Column must be between 1 and {XLSX_MAX_COLUMNS}."));
    }
    Ok(())
}

pub fn column_name(column: u32) -> Result<String, String> {
    assert_coordinate(1, column)?;
    let mut value = column;
    let mut result = String::new();
    while value > 0 {
        let remainder = ((value - 1) % 26) as u8;
        result.insert(0, (b'A' + remainder) as char);
        value = (value - 1) / 26;
    }
    Ok(result)
}

pub fn cell_address(row: u32, column: u32) -> Result<String, String> {
    assert_coordinate(row, column)?;
    Ok(format!("{}{row}", column_name(column)?))
}

/// Parse an absolute-or-relative single cell address like `$AB$12`.
pub fn parse_cell_address(address: &str) -> Result<(u32, u32), String> {
    let trimmed = address.trim();
    let characters: Vec<char> = trimmed.chars().collect();
    let mut index = 0;
    if index < characters.len() && characters[index] == '$' {
        index += 1;
    }
    let letters_start = index;
    while index < characters.len() && characters[index].is_ascii_alphabetic() {
        index += 1;
    }
    let letters_end = index;
    if letters_end == letters_start || letters_end - letters_start > 3 {
        return Err(format!("Invalid cell address: {address}"));
    }
    if index < characters.len() && characters[index] == '$' {
        index += 1;
    }
    let digits_start = index;
    while index < characters.len() && characters[index].is_ascii_digit() {
        index += 1;
    }
    let digit_count = index - digits_start;
    if digit_count == 0 || digit_count > 7 || index != characters.len() {
        return Err(format!("Invalid cell address: {address}"));
    }
    let mut column: u32 = 0;
    for character in &characters[letters_start..letters_end] {
        column = column * 26 + (character.to_ascii_uppercase() as u8 - b'A' + 1) as u32;
    }
    let row: u32 = characters[digits_start..]
        .iter()
        .collect::<String>()
        .parse()
        .map_err(|_| format!("Invalid cell address: {address}"))?;
    assert_coordinate(row, column)?;
    Ok((row, column))
}

/// Parse a range address like `B2:C4` or a single cell into a normalized range.
pub fn parse_range_address(address: &str) -> Result<Range, String> {
    let (start, end) = match address.split_once(':') {
        Some((start, end)) => (start, end),
        None => (address, address),
    };
    if start.is_empty() || end.is_empty() {
        return Err(format!("Invalid range address: {address}"));
    }
    let (first_row, first_column) = parse_cell_address(start)?;
    let (last_row, last_column) = parse_cell_address(end)?;
    Ok(normalize_range(Range {
        bottom: last_row,
        left: first_column,
        right: last_column,
        top: first_row,
    }))
}

pub fn range_address(range: Range) -> Result<String, String> {
    let normalized = normalize_range(range);
    Ok(format!(
        "{}:{}",
        cell_address(normalized.top, normalized.left)?,
        cell_address(normalized.bottom, normalized.right)?
    ))
}

pub fn normalize_range(range: Range) -> Range {
    Range {
        bottom: range.top.max(range.bottom),
        left: range.left.min(range.right),
        right: range.left.max(range.right),
        top: range.top.min(range.bottom),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_addresses() {
        assert_eq!(column_name(1).unwrap(), "A");
        assert_eq!(column_name(26).unwrap(), "Z");
        assert_eq!(column_name(27).unwrap(), "AA");
        assert_eq!(column_name(16_384).unwrap(), "XFD");
        assert_eq!(cell_address(12, 34).unwrap(), "AH12");
        assert_eq!(parse_cell_address("$AH$12").unwrap(), (12, 34));
        assert_eq!(
            parse_range_address("b2:a1").unwrap(),
            Range { bottom: 2, left: 1, right: 2, top: 1 }
        );
        assert_eq!(
            parse_range_address("A1").unwrap(),
            Range { bottom: 1, left: 1, right: 1, top: 1 }
        );
    }
}
