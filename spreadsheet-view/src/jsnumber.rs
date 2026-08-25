//! JavaScript `Number` semantics the display layer depends on.
//!
//! The engine this crate replaces parsed cell text with `Number(...)` and
//! rendered values with `String(...)`. Both are reproduced here exactly:
//! `parse` implements the ECMAScript `StringToNumber` grammar, and
//! `to_js_string` implements `Number::toString`, including the switch to
//! exponential notation outside 1e-7..1e21.

/// Parse a string with ECMAScript `Number(value)` semantics. Returns `None`
/// for `NaN`; infinities are returned as such so callers can apply the same
/// `isFinite` fallbacks the TypeScript engine applied.
pub fn parse(source: &str) -> Option<f64> {
    let trimmed = trim_js_whitespace(source);
    if trimmed.is_empty() {
        return Some(0.0);
    }
    let (negative, rest) = match trimmed.as_bytes()[0] {
        b'+' => (false, &trimmed[1..]),
        b'-' => (true, &trimmed[1..]),
        _ => (false, trimmed),
    };
    if rest == "Infinity" {
        return Some(if negative { f64::NEG_INFINITY } else { f64::INFINITY });
    }
    if rest.len() > 2 {
        let prefix = rest[..2].to_ascii_lowercase();
        let digits = &rest[2..];
        match prefix.as_str() {
            "0x" => return parse_radix(digits, 16).map(|value| apply_sign(negative, value)),
            "0o" => return parse_radix(digits, 8).map(|value| apply_sign(negative, value)),
            "0b" => return parse_radix(digits, 2).map(|value| apply_sign(negative, value)),
            _ => {}
        }
    }
    parse_decimal(trimmed)
}

fn apply_sign(negative: bool, value: f64) -> f64 {
    if negative { -value } else { value }
}

fn parse_radix(digits: &str, radix: u32) -> Option<f64> {
    if digits.is_empty() {
        return None;
    }
    let mut value = 0_u128;
    for character in digits.chars() {
        let digit = character.to_digit(radix)?;
        value = value.checked_mul(radix as u128)?.checked_add(digit as u128)?;
    }
    Some(value as f64)
}
fn parse_decimal(source: &str) -> Option<f64> {
    let (negative, unsigned) = match source.as_bytes().first()? {
        b'+' => (false, &source[1..]),
        b'-' => (true, &source[1..]),
        _ => (false, source),
    };
    let bytes = unsigned.as_bytes();
    let mut index = 0;
    let integer_start = index;
    while index < bytes.len() && bytes[index].is_ascii_digit() {
        index += 1;
    }
    let has_integer = index > integer_start;
    let mut fraction_digits = 0usize;
    if index < bytes.len() && bytes[index] == b'.' {
        index += 1;
        let start = index;
        while index < bytes.len() && bytes[index].is_ascii_digit() {
            index += 1;
        }
        fraction_digits = index - start;
        if !has_integer && fraction_digits == 0 {
            return None;
        }
    } else if !has_integer {
        return None;
    }
    let mantissa_end = index;
    let mut exponent: i32 = 0;
    if index < bytes.len() && (bytes[index] | 0x20) == b'e' {
        index += 1;
        let negative_exponent = match bytes.get(index) {
            Some(b'+') => {
                index += 1;
                false
            }
            Some(b'-') => {
                index += 1;
                true
            }
            _ => false,
        };
        let start = index;
        while index < bytes.len() && bytes[index].is_ascii_digit() {
            index += 1;
        }
        if index == start {
            return None;
        }
        let magnitude: i32 = unsigned[start..index].parse().ok()?;
        exponent = if negative_exponent { magnitude.saturating_mul(-1) } else { magnitude };
    }
    if index != bytes.len() {
        return None;
    }

    let mantissa_text: String =
        unsigned[..mantissa_end].chars().filter(|character| character.is_ascii_digit()).collect();
    let significant = mantissa_text.trim_start_matches('0');
    if significant.is_empty() {
        return Some(0.0);
    }
    // The value equals the digit string read as an integer, scaled by
    // 10^(point − length): leading zeros shift nothing because they only pad
    // the integer side.
    let point = mantissa_text.len() as i32 - fraction_digits as i32 + exponent;
    let adjusted = point - mantissa_text.len() as i32;
    let value: f64 = format!("{significant}e{adjusted}").parse().ok()?;
    Some(apply_sign(negative, value))
}

fn trim_js_whitespace(source: &str) -> &str {
    source.trim_matches(|character: char| {
        matches!(
            character,
            '\t' | '\n'
                | '\u{000B}'
                | '\u{000C}'
                | '\r'
                | ' '
                | '\u{00A0}'
                | '\u{1680}'
                | '\u{2000}'
                ..='\u{200A}'
                    | '\u{2028}'
                    | '\u{2029}'
                    | '\u{202F}'
                    | '\u{205F}'
                    | '\u{3000}'
                    | '\u{FEFF}'
        )
    })
}

/// Render a finite number exactly like ECMAScript `Number.prototype.toString`.
pub fn to_js_string(value: f64) -> String {
    debug_assert!(value.is_finite());
    if value == 0.0 {
        return "0".to_string();
    }
    let negative = value < 0.0;
    // Rust's LowerExp prints the shortest round-trip representation.
    let scientific = format!("{:e}", value.abs());
    let (mantissa, exponent_text) = scientific.split_once('e').expect("LowerExp format");
    let exponent: i32 = exponent_text.parse().expect("exponent");
    let digits: String = mantissa.chars().filter(|c| c.is_ascii_digit()).collect();
    // n is the position of the decimal point relative to the digit string:
    // value == 0.digits * 10^n.
    let k = digits.len() as i32;
    let n = exponent + 1;
    let mut result = String::new();
    if negative {
        result.push('-');
    }
    if k <= n && n <= 21 {
        result.push_str(&digits);
        for _ in 0..(n - k) {
            result.push('0');
        }
    } else if 0 < n && n <= 21 {
        result.push_str(&digits[..n as usize]);
        result.push('.');
        result.push_str(&digits[n as usize..]);
    } else if -6 < n && n <= 0 {
        result.push_str("0.");
        for _ in 0..(-n) {
            result.push('0');
        }
        result.push_str(&digits);
    } else {
        result.push_str(&digits[..1]);
        if k > 1 {
            result.push('.');
            result.push_str(&digits[1..]);
        }
        result.push('e');
        let magnitude = n - 1;
        if magnitude >= 0 {
            result.push('+');
        } else {
            result.push('-');
        }
        result.push_str(&(magnitude.abs()).to_string());
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_like_javascript_number() {
        assert_eq!(parse(""), Some(0.0));
        assert_eq!(parse(" 42 "), Some(42.0));
        assert_eq!(parse("0x1A"), Some(26.0));
        assert_eq!(parse("-Infinity"), Some(f64::NEG_INFINITY));
        assert_eq!(parse("1e3"), Some(1000.0));
        assert_eq!(parse(".5"), Some(0.5));
        assert_eq!(parse("5."), Some(5.0));
        assert_eq!(parse("0.155"), Some(0.155));
        assert_eq!(parse("46096"), Some(46096.0));
        assert_eq!(parse(".5"), Some(0.5));
        assert_eq!(parse("007"), Some(7.0));
        assert_eq!(parse("-1.5e-2"), Some(-0.015));
        assert_eq!(parse("abc"), None);
        assert_eq!(parse("1.2.3"), None);
        assert_eq!(parse(""), Some(0.0));
    }

    #[test]
    fn renders_like_javascript_to_string() {
        assert_eq!(to_js_string(4e-7), "4e-7");
        assert_eq!(to_js_string(0.000001), "0.000001");
        assert_eq!(to_js_string(1234.5), "1234.5");
        assert_eq!(to_js_string(1e21), "1e+21");
        assert_eq!(to_js_string(9876543.0), "9876543");
        assert_eq!(to_js_string(0.155), "0.155");
        assert_eq!(to_js_string(-3.5), "-3.5");
        assert_eq!(to_js_string(1.10434027777778), "1.10434027777778");
    }
}
