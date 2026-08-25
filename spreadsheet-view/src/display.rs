//! Number and date display formatting.
//!
//! Reproduces `display.ts` exactly: format-section selection, directive
//! stripping, and the en-US `Intl` output patterns for every date/time option
//! combination the formatter can produce, plus ECMAScript number-to-string.

use crate::jsnumber;
use crate::model::{CellStyle, Scalar};

const DAY_MILLISECONDS: i64 = 86_400_000;
const MAXIMUM_DATE_SERIAL: f64 = 2_958_465.0;

fn raw_value(value: &Scalar) -> String {
    match value {
        Scalar::Null => String::new(),
        Scalar::Bool(true) => "TRUE".to_string(),
        Scalar::Bool(false) => "FALSE".to_string(),
        Scalar::Text(text) => text.clone(),
        Scalar::Number(number) => jsnumber::to_js_string(*number),
    }
}

fn strip_format_directives(format: &str) -> String {
    let mut result = String::with_capacity(format.len());
    let characters: Vec<char> = format.chars().collect();
    let mut index = 0;
    while index < characters.len() {
        let character = characters[index];
        if character == '"' {
            // "([^"]|"")*" — a quoted span where "" escapes one quote.
            let mut content = String::new();
            let mut cursor = index + 1;
            let mut terminated = false;
            while cursor < characters.len() {
                if characters[cursor] == '"' {
                    if characters.get(cursor + 1) == Some(&'"') {
                        content.push('"');
                        cursor += 2;
                        continue;
                    }
                    terminated = true;
                    cursor += 1;
                    break;
                }
                content.push(characters[cursor]);
                cursor += 1;
            }
            if terminated {
                result.push_str(&content);
                index = cursor;
                continue;
            }
            result.push(character);
            index += 1;
        } else if character == '[' {
            // \[[^\]]+\]
            if let Some(close) = characters[index..].iter().position(|&c| c == ']')
                && close > 1
            {
                index += close + 1;
                continue;
            }
            result.push(character);
            index += 1;
        } else if character == '_' || character == '\\' || character == '*' {
            // _. | \\(.) | \*(.) → the escaped character itself.
            if let Some(next) = characters.get(index + 1) {
                result.push(*next);
                index += 2;
                continue;
            }
            result.push(character);
            index += 1;
        } else {
            result.push(character);
            index += 1;
        }
    }
    result
}

/// The active positive/negative/zero section of a semicolon-separated format.
fn active_format_section(format: &str, value: f64) -> &str {
    let sections: Vec<&str> = format.split(';').collect();
    if value > 0.0 {
        return sections.first().copied().unwrap_or(format);
    }
    if value < 0.0 {
        return sections.get(1).or(sections.first()).copied().unwrap_or(format);
    }
    sections.get(2).or(sections.first()).copied().unwrap_or(format)
}

fn looks_like_date_format(format: &str) -> bool {
    let normalized: String = strip_format_directives(format)
        .chars()
        .filter(|c| c.is_alphabetic())
        .map(|c| c.to_ascii_lowercase())
        .collect();
    normalized.contains(['d', 'y']) && normalized.contains(['m', 'd', 'y'])
}

struct CivilDate {
    year: i32,
    month: u32,
    day: u32,
}

/// Convert an Excel serial to a UTC civil date using the engine's epoch math.
fn excel_date(value: f64, date_system_1904: bool) -> Option<(CivilDate, u32, u32, u32)> {
    if !value.is_finite() || !(0.0..=MAXIMUM_DATE_SERIAL).contains(&value) {
        return None;
    }
    let epoch_days =
        if date_system_1904 { days_from_civil(1904, 1, 1) } else { days_from_civil(1899, 12, 30) };
    let adjusted = if !date_system_1904 && value < 60.0 { value + 1.0 } else { value };
    // TimeClip truncates the millisecond instant toward zero.
    let total_milliseconds =
        (epoch_days as f64 * DAY_MILLISECONDS as f64 + adjusted * DAY_MILLISECONDS as f64) as i64;
    let days = total_milliseconds.div_euclid(DAY_MILLISECONDS);
    let remainder = total_milliseconds.rem_euclid(DAY_MILLISECONDS) as u32;
    let (year, month, day) = civil_from_days(days);
    Some((
        CivilDate { year, month, day },
        remainder / 3_600_000,
        (remainder % 3_600_000) / 60_000,
        (remainder % 60_000) / 1_000,
    ))
}

/// Days since 1970-01-01 for a proleptic Gregorian date (Howard Hinnant).
fn days_from_civil(year: i32, month: u32, day: u32) -> i64 {
    let y = year as i64 - (month <= 2) as i64;
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let m = month as i64;
    let d = day as i64;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// Inverse of `days_from_civil`.
fn civil_from_days(days: i64) -> (i32, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    ((y + (m <= 2) as i64) as i32, m as u32, d as u32)
}

const MONTHS_LONG: [&str; 12] = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
];
const MONTHS_SHORT: [&str; 12] =
    ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

#[derive(Clone, Copy, PartialEq)]
enum Style {
    Numeric,
    TwoDigit,
    Long,
    Short,
}

fn two_digit(value: u32) -> String {
    format!("{value:02}")
}

/// Render a UTC timestamp with the exact en-US patterns that
/// `Intl.DateTimeFormat` produces for the option combinations the engine
/// builds from a format string.
fn intl_format(
    date: &(CivilDate, u32, u32, u32),
    month_style: Option<Style>,
    day_style: Option<Style>,
    year_style: Option<Style>,
    include_time: bool,
    hour12: bool,
    include_seconds: bool,
) -> String {
    let (civil, hour, minute, second) = date;

    let month_text = match month_style {
        Some(Style::Numeric) => civil.month.to_string(),
        Some(Style::TwoDigit) => two_digit(civil.month),
        Some(Style::Long) => MONTHS_LONG[(civil.month - 1) as usize].to_string(),
        Some(Style::Short) => MONTHS_SHORT[(civil.month - 1) as usize].to_string(),
        None => String::new(),
    };
    let day_text = match day_style {
        Some(Style::Numeric) => civil.day.to_string(),
        Some(Style::TwoDigit) => two_digit(civil.day),
        _ => String::new(),
    };
    let last_two = civil.year.rem_euclid(100) as u32;
    let year_text = match year_style {
        Some(Style::Numeric) => civil.year.to_string(),
        Some(Style::TwoDigit) => two_digit(last_two),
        _ => String::new(),
    };

    let time_text = if include_time {
        if hour12 {
            let meridiem = if *hour >= 12 { "PM" } else { "AM" };
            let display_hour = match hour % 12 {
                0 => 12,
                other => other,
            };
            if include_seconds {
                format!("{:02}:{:02}:{:02} {}", display_hour, minute, second, meridiem)
            } else {
                format!("{:02}:{:02} {}", display_hour, minute, meridiem)
            }
        } else if include_seconds {
            format!("{:02}:{:02}:{:02}", hour, minute, second)
        } else {
            format!("{:02}:{:02}", hour, minute)
        }
    } else {
        String::new()
    };

    let long_month = matches!(month_style, Some(Style::Long));

    let date_part = match (month_style.is_some(), day_style.is_some(), year_style.is_some()) {
        (false, false, _) => format!("{}/{}/{}", civil.month, civil.day, civil.year),
        (true, false, false) => month_text,
        (false, true, false) => day_text,
        (true, true, false) => format!("{month_text}/{day_text}"),
        (true, false, true) => match month_style {
            Some(Style::Long) | Some(Style::Short) => format!("{month_text} {year_text}"),
            _ => format!("{month_text}/{year_text}"),
        },
        (false, true, true) => {
            if matches!(year_style, Some(Style::Numeric)) {
                format!("{year_text} (day: {day_text})")
            } else {
                format!("{day_text} {year_text}")
            }
        }
        (true, true, true) => {
            if matches!(month_style, Some(Style::Long) | Some(Style::Short)) {
                format!("{month_text} {day_text}, {year_text}")
            } else {
                format!("{month_text}/{day_text}/{year_text}")
            }
        }
    };

    if !include_time {
        return date_part;
    }
    if date_part.is_empty() {
        return time_text;
    }
    // ICU joins the date and time with "at" after a spelled-out long month,
    // and with a comma everywhere else.
    if long_month {
        format!("{date_part} at {time_text}")
    } else {
        format!("{date_part}, {time_text}")
    }
}

fn decimal_places(format: &str) -> usize {
    let characters: Vec<char> = format.chars().collect();
    for index in 0..characters.len() {
        if characters[index] == '.' {
            let mut count = 0;
            for character in &characters[index + 1..] {
                if *character == '0' || *character == '#' {
                    count += 1;
                } else {
                    break;
                }
            }
            return count;
        }
    }
    0
}

fn group_digits(digits: &str) -> String {
    let characters: Vec<char> = digits.chars().collect();
    let mut grouped = String::with_capacity(digits.len() + digits.len() / 3);
    for (offset, character) in characters.iter().enumerate() {
        if offset > 0 && (characters.len() - offset).is_multiple_of(3) {
            grouped.push(',');
        }
        grouped.push(*character);
    }
    grouped
}

fn number_display(value: f64, format: &str) -> String {
    let section = active_format_section(format, value);
    let normalized = strip_format_directives(section);
    let percent = normalized.contains('%');
    let scaled = if percent { value * 100.0 } else { value };
    let decimals = decimal_places(&normalized);
    let use_grouping = normalized.contains(',');

    let magnitude = scaled.abs();
    let scale = 10_f64.powi(decimals as i32);
    // Half-expand rounding, matching Intl.NumberFormat's default.
    let rounded = (magnitude * scale + 0.5).floor();
    let mut digits = format!("{:.0}", rounded);
    if decimals > 0 && digits.len() <= decimals {
        let padding = "0".repeat(decimals + 1 - digits.len());
        digits = format!("{padding}{digits}");
    }
    let split = digits.len() - decimals;
    let (integer_part, fraction_part) = digits.split_at(split);
    let integer_text =
        if use_grouping { group_digits(integer_part) } else { integer_part.to_string() };
    let formatted =
        if decimals > 0 { format!("{integer_text}.{fraction_part}") } else { integer_text };

    let literal_prefix: String = normalized
        .chars()
        .filter(|character| {
            !matches!(character, '0' | '#' | '?' | '.' | ',' | '%' | '@' | '(' | ')' | '-' | '+')
                && !character.is_whitespace()
        })
        .filter(|character| !matches!(character.to_ascii_lowercase(), 'd' | 'm' | 'y' | 'h' | 's'))
        .collect();

    let negative = value < 0.0;
    let accounting = negative
        && (section.contains('(')
            || format.split(';').nth(1).is_some_and(|second| second.contains('(')));
    let body = if accounting {
        format!("({formatted})")
    } else if negative {
        format!("-{formatted}")
    } else {
        formatted
    };
    format!("{literal_prefix}{body}{}", if percent { "%" } else { "" })
}

fn format_spreadsheet_value(value: &Scalar, style: &CellStyle, date_system_1904: bool) -> String {
    let number = match value {
        Scalar::Number(number) if number.is_finite() => *number,
        _ => return raw_value(value),
    };
    let format = style.number_format.as_deref().map(str::trim).unwrap_or("General");
    if format.is_empty() || format.eq_ignore_ascii_case("general") {
        return jsnumber::to_js_string(number);
    }
    if looks_like_date_format(format)
        && let Some(displayed) = date_display(number, format, date_system_1904)
    {
        return displayed;
    }
    number_display(number, format)
}

fn contains_char(haystack: &str, needle: char) -> bool {
    haystack.chars().any(|c| c.eq_ignore_ascii_case(&needle))
}

fn date_display(value: f64, format: &str, date_system_1904: bool) -> Option<String> {
    let parsed = excel_date(value, date_system_1904)?;
    let lower = format.to_lowercase();
    let stripped = strip_format_directives(&lower);

    let include_time = contains_char(&stripped, 'h') || contains_char(&stripped, 's');
    let include_seconds = stripped.contains('s');

    let has_day = lower.contains('d');
    let has_month = lower.contains('m');
    let has_year = lower.contains('y');
    let long_month = lower.contains("mmmm");
    let short_month = !long_month && lower.contains("mmm");

    let month_style = if has_month {
        Some(if long_month {
            Style::Long
        } else if short_month {
            Style::Short
        } else if lower.contains("mm") {
            Style::TwoDigit
        } else {
            Style::Numeric
        })
    } else {
        None
    };
    let day_style =
        has_day.then(|| if lower.contains("dd") { Style::TwoDigit } else { Style::Numeric });
    let year_style =
        has_year.then(|| if lower.contains("yyyy") { Style::Numeric } else { Style::TwoDigit });

    Some(intl_format(
        &parsed,
        month_style,
        day_style,
        year_style,
        include_time,
        lower.contains("am/pm"),
        include_seconds,
    ))
}

pub fn cell_display_value(
    formula: Option<&str>,
    formula_result: Option<&Scalar>,
    value: &Scalar,
    style: &CellStyle,
    date_system_1904: bool,
) -> String {
    let effective = if formula.is_some() { formula_result.unwrap_or(&Scalar::Null) } else { value };
    format_spreadsheet_value(effective, style, date_system_1904)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn style_with(format: &str) -> CellStyle {
        CellStyle { number_format: Some(format.to_string()), ..Default::default() }
    }

    #[test]
    fn strips_directives_like_the_engine() {
        assert_eq!(strip_format_directives("[$$-409]#,##0.00"), "#,##0.00");
        assert_eq!(strip_format_directives("\"TRUE\";\"TRUE\";\"FALSE\""), "TRUE;TRUE;FALSE");
        assert_eq!(strip_format_directives("[hh]:mm:ss"), ":mm:ss");
        assert_eq!(strip_format_directives("yyyy\\-mm\\-dd"), "yyyy-mm-dd");
    }

    #[test]
    fn formats_numbers_like_intl_en_us() {
        // Percent scaling happens inside the formatter.
        assert_eq!(number_display(0.155, "0.0%"), "15.5%");
        assert_eq!(number_display(1234.5, "[$$-409]#,##0.00"), "1,234.50");
        assert_eq!(number_display(9876543.0, "#,##0"), "9,876,543");
        assert_eq!(number_display(-50.0, "#,##0.00;(#,##0.00)"), "(50.00)");
    }

    #[test]
    fn formats_dates_like_intl_en_us() {
        // Serial 46096 with yyyy\-mm\-dd renders as the US default pattern.
        assert_eq!(date_display(46096.0, "yyyy\\-mm\\-dd", false), Some("03/15/2026".to_string()));
        // Without d/y tokens the format is numeric, so [hh]:mm:ss renders as
        // literal prefixes plus the grouped integer, matching the engine.
        assert_eq!(
            format_spreadsheet_value(
                &Scalar::Number(1.10434027777778),
                &style_with("[hh]:mm:ss"),
                false
            ),
            "::1"
        );
        // A genuine date+time format goes through Intl: month and day both
        // two-digit, joined to a 24-hour clock with a comma.
        assert_eq!(
            date_display(1.10434027777778, "dd hh:mm:ss", false),
            Some("01/01, 02:30:15".to_string())
        );
    }

    #[test]
    fn renders_general_numbers_like_javascript() {
        assert_eq!(
            format_spreadsheet_value(&Scalar::Number(4e-7), &style_with("General"), false),
            "4e-7"
        );
        assert_eq!(
            format_spreadsheet_value(
                &Scalar::Bool(true),
                &style_with("\"TRUE\";\"TRUE\";\"FALSE\""),
                false
            ),
            "TRUE"
        );
    }
}
