//! Local, deliberately bounded OOXML/CSV adapters. No macros, external fetches or subprocesses.
mod package;
mod sheets;
mod slides;
mod writer;
mod writer_lists;
use document_model::{Content, Document, ModelError};
use nexafile::{FileError, Parts};
use serde_json::json;
use std::sync::atomic::AtomicBool;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum OfficeError {
    #[error("Restore and review the unfinished cell input before exporting this recovery file.")]
    UnresolvedDraft,
    #[error("This file type is not supported.")]
    Unsupported,
    #[error("An Office XML part is malformed: {0}")]
    Xml(String),
    #[error("The Office package is incomplete: {0}")]
    Missing(String),
    #[error(transparent)]
    File(#[from] FileError),
    #[error(transparent)]
    Model(#[from] ModelError),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error(transparent)]
    Csv(#[from] csv::Error),
    #[error(transparent)]
    Io(#[from] std::io::Error),
}
pub struct ImportResult {
    pub document: Document,
    pub preserved: Parts,
    pub warnings: Vec<String>,
}
pub trait DocumentImporter {
    fn import(
        &self,
        bytes: &[u8],
        title: &str,
        cancel: &AtomicBool,
    ) -> Result<ImportResult, OfficeError>;
}
pub trait DocumentExporter {
    fn export(
        &self,
        doc: &Document,
        source: &Parts,
        cancel: &AtomicBool,
    ) -> Result<Vec<u8>, OfficeError>;
}
pub struct OoxmlAdapter {
    pub extension: String,
}
impl DocumentImporter for OoxmlAdapter {
    fn import(
        &self,
        bytes: &[u8],
        title: &str,
        cancel: &AtomicBool,
    ) -> Result<ImportResult, OfficeError> {
        import(bytes, &self.extension, title, cancel)
    }
}
impl DocumentExporter for OoxmlAdapter {
    fn export(
        &self,
        doc: &Document,
        source: &Parts,
        cancel: &AtomicBool,
    ) -> Result<Vec<u8>, OfficeError> {
        export(doc, &self.extension, source, cancel)
    }
}

pub fn import(
    bytes: &[u8],
    extension: &str,
    title: &str,
    cancel: &AtomicBool,
) -> Result<ImportResult, OfficeError> {
    if matches!(extension, "csv" | "tsv") {
        return sheets::import_delimited(
            bytes,
            title,
            if extension == "tsv" { b'\t' } else { b',' },
        );
    }
    if extension == "txt" {
        let mut d = Document::new("writer", title)?;
        if let Content::Writer { body, .. } = &mut d.content {
            body.content = String::from_utf8_lossy(bytes)
                .lines()
                .map(|s| document_model::TextNode::block("paragraph", s))
                .collect();
        }
        return Ok(ImportResult {
            document: d,
            preserved: Parts::new(),
            warnings: vec![],
        });
    }
    let mut parts = nexafile::read_zip(bytes, cancel)?;
    // Validate EVERY XML part, including opaque extensions, before preserving it.
    for (name, data) in &parts {
        nexafile::checkpoint(cancel)?;
        if name.ends_with(".xml") || name.ends_with(".rels") {
            package::xml_bytes(data)?;
        }
        if [".png", ".jpg", ".jpeg", ".webp"]
            .iter()
            .any(|ext| name.to_lowercase().ends_with(ext))
        {
            nexafile::validate_image(data)?;
        }
    }
    let mut d = match extension {
        "docx" | "docm" => writer::import(&parts, title)?,
        "xlsx" | "xlsm" => sheets::import(&parts, title)?,
        "pptx" | "pptm" => slides::import(&parts, title)?,
        _ => return Err(OfficeError::Unsupported),
    };
    d.validate()?;
    let mut warnings = vec!["Office layout and advanced objects may differ. The source package is preserved in the native file. Exporting edits rebuilds supported content; keep the native file to retain the complete original.".into()];
    if parts
        .keys()
        .any(|p| p.to_lowercase().contains("vbaproject"))
    {
        warnings.push("This file contains macros. Nexa never executes them; they are retained only as source data.".into());
    }
    d.metadata.insert("importedFormat".into(), json!(extension));
    parts.insert(
        ".nexa/baseline.json".into(),
        serde_json::to_vec(&d.content)?,
    );
    Ok(ImportResult {
        document: d,
        preserved: parts,
        warnings,
    })
}
pub fn export(
    doc: &Document,
    ext: &str,
    source: &Parts,
    cancel: &AtomicBool,
) -> Result<Vec<u8>, OfficeError> {
    doc.validate()?;
    if doc.recovery_draft.is_some() {
        return Err(OfficeError::UnresolvedDraft);
    }
    nexafile::checkpoint(cancel)?;
    if matches!(ext, "csv" | "tsv") {
        return sheets::export_delimited(doc, if ext == "tsv" { b'\t' } else { b',' });
    }
    if ext == "txt" {
        return match &doc.content {
            Content::Writer { body, .. } => Ok(body.plain_text().into_bytes()),
            _ => Err(OfficeError::Unsupported),
        };
    }
    if ext == "html" {
        return writer::export_html(doc);
    }
    let imported = doc
        .metadata
        .get("importedFormat")
        .and_then(serde_json::Value::as_str);
    let same_content = source
        .get(".nexa/baseline.json")
        .is_some_and(|b| serde_json::to_vec(&doc.content).is_ok_and(|v| v == *b));
    if same_content && imported == Some(ext) {
        return Ok(nexafile::write_zip(
            &source
                .iter()
                .filter(|(n, _)| !n.starts_with(".nexa/"))
                .map(|(n, v)| (n.clone(), v.clone()))
                .collect(),
            cancel,
        )?);
    }
    let mut parts = match (&doc.content, ext) {
        (Content::Writer { .. }, "docx") => writer::export(doc)?,
        (Content::Sheets { .. }, "xlsx") => sheets::export(doc)?,
        (Content::Slides { .. }, "pptx") => slides::export(doc)?,
        _ => return Err(OfficeError::Unsupported),
    };
    // Preserve opaque package parts at their original paths. Newly generated supported parts win.
    // An intact source ZIP is also included, so changed relationships never destroy source content.
    if !source.is_empty() {
        let original: Parts = source
            .iter()
            .filter(|(n, _)| !n.starts_with(".nexa/"))
            .map(|(n, v)| (n.clone(), v.clone()))
            .collect();
        let original_zip = nexafile::write_zip(&original, cancel)?;
        for (n, v) in &original {
            if !n.to_lowercase().contains("vba")
                && !n.ends_with(".rels")
                && n != "[Content_Types].xml"
            {
                parts.entry(n.clone()).or_insert_with(|| v.clone());
            }
        }
        parts.insert("nexa/original.zip".into(), original_zip);
        package::merge_content_types(&mut parts, &original)?;
    }
    Ok(nexafile::write_zip(&parts, cancel)?)
}
