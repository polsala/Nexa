use document_model::Document;
use nexafile::{FileError, Parts};
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::atomic::AtomicBool,
};
use thiserror::Error;
use uuid::Uuid;

#[derive(Debug, Error)]
pub enum StorageError {
    #[error("Another application has locked this document.")]
    Locked,
    #[error("This file changed on disk. Save a copy to avoid overwriting the external changes.")]
    Conflict,
    #[error("The selected path is not a regular local file.")]
    InvalidPath,
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    File(#[from] FileError),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
}
pub struct FileLock {
    _file: File,
}
impl FileLock {
    pub fn acquire(path: &Path) -> Result<Self, StorageError> {
        let name = path
            .file_name()
            .ok_or(StorageError::InvalidPath)?
            .to_string_lossy();
        let lock = path.with_file_name(format!(".{name}.nexa-lock"));
        if fs::symlink_metadata(&lock).is_ok_and(|m| m.file_type().is_symlink()) {
            return Err(StorageError::InvalidPath);
        }
        let file = OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(lock)?;
        file.try_lock().map_err(|_| StorageError::Locked)?;
        Ok(Self { _file: file })
    }
}
pub fn checked_path(path: &Path) -> Result<PathBuf, StorageError> {
    if !path.is_absolute() || path.file_name().is_none() {
        return Err(StorageError::InvalidPath);
    }
    if fs::symlink_metadata(path).is_ok_and(|m| !m.is_file() || m.file_type().is_symlink()) {
        return Err(StorageError::InvalidPath);
    }
    let parent = path
        .parent()
        .ok_or(StorageError::InvalidPath)?
        .canonicalize()?;
    Ok(parent.join(path.file_name().ok_or(StorageError::InvalidPath)?))
}
/// Tempfile in the same directory; sync data before an atomic platform replacement.
/// tempfile uses atomic rename on Unix and MoveFileExW(REPLACE_EXISTING) on Windows.
pub fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), StorageError> {
    let path = checked_path(path)?;
    let parent = path.parent().ok_or(StorageError::InvalidPath)?;
    let mut tmp = tempfile::Builder::new()
        .prefix(".nexa-write-")
        .tempfile_in(parent)?;
    if let Ok(metadata) = fs::metadata(&path) {
        tmp.as_file().set_permissions(metadata.permissions())?;
    }
    tmp.write_all(bytes)?;
    tmp.as_file().sync_all()?;
    tmp.persist(&path).map_err(|e| StorageError::Io(e.error))?;
    #[cfg(unix)]
    File::open(parent)?.sync_all()?;
    Ok(())
}
pub fn fingerprint(path: &Path) -> Result<String, StorageError> {
    let m = fs::metadata(path)?;
    if m.len() > nexafile::MAX_COMPRESSED as u64 {
        return Err(StorageError::InvalidPath);
    }
    Ok(nexafile::digest(&fs::read(path)?))
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryEntry {
    pub id: Uuid,
    pub title: String,
    pub kind: String,
    pub modified_at: u64,
    pub revision: u64,
}
pub struct RecoveryStore {
    root: PathBuf,
}
impl RecoveryStore {
    pub fn new(root: PathBuf) -> Result<Self, StorageError> {
        fs::create_dir_all(&root)?;
        Ok(Self { root })
    }
    fn path(&self, id: Uuid) -> PathBuf {
        self.root.join(format!("{id}.recovery"))
    }
    pub fn snapshot(
        &self,
        doc: &Document,
        source: &Parts,
        cancel: &AtomicBool,
    ) -> Result<(), StorageError> {
        let path = self.path(doc.id);
        if let Ok(old) = self.read(doc.id)
            && old.document.revision > doc.revision
        {
            return Ok(());
        }
        let bytes = nexafile::encode(doc, source, cancel)?;
        nexafile::checkpoint(cancel)?;
        atomic_write(&path, &bytes)
    }
    pub fn read(&self, id: Uuid) -> Result<nexafile::NativeFile, StorageError> {
        let path = checked_path(&self.path(id))?;
        if fs::metadata(&path)?.len() > nexafile::MAX_COMPRESSED as u64 {
            return Err(StorageError::InvalidPath);
        }
        let file = nexafile::decode(&fs::read(path)?, &AtomicBool::new(false))?;
        if file.document.id != id {
            return Err(StorageError::InvalidPath);
        }
        Ok(file)
    }
    pub fn list(&self) -> Result<Vec<RecoveryEntry>, StorageError> {
        let mut out = vec![];
        for item in fs::read_dir(&self.root)? {
            let entry = item?;
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) != Some("recovery") {
                continue;
            }
            let Some(id) = path
                .file_stem()
                .and_then(|s| s.to_str())
                .and_then(|s| Uuid::parse_str(s).ok())
            else {
                continue;
            };
            match self.read(id) {
                Ok(file) => {
                    let d = file.document;
                    out.push(RecoveryEntry {
                        id: d.id,
                        kind: d.kind().into(),
                        title: d.title,
                        modified_at: d.modified_at,
                        revision: d.revision,
                    });
                }
                Err(e) => {
                    tracing::warn!(error=%e,"A recovery snapshot could not be read; it has been retained")
                }
            }
        }
        out.sort_by_key(|d| std::cmp::Reverse(d.modified_at));
        Ok(out)
    }
    pub fn clear_through(&self, id: Uuid, revision: u64) -> Result<(), StorageError> {
        let path = self.path(id);
        if !path.exists() {
            return Ok(());
        }
        let file = self.read(id)?;
        if file.document.revision <= revision {
            fs::remove_file(path)?;
        }
        Ok(())
    }
    pub fn discard(&self, id: Uuid) -> Result<(), StorageError> {
        let path = self.path(id);
        if path.exists() {
            fs::remove_file(path)?;
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub schema_version: u32,
    pub theme: String,
    pub accent: String,
    pub language: String,
    pub autosave_seconds: u32,
    pub default_page_size: String,
    pub locale: String,
    pub decimal_separator: String,
    pub recovery_enabled: bool,
    pub update_preference: String,
    #[serde(default, flatten)]
    pub extra: std::collections::BTreeMap<String, serde_json::Value>,
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            schema_version: 1,
            theme: "system".into(),
            accent: "#386b5a".into(),
            language: "en".into(),
            autosave_seconds: 30,
            default_page_size: "A4".into(),
            locale: "en-US".into(),
            decimal_separator: ".".into(),
            recovery_enabled: true,
            update_preference: "manual".into(),
            extra: Default::default(),
        }
    }
}
impl Settings {
    pub fn validate(&self) -> Result<(), StorageError> {
        if self.schema_version != 1
            || !["system", "light", "dark"].contains(&self.theme.as_str())
            || !["en", "ca", "es"].contains(&self.language.as_str())
            || self.autosave_seconds < 5
            || self.autosave_seconds > 3600
            || self.accent.len() != 7
            || !self.accent.starts_with('#')
            || !self.accent[1..].bytes().all(|c| c.is_ascii_hexdigit())
            || !["A4", "Letter"].contains(&self.default_page_size.as_str())
            || ![".", ","].contains(&self.decimal_separator.as_str())
            || self.update_preference != "manual"
            || self.locale.is_empty()
            || self.locale.len() > 64
            || !self
                .locale
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || c == b'-')
        {
            return Err(StorageError::InvalidPath);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn atomic_replace_and_locks() -> Result<(), StorageError> {
        let dir = tempfile::tempdir()?;
        let path = dir.path().join("work.nxd");
        atomic_write(&path, b"first")?;
        let lock = FileLock::acquire(&path)?;
        assert!(FileLock::acquire(&path).is_err());
        atomic_write(&path, b"second")?;
        assert_eq!(fs::read(&path)?, b"second");
        drop(lock);
        assert!(FileLock::acquire(&path).is_ok());
        Ok(())
    }
    #[test]
    fn recovery_never_deletes_newer_edits() -> Result<(), StorageError> {
        let dir = tempfile::tempdir()?;
        let r = RecoveryStore::new(dir.path().to_owned())?;
        let mut d = Document::new("writer", "Recovered").map_err(FileError::from)?;
        d.revision = 5;
        r.snapshot(&d, &Parts::new(), &AtomicBool::new(false))?;
        r.clear_through(d.id, 4)?;
        assert_eq!(r.list()?.len(), 1);
        r.clear_through(d.id, 5)?;
        assert!(r.list()?.is_empty());
        Ok(())
    }
    #[test]
    fn recovery_retains_unfinished_input_separately_from_committed_cells()
    -> Result<(), StorageError> {
        let dir = tempfile::tempdir()?;
        let store = RecoveryStore::new(dir.path().to_owned())?;
        let mut d = Document::new("sheets", "Unfinished input").map_err(FileError::from)?;
        if let document_model::Content::Sheets { workbook } = &mut d.content {
            let sheet = &mut workbook.sheets[0];
            sheet.cells.entry(0).or_default().insert(
                0,
                document_model::Cell {
                    value: serde_json::json!(42),
                    ..Default::default()
                },
            );
            d.recovery_draft = Some(document_model::CellDraft {
                version: 1,
                sheet_id: sheet.id.clone(),
                row: 0,
                column: 0,
                text: "=SUM(A2:  Catalunya / España  ".into(),
            });
        }
        d.revision = 5;
        store.snapshot(&d, &Parts::new(), &AtomicBool::new(false))?;
        assert_eq!(store.read(d.id)?.document, d);
        // Cancelling input supersedes the earlier draft without changing cells.
        d.recovery_draft = None;
        d.revision += 1;
        store.snapshot(&d, &Parts::new(), &AtomicBool::new(false))?;
        assert_eq!(store.read(d.id)?.document, d);
        Ok(())
    }
    #[test]
    fn recovery_rejects_mismatched_identity_and_oversized_file() -> Result<(), StorageError> {
        let dir = tempfile::tempdir()?;
        let r = RecoveryStore::new(dir.path().to_owned())?;
        let d = Document::new("writer", "Recovery").map_err(FileError::from)?;
        r.snapshot(&d, &Parts::new(), &AtomicBool::new(false))?;
        let other = Uuid::new_v4();
        fs::rename(r.path(d.id), r.path(other))?;
        assert!(r.read(other).is_err());
        let file = File::create(r.path(other))?;
        file.set_len(nexafile::MAX_COMPRESSED as u64 + 1)?;
        assert!(r.read(other).is_err());
        assert!(r.path(other).exists()); // Invalid recovery is retained.
        Ok(())
    }
}
