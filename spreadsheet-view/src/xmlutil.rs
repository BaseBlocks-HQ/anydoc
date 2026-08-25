//! String-level XML scanning utilities mirroring the regex semantics of the
//! TypeScript engine, plus entity decoding and well-formedness validation.

use std::collections::BTreeMap;

/// Decode numeric and named character references like `decodeXml`.
pub fn decode_xml(value: &str) -> String {
    let mut result = String::with_capacity(value.len());
    let mut rest = value;
    while let Some(ampersand) = rest.find('&') {
        result.push_str(&rest[..ampersand]);
        rest = &rest[ampersand..];
        match decode_entity(rest) {
            Some((decoded, consumed)) => {
                result.push_str(&decoded);
                rest = &rest[consumed..];
            }
            None => {
                result.push('&');
                rest = &rest[1..];
            }
        }
    }
    result.push_str(rest);
    result
}

/// Decode a single entity at the start of `source`, returning the replacement
/// text and the consumed byte length, or `None` when the leading `&` is not an
/// entity reference.
fn decode_entity(source: &str) -> Option<(String, usize)> {
    let rest = source.strip_prefix('&')?;
    if let Some(digits) = rest.strip_prefix('#') {
        let (radix, digits) = if digits.starts_with('x') || digits.starts_with('X') {
            (16, &digits[1..])
        } else {
            (10, digits)
        };
        let end = digits.find(';')?;
        let text = &digits[..end];
        if text.is_empty() || !text.chars().all(|c| c.is_digit(radix)) {
            return None;
        }
        let code = u32::from_str_radix(text, radix).ok()?;
        return Some((
            char::from_u32(code).unwrap_or('\u{FFFD}').to_string(),
            source.len() - digits.len() + end + 1,
        ));
    }
    for (name, replacement) in
        [("amp", "&"), ("lt", "<"), ("gt", ">"), ("quot", "\""), ("apos", "'")]
    {
        if rest.len() >= name.len()
            && rest[..name.len()].eq_ignore_ascii_case(name)
            && rest.as_bytes().get(name.len()) == Some(&b';')
        {
            return Some((replacement.to_string(), name.len() + 2));
        }
    }
    None
}

/// Parse `attribute` sources into a map, mirroring the engine's `attributes`.
pub fn attributes(source: &str) -> BTreeMap<String, String> {
    let mut result = BTreeMap::new();
    let bytes = source.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        // Name: [\w:.-]+
        if !is_name_byte(bytes[index]) {
            index += 1;
            continue;
        }
        let name_start = index;
        while index < bytes.len() && is_name_byte(bytes[index]) {
            index += 1;
        }
        let name = &source[name_start..index];
        // \s*=\s*
        let mut cursor = index;
        while cursor < bytes.len() && (bytes[cursor] as char).is_whitespace() {
            cursor += 1;
        }
        if cursor >= bytes.len() || bytes[cursor] != b'=' {
            index = name_start + 1;
            continue;
        }
        cursor += 1;
        while cursor < bytes.len() && (bytes[cursor] as char).is_whitespace() {
            cursor += 1;
        }
        // (["'])([\s\S]*?)\2
        let quote = match bytes.get(cursor) {
            Some(&q) if q == b'"' || q == b'\'' => q,
            _ => {
                index = name_start + 1;
                continue;
            }
        };
        cursor += 1;
        let value_start = cursor;
        let value_end = loop {
            match bytes.get(cursor) {
                Some(&q) if q == quote => break cursor,
                Some(_) => cursor += 1,
                None => {
                    index = name_start + 1;
                    break value_start;
                }
            }
        };
        if bytes.get(value_end) != Some(&quote) {
            continue;
        }
        result.insert(name.to_string(), decode_xml(&source[value_start..value_end]));
        index = value_end + 1;
    }
    result
}

fn is_name_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() | matches!(byte, b'_' | b':' | b'.' | b'-')
}

/// Case-insensitive search for the next opening tag of `tag` starting at or
/// after `from`. Returns `(match_start, attributes_source, inner_start,
/// self_closing)` where `inner_start` indexes past `>`.
pub fn find_open_tag(source: &str, tag: &str, from: usize) -> Option<(usize, String, usize, bool)> {
    let haystack = source.to_ascii_lowercase();
    let needle = format!("<{}", tag.to_ascii_lowercase());
    let mut position = from;
    while let Some(found) = haystack[position..].find(&needle) {
        let start = position + found;
        let mut cursor = start + needle.len();
        let boundary = haystack.as_bytes().get(cursor);
        // The regex requires a non-name-character boundary after the tag name.
        let ok_boundary =
            boundary.is_none_or(|byte| !(byte.is_ascii_alphanumeric() | matches!(byte, b'_')));
        if ok_boundary {
            let attrs_start = cursor;
            let bytes = source.as_bytes();
            while cursor < bytes.len() {
                match bytes[cursor] {
                    b'"' | b'\'' => {
                        let quote = bytes[cursor];
                        cursor += 1;
                        while cursor < bytes.len() && bytes[cursor] != quote {
                            cursor += 1;
                        }
                        // Step past the closing quote itself.
                        cursor += 1;
                    }
                    b'>' => break,
                    _ => cursor += 1,
                }
            }
            if cursor >= source.len() {
                return None;
            }
            let attributes = source[attrs_start..cursor].to_string();
            let trimmed = attributes.trim_end();
            let self_closing = trimmed.ends_with('/');
            return Some((start, attributes, cursor + 1, self_closing));
        }
        position = start + 1;
    }
    None
}

/// Case-insensitive search for the closing tag `</tag>` starting at `from`,
/// returning the index just past it.
pub fn find_close_tag(source: &str, tag: &str, from: usize) -> Option<usize> {
    let haystack = source.to_ascii_lowercase();
    let needle = format!("</{}>", tag.to_ascii_lowercase());
    haystack[from..].find(&needle).map(|found| from + found + needle.len())
}

/// The engine's `elementText`: the first `<tag>` block inside `body`, its
/// nested markup stripped, and entities decoded. Case-insensitive.
pub fn element_text(body: &str, tag: &str) -> Option<String> {
    let (_, _, inner_start, self_closing) = find_open_tag(body, tag, 0)?;
    if self_closing {
        return Some(String::new());
    }
    let end = find_close_tag(body, tag, inner_start)?;
    let inner = &body[inner_start..end - tag.chars().count() - 3];
    Some(decode_xml(&strip_tags(inner)))
}

fn strip_tags(source: &str) -> String {
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

/// Validate that `source` is well-formed XML, mirroring the engine's
/// `assertWellFormedXml` gate over every required part.
pub fn assert_well_formed_xml(source: &str, part: &str) -> Result<(), String> {
    let mut reader = quick_xml::Reader::from_str(source);
    reader.config_mut().check_end_names = true;
    let mut buffer = Vec::new();
    loop {
        match reader.read_event_into(&mut buffer) {
            Ok(quick_xml::events::Event::Eof) => return Ok(()),
            Ok(_) => buffer.clear(),
            Err(error) => {
                return Err(format!("Workbook XML part is malformed: {part}. {error}"));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_entities() {
        assert_eq!(decode_xml("a&amp;b"), "a&b");
        assert_eq!(decode_xml("&#65;&#x42;"), "AB");
        assert_eq!(decode_xml("unknown &nbsp; stays"), "unknown &nbsp; stays");
        assert_eq!(decode_xml("&AMP;"), "&");
    }

    #[test]
    fn parses_attribute_sources() {
        let attrs = attributes(r#" r:id="rId1" single='it&apos;s' bare=zz "#);
        assert_eq!(attrs.get("r:id").map(String::as_str), Some("rId1"));
        assert_eq!(attrs.get("single").map(String::as_str), Some("it's"));
        assert_eq!(attrs.len(), 2);
    }

    #[test]
    fn extracts_element_text() {
        assert_eq!(
            element_text("<c r=\"A1\"><f>B2*2</f><v>12</v></c>", "v"),
            Some("12".to_string())
        );
        assert_eq!(element_text("<V x=\"1\">hi</V>", "v"), Some("hi".to_string()));
        assert_eq!(element_text("<t/>", "t"), Some(String::new()));
    }
}
