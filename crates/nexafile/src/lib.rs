//! Bounded ZIP containers, checksummed manifests and content-addressed assets.
use base64::{Engine, engine::general_purpose::STANDARD};
use document_model::{Document, ModelError, migrate};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    io::{Cursor, Read, Write},
    sync::atomic::{AtomicBool, Ordering},
};
use thiserror::Error;
use zip::{ZipArchive, ZipWriter, write::SimpleFileOptions};

pub type Parts = BTreeMap<String, Vec<u8>>;
pub const MAX_COMPRESSED: usize = 512 * 1024 * 1024;
pub const MAX_ENTRY: u64 = 256 * 1024 * 1024;
pub const MAX_EXPANDED: u64 = 1024 * 1024 * 1024;
pub const MAX_ENTRIES: usize = 16_384;
pub const MAX_IMAGES: usize = 4_096;

/// Header-only inspection: never allocate decoded pixels for an untrusted image.
pub fn validate_image(bytes: &[u8]) -> Result<imagesize::ImageSize, FileError> {
    if bytes.len() > 32 * 1024 * 1024 {
        return Err(FileError::Invalid("Image exceeds 32 MiB".into()));
    }
    let size = imagesize::blob_size(bytes)
        .map_err(|_| FileError::Invalid("Malformed image header".into()))?;
    if size.width == 0
        || size.height == 0
        || size.width > 16_384
        || size.height > 16_384
        || size.width.saturating_mul(size.height) > 64_000_000
    {
        return Err(FileError::Invalid(
            "Image dimensions exceed safety limits".into(),
        ));
    }
    Ok(size)
}

#[derive(Debug, Error)]
pub enum FileError {
    #[error("The document archive is invalid: {0}")]
    Invalid(String),
    #[error("The operation was cancelled.")]
    Cancelled,
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Zip(#[from] zip::result::ZipError),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error(transparent)]
    Model(#[from] ModelError),
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub format: String,
    pub schema_version: u32,
    pub mime: String,
    pub document_id: String,
    pub editor: String,
    pub editor_version: String,
    pub checksums: BTreeMap<String, String>,
}
pub struct NativeFile {
    pub document: Document,
    pub preserved: Parts,
}
pub fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
pub fn checkpoint(cancel: &AtomicBool) -> Result<(), FileError> {
    if cancel.load(Ordering::Relaxed) {
        Err(FileError::Cancelled)
    } else {
        Ok(())
    }
}
pub fn safe_name(name: &str) -> bool {
    !name.is_empty()
        && !name.starts_with('/')
        && !name.contains('\\')
        && !name.contains(':')
        && !name.contains('\0')
        && name
            .split('/')
            .all(|p| !matches!(p, ".." | ".") && !p.is_empty())
}
pub fn read_zip(bytes: &[u8], cancel: &AtomicBool) -> Result<Parts, FileError> {
    if bytes.len() > MAX_COMPRESSED {
        return Err(FileError::Invalid("Compressed file exceeds 512 MiB".into()));
    }
    let mut zip = ZipArchive::new(Cursor::new(bytes))?;
    if zip.len() > MAX_ENTRIES {
        return Err(FileError::Invalid("Too many archive entries".into()));
    }
    let mut total = 0u64;
    let mut parts = Parts::new();
    for i in 0..zip.len() {
        checkpoint(cancel)?;
        let mut entry = zip.by_index(i)?;
        let name = entry.name().to_string();
        let checked_name = name.trim_end_matches('/');
        if !safe_name(checked_name) || entry.unix_mode().is_some_and(|m| m & 0o170000 == 0o120000) {
            return Err(FileError::Invalid(
                "Unsafe archive entry path or symlink".into(),
            ));
        }
        if entry.is_dir() {
            continue;
        }
        total = total
            .checked_add(entry.size())
            .ok_or_else(|| FileError::Invalid("Archive size overflow".into()))?;
        if total > MAX_EXPANDED
            || entry.size() > MAX_ENTRY
            || (entry.size() > 1024 * 1024
                && entry.size() > entry.compressed_size().saturating_mul(500))
        {
            return Err(FileError::Invalid(
                "Archive decompression limit exceeded".into(),
            ));
        }
        let mut data = Vec::new();
        let mut chunk = [0u8; 65_536];
        loop {
            checkpoint(cancel)?;
            let count = entry.read(&mut chunk)?;
            if count == 0 {
                break;
            }
            if data.len().saturating_add(count) as u64 > MAX_ENTRY {
                return Err(FileError::Invalid("Entry expansion limit exceeded".into()));
            }
            data.extend_from_slice(&chunk[..count]);
        }
        if data.len() as u64 > MAX_ENTRY
            || data.len() as u64 != entry.size()
            || parts.insert(name, data).is_some()
        {
            return Err(FileError::Invalid(
                "Invalid size or duplicate package part".into(),
            ));
        }
    }
    Ok(parts)
}
pub fn write_zip(parts: &Parts, cancel: &AtomicBool) -> Result<Vec<u8>, FileError> {
    if parts.len() > MAX_ENTRIES
        || parts.values().map(|v| v.len() as u64).sum::<u64>() > MAX_EXPANDED
    {
        return Err(FileError::Invalid(
            "Output archive exceeds safety limits".into(),
        ));
    }
    write_zip_inner(parts, cancel, &std::collections::BTreeSet::new())
}
fn write_zip_inner(
    parts: &Parts,
    cancel: &AtomicBool,
    stored: &std::collections::BTreeSet<String>,
) -> Result<Vec<u8>, FileError> {
    let mut zip = ZipWriter::new(Cursor::new(Vec::new()));
    let options = SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .last_modified_time(zip::DateTime::default())
        .unix_permissions(0o600);
    for (name, data) in parts {
        checkpoint(cancel)?;
        if !safe_name(name) || data.len() as u64 > MAX_ENTRY {
            return Err(FileError::Invalid("Unsafe or oversized output part".into()));
        }
        zip.start_file(
            name,
            if stored.contains(name) {
                options.compression_method(zip::CompressionMethod::Stored)
            } else {
                options
            },
        )?;
        for chunk in data.chunks(65_536) {
            checkpoint(cancel)?;
            zip.write_all(chunk)?;
        }
    }
    let bytes = zip.finish()?.into_inner();
    if bytes.len() > MAX_COMPRESSED {
        return Err(FileError::Invalid("Output archive exceeds 512 MiB".into()));
    }
    // A valid, highly repetitive document must not produce a file our own bomb
    // protection refuses to reopen. Store only those exceptional entries verbatim.
    if stored.is_empty() {
        let mut archive = ZipArchive::new(Cursor::new(&bytes))?;
        let mut outliers = std::collections::BTreeSet::new();
        for i in 0..archive.len() {
            let entry = archive.by_index(i)?;
            if entry.size() > 1024 * 1024
                && entry.size() > entry.compressed_size().saturating_mul(500)
            {
                outliers.insert(entry.name().to_owned());
            }
        }
        if !outliers.is_empty() {
            return write_zip_inner(parts, cancel, &outliers);
        }
    }
    Ok(bytes)
}

fn extract_assets(v: &mut Value, parts: &mut Parts) -> Result<(), FileError> {
    match v {
        Value::String(s) if s.starts_with("data:image/") => {
            if let Some((header, payload)) = s.split_once(";base64,") {
                let extension = match header {
                    "data:image/png" => "png",
                    "data:image/jpeg" => "jpg",
                    "data:image/webp" => "webp",
                    _ => return Err(FileError::Invalid("Unsupported embedded image".into())),
                };
                let bytes = STANDARD
                    .decode(payload)
                    .map_err(|_| FileError::Invalid("Invalid image encoding".into()))?;
                validate_image(&bytes)?;
                if parts.len() >= MAX_IMAGES {
                    return Err(FileError::Invalid("Too many image resources".into()));
                }
                let name = format!("assets/{}.{}", digest(&bytes), extension);
                parts.entry(name.clone()).or_insert(bytes);
                *s = format!("asset://{name}");
            }
        }
        Value::Array(a) => {
            for child in a {
                extract_assets(child, parts)?;
            }
        }
        Value::Object(o) => {
            for child in o.values_mut() {
                extract_assets(child, parts)?;
            }
        }
        _ => {}
    }
    Ok(())
}
fn hydrate_assets(v: &mut Value, parts: &Parts) -> Result<(), FileError> {
    match v {
        Value::String(s) if s.starts_with("asset://") => {
            let name = &s[8..];
            if !name.starts_with("assets/") || !safe_name(name) {
                return Err(FileError::Invalid("Invalid asset reference".into()));
            }
            let bytes = parts
                .get(name)
                .ok_or_else(|| FileError::Invalid("Missing asset".into()))?;
            validate_image(bytes)?;
            let mime = if name.ends_with(".png") {
                "png"
            } else if name.ends_with(".jpg") {
                "jpeg"
            } else if name.ends_with(".webp") {
                "webp"
            } else {
                return Err(FileError::Invalid("Unsupported asset type".into()));
            };
            *s = format!("data:image/{mime};base64,{}", STANDARD.encode(bytes));
        }
        Value::Array(a) => {
            for child in a {
                hydrate_assets(child, parts)?;
            }
        }
        Value::Object(o) => {
            for child in o.values_mut() {
                hydrate_assets(child, parts)?;
            }
        }
        _ => {}
    }
    Ok(())
}
pub fn encode(
    document: &Document,
    preserved: &Parts,
    cancel: &AtomicBool,
) -> Result<Vec<u8>, FileError> {
    document.validate()?;
    let mut parts = Parts::new();
    let content = if matches!(document.content, document_model::Content::Sheets { .. }) {
        // Sparse workbooks contain no image objects in V1. Avoid materializing
        // millions of cells as a second generic JSON tree just to look for assets.
        serde_json::to_vec(document)?
    } else {
        let mut content = serde_json::to_value(document)?;
        extract_assets(&mut content, &mut parts)?;
        serde_json::to_vec(&content)?
    };
    parts.insert("content.json".into(), content);
    parts.insert("metadata.json".into(), serde_json::to_vec(&json!({"title":document.title,"createdAt":document.created_at,"modifiedAt":document.modified_at,"revision":document.revision}))?);
    for (name, data) in preserved {
        if !safe_name(name) {
            return Err(FileError::Invalid("Invalid preserved part".into()));
        }
        parts.insert(format!("original/{name}"), data.clone());
    }
    let manifest = Manifest {
        format: "nexa".into(),
        schema_version: 1,
        mime: document.mime().into(),
        document_id: document.id.to_string(),
        editor: "Nexa Office".into(),
        editor_version: env!("CARGO_PKG_VERSION").into(),
        checksums: parts.iter().map(|(k, v)| (k.clone(), digest(v))).collect(),
    };
    parts.insert("manifest.json".into(), serde_json::to_vec(&manifest)?);
    write_zip(&parts, cancel)
}
pub fn decode(bytes: &[u8], cancel: &AtomicBool) -> Result<NativeFile, FileError> {
    let parts = read_zip(bytes, cancel)?;
    let required = |n: &str| {
        parts
            .get(n)
            .ok_or_else(|| FileError::Invalid(format!("Missing {n}")))
    };
    let manifest: Manifest = serde_json::from_slice(required("manifest.json")?)?;
    if manifest.format != "nexa" || manifest.schema_version > 1 {
        return Err(FileError::Invalid(
            "Unsupported native container version".into(),
        ));
    }
    if manifest.checksums.len() != parts.len().saturating_sub(1) {
        return Err(FileError::Invalid(
            "Manifest does not cover all entries".into(),
        ));
    }
    for (name, hash) in &manifest.checksums {
        checkpoint(cancel)?;
        if digest(required(name)?) != *hash {
            return Err(FileError::Invalid(format!(
                "Integrity check failed for {name}"
            )));
        }
    }
    let document =
        if manifest.mime == "application/vnd.nexa.spreadsheet" && manifest.schema_version == 1 {
            let document: Document = serde_json::from_slice(required("content.json")?)?;
            document.validate()?;
            document
        } else {
            let mut content: Value = serde_json::from_slice(required("content.json")?)?;
            hydrate_assets(&mut content, &parts)?;
            migrate(content)?
        };
    if manifest.mime != document.mime() || manifest.document_id != document.id.to_string() {
        return Err(FileError::Invalid("Manifest identity mismatch".into()));
    }
    let preserved = parts
        .into_iter()
        .filter_map(|(n, d)| n.strip_prefix("original/").map(|p| (p.to_string(), d)))
        .collect();
    Ok(NativeFile {
        document,
        preserved,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn all_native_formats_round_trip() -> Result<(), FileError> {
        for kind in ["writer", "sheets", "slides"] {
            let d = Document::new(kind, "Safety first")?;
            let bytes = encode(&d, &Parts::new(), &AtomicBool::new(false))?;
            let loaded = decode(&bytes, &AtomicBool::new(false))?;
            assert_eq!(d, loaded.document);
            assert_eq!(bytes, encode(&d, &Parts::new(), &AtomicBool::new(false))?);
        }
        Ok(())
    }
    #[test]
    fn populated_sparse_workbook_round_trip() -> Result<(), FileError> {
        let mut d = Document::new("sheets", "Sparse workbook")?;
        if let document_model::Content::Sheets { workbook } = &mut d.content {
            workbook.sheets[0].cells.entry(999).or_default().insert(
                25,
                document_model::Cell {
                    value: json!(32),
                    formula: Some("=SUM(12,20)".into()),
                    ..Default::default()
                },
            );
            workbook.sheets[0]
                .row_dimensions
                .insert(999, json!({"h":32}));
            workbook.sheets[0]
                .column_dimensions
                .insert(25, json!({"w":120}));
        }
        let cancel = AtomicBool::new(false);
        let loaded = decode(&encode(&d, &Parts::new(), &cancel)?, &cancel)?;
        assert_eq!(d, loaded.document);
        assert_eq!(
            d,
            serde_json::from_slice::<Document>(&serde_json::to_vec(&d)?)?
        );
        Ok(())
    }
    #[test]
    fn rejects_corruption_and_cancellation() -> Result<(), FileError> {
        let d = Document::new("writer", "Test")?;
        assert!(encode(&d, &Parts::new(), &AtomicBool::new(true)).is_err());
        let mut p = read_zip(
            &encode(&d, &Parts::new(), &AtomicBool::new(false))?,
            &AtomicBool::new(false),
        )?;
        p.insert("content.json".into(), b"{}".to_vec());
        assert!(
            decode(
                &write_zip(&p, &AtomicBool::new(false))?,
                &AtomicBool::new(false)
            )
            .is_err()
        );
        Ok(())
    }
    #[test]
    fn rejects_traversal() {
        for n in ["../escape", "/etc/passwd", "a/../b", "C:/x", "a\\b", "a//b"] {
            assert!(!safe_name(n));
        }
    }
    #[test]
    fn preserves_opaque_source() -> Result<(), FileError> {
        let d = Document::new("writer", "Test")?;
        let p = Parts::from([("word/unknown.xml".into(), b"<unknown/>".to_vec())]);
        assert_eq!(
            decode(
                &encode(&d, &p, &AtomicBool::new(false))?,
                &AtomicBool::new(false)
            )?
            .preserved,
            p
        );
        Ok(())
    }
    #[test]
    fn repetitive_output_remains_readable() -> Result<(), FileError> {
        let p = Parts::from([("repetitive.bin".into(), vec![0; 2 * 1024 * 1024])]);
        let cancel = AtomicBool::new(false);
        assert_eq!(read_zip(&write_zip(&p, &cancel)?, &cancel)?, p);
        Ok(())
    }
    #[test]
    fn rejects_actual_traversal_and_bomb_archives() -> Result<(), FileError> {
        for (name, data) in [
            ("../escape", vec![1]),
            ("bomb.bin", vec![0; 2 * 1024 * 1024]),
        ] {
            let mut archive = ZipWriter::new(Cursor::new(Vec::new()));
            archive.start_file(
                name,
                SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated),
            )?;
            archive.write_all(&data)?;
            assert!(read_zip(&archive.finish()?.into_inner(), &AtomicBool::new(false)).is_err());
        }
        Ok(())
    }
    #[test]
    fn rejects_oversized_image_headers() {
        let mut png = vec![0; 33];
        png[..8].copy_from_slice(b"\x89PNG\r\n\x1a\n");
        png[8..12].copy_from_slice(&13u32.to_be_bytes());
        png[12..16].copy_from_slice(b"IHDR");
        png[16..20].copy_from_slice(&30_000u32.to_be_bytes());
        png[20..24].copy_from_slice(&30_000u32.to_be_bytes());
        assert!(validate_image(&png).is_err());
    }
}
