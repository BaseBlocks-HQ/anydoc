//! ZIP archive reading under the engine's resource limits.

use std::collections::HashSet;
use std::io::Read;

/// A fully expanded, limit-checked workbook archive.
pub struct OoxmlArchive {
    parts: std::collections::BTreeMap<String, Vec<u8>>,
}

fn unsafe_path(name: &str) -> bool {
    name.starts_with('/')
        || name.starts_with('\\')
        || name.split(['\\', '/']).any(|part| part == "..")
}

impl OoxmlArchive {
    pub fn open(bytes: &[u8], limits: &crate::limits::ResolvedLimits) -> Result<Self, String> {
        if bytes.is_empty() {
            return Err("Workbook is empty.".to_string());
        }
        if bytes.len() as u64 > limits.max_input_bytes {
            return Err("Workbook exceeds the compressed size limit.".to_string());
        }
        let reader = std::io::Cursor::new(bytes);
        let mut zip = zip::ZipArchive::new(reader)
            .map_err(|error| format!("Workbook could not be read: {error}"))?;
        if zip.len() as u64 > limits.max_entries {
            return Err("Workbook contains too many ZIP entries.".to_string());
        }
        let mut total: u64 = 0;
        let mut seen = HashSet::new();
        let mut parts = std::collections::BTreeMap::new();
        for index in 0..zip.len() {
            let mut entry = zip.by_index(index).map_err(|error| error.to_string())?;
            let name = entry.name().to_string();
            if entry.is_dir() {
                continue;
            }
            if unsafe_path(&name) {
                return Err(format!("Workbook contains an unsafe ZIP path: {name}"));
            }
            if entry.encrypted() {
                return Err("Encrypted workbooks are not supported.".to_string());
            }
            if !seen.insert(name.clone()) {
                return Err(format!("Workbook contains a duplicate ZIP entry: {name}"));
            }
            if entry.size() > limits.max_part_bytes {
                return Err(format!("Workbook part exceeds the size limit: {name}"));
            }
            total += entry.size();
            if total > limits.max_uncompressed_bytes {
                return Err("Workbook exceeds the expanded size limit.".to_string());
            }
            let mut data = Vec::with_capacity(entry.size() as usize);
            entry.read_to_end(&mut data).map_err(|error| error.to_string())?;
            if data.len() as u64 > limits.max_part_bytes {
                return Err(format!("Workbook part exceeds the size limit: {name}"));
            }
            total += data.len() as u64 - entry.size();
            if total > limits.max_uncompressed_bytes {
                return Err("Workbook exceeds the expanded size limit.".to_string());
            }
            parts.insert(name, data);
        }
        Ok(Self { parts })
    }

    pub fn has(&self, name: &str) -> bool {
        self.parts.contains_key(name)
    }

    /// Sorted part names, mirroring `archive.names()`.
    pub fn names(&self) -> Vec<&str> {
        self.parts.keys().map(String::as_str).collect()
    }

    pub fn text(&self, name: &str) -> Result<String, String> {
        let data = self.part(name)?;
        Ok(String::from_utf8_lossy(data).into_owned())
    }

    pub fn part(&self, name: &str) -> Result<&Vec<u8>, String> {
        self.parts.get(name).ok_or_else(|| format!("Workbook part is missing: {name}"))
    }
}
