use base64::{Engine, engine::general_purpose::STANDARD};
use document_model::{Content, Document};
use native_services::{
    FileLock, RecoveryEntry, RecoveryStore, Settings, atomic_write, checked_path, fingerprint,
};
use nexafile::Parts;
use notify::Watcher;
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::Instant,
};
use tauri::{Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;
use uuid::Uuid;
type Result<T> = std::result::Result<T, String>;
#[derive(Clone)]
struct Core(Arc<Inner>);
struct Inner {
    root: PathBuf,
    sessions: Mutex<HashMap<Uuid, Session>>,
    jobs: Mutex<HashMap<String, Arc<AtomicBool>>>,
    granted: Mutex<HashSet<PathBuf>>,
    started: Instant,
    watcher: Mutex<Option<notify::RecommendedWatcher>>,
    watched_dirs: Mutex<HashSet<PathBuf>>,
}
#[derive(Default)]
struct Session {
    path: Option<PathBuf>,
    source: Parts,
    hash: Option<String>,
    lock: Option<FileLock>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Recent {
    id: String,
    title: String,
    kind: String,
    path: PathBuf,
    modified_at: u64,
    preview: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Opened {
    document: Document,
    path: Option<PathBuf>,
    warnings: Vec<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Saved {
    path: PathBuf,
    revision: u64,
}
fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}
fn watch_path(core: &Inner, path: &Path) -> Result<()> {
    if let Some(parent) = path.parent() {
        let mut dirs = core.watched_dirs.lock().map_err(err)?;
        if !dirs.contains(parent)
            && let Some(watcher) = core.watcher.lock().map_err(err)?.as_mut()
        {
            match watcher.watch(parent, notify::RecursiveMode::NonRecursive) {
                Ok(()) => {
                    dirs.insert(parent.to_owned());
                }
                Err(_) => tracing::warn!(
                    "Live file watching unavailable; pre-save conflict detection remains active"
                ),
            }
        }
    }
    Ok(())
}
fn recents(core: &Inner) -> Vec<Recent> {
    fs::read(core.root.join("recent.json"))
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}
fn record(core: &Inner, doc: &Document, path: &Path) -> Result<()> {
    let mut recent = recents(core);
    recent.retain(|r| r.path != path);
    let preview = match &doc.content {
        Content::Writer { body, .. } => body.plain_text().chars().take(140).collect(),
        Content::Sheets { workbook } => workbook
            .sheets
            .iter()
            .map(|s| s.name.clone())
            .collect::<Vec<_>>()
            .join(" · "),
        Content::Slides { deck } => deck
            .slides
            .first()
            .map(|s| {
                s.objects
                    .iter()
                    .map(|o| o.text.as_str())
                    .collect::<Vec<_>>()
                    .join(" ")
            })
            .unwrap_or_default(),
    };
    recent.insert(
        0,
        Recent {
            id: nexafile::digest(path.to_string_lossy().as_bytes()),
            title: doc.title.clone(),
            kind: doc.kind().into(),
            path: path.to_owned(),
            modified_at: document_model::now(),
            preview,
        },
    );
    recent.truncate(30);
    atomic_write(
        &core.root.join("recent.json"),
        &serde_json::to_vec(&recent).map_err(err)?,
    )
    .map_err(err)
}
async fn job<T: Send + 'static>(
    core: Core,
    id: String,
    task: impl FnOnce(Arc<Inner>, Arc<AtomicBool>) -> Result<T> + Send + 'static,
) -> Result<T> {
    let cancel = Arc::new(AtomicBool::new(false));
    core.0
        .jobs
        .lock()
        .map_err(err)?
        .insert(id.clone(), cancel.clone());
    let inner = core.0.clone();
    let result = tauri::async_runtime::spawn_blocking(move || task(inner, cancel))
        .await
        .map_err(err);
    core.0.jobs.lock().map_err(err)?.remove(&id);
    result?
}
fn open_path(core: &Inner, path: PathBuf, cancel: &AtomicBool) -> Result<Opened> {
    let started = Instant::now();
    let path = checked_path(&path).map_err(err)?;
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    if ![
        "nxd", "nxs", "nxp", "docx", "docm", "xlsx", "xlsm", "pptx", "pptm", "csv", "tsv", "txt",
    ]
    .contains(&ext.as_str())
    {
        return Err("Unsupported document extension".into());
    }
    let metadata = fs::metadata(&path).map_err(err)?;
    if metadata.len() > nexafile::MAX_COMPRESSED as u64 {
        return Err("The file exceeds the supported size limit".into());
    }
    let bytes = fs::read(&path).map_err(err)?;
    nexafile::checkpoint(cancel).map_err(err)?;
    let title = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Untitled");
    let native = matches!(ext.as_str(), "nxd" | "nxs" | "nxp");
    let (doc, source, warnings) = if native {
        let f = nexafile::decode(&bytes, cancel).map_err(err)?;
        if f.document.extension() != ext {
            return Err("File extension does not match the native document type".into());
        }
        (f.document, f.preserved, vec![])
    } else {
        let f = office_io::import(&bytes, &ext, title, cancel).map_err(err)?;
        (f.document, f.preserved, f.warnings)
    };
    let mut sessions = core.sessions.lock().map_err(err)?;
    if native
        && sessions
            .get(&doc.id)
            .is_some_and(|s| s.path.as_ref() != Some(&path))
    {
        return Err("Another copy of this document is already open. Close that tab before opening this copy.".into());
    }
    if let std::collections::hash_map::Entry::Vacant(e) = sessions.entry(doc.id) {
        let lock = if native {
            Some(FileLock::acquire(&path).map_err(err)?)
        } else {
            None
        };
        e.insert(Session {
            path: if native { Some(path.clone()) } else { None },
            source,
            hash: if native {
                Some(nexafile::digest(&bytes))
            } else {
                None
            },
            lock,
        });
    }
    record(core, &doc, &path)?;
    if native {
        watch_path(core, &path)?;
    }
    tracing::info!(
        kind = doc.kind(),
        elapsed_ms = started.elapsed().as_millis(),
        "Document imported"
    );
    Ok(Opened {
        document: doc,
        path: if native { Some(path) } else { None },
        warnings,
    })
}
#[tauri::command]
async fn open_document(
    app: tauri::AppHandle,
    core: State<'_, Core>,
    operation: String,
) -> Result<Option<Opened>> {
    job(core.inner().clone(), operation, move |core, cancel| {
        let selected = app
            .dialog()
            .file()
            .add_filter(
                "Office documents",
                &[
                    "nxd", "nxs", "nxp", "docx", "xlsx", "pptx", "csv", "tsv", "txt", "docm",
                    "xlsm", "pptm",
                ],
            )
            .blocking_pick_file();
        let Some(file) = selected else {
            return Ok(None);
        };
        open_path(&core, file.into_path().map_err(err)?, &cancel).map(Some)
    })
    .await
}
#[tauri::command]
async fn open_recent(core: State<'_, Core>, id: String, operation: String) -> Result<Opened> {
    job(core.inner().clone(), operation, move |core, cancel| {
        let path = recents(&core)
            .into_iter()
            .find(|r| r.id == id)
            .ok_or("Recent file was not found")?
            .path;
        open_path(&core, path, &cancel)
    })
    .await
}
#[tauri::command]
async fn open_granted(core: State<'_, Core>, path: PathBuf, operation: String) -> Result<Opened> {
    job(core.inner().clone(), operation, move |core, cancel| {
        if !core.granted.lock().map_err(err)?.remove(&path) {
            return Err("This path was not granted by an OS open event".into());
        }
        open_path(&core, path, &cancel)
    })
    .await
}
#[tauri::command]
fn list_recent(core: State<'_, Core>) -> Vec<Recent> {
    recents(&core.0)
}
#[tauri::command]
async fn save_document(
    app: tauri::AppHandle,
    core: State<'_, Core>,
    document: Document,
    save_as: bool,
    format: Option<String>,
    operation: String,
) -> Result<Option<Saved>> {
    job(core.inner().clone(), operation, move |core, cancel| {
        let started = Instant::now();
        document.validate().map_err(err)?;
        let native = format.is_none();
        let ext = format.as_deref().unwrap_or(document.extension());
        let allowed = match document.kind() {
            "writer" => vec!["nxd", "docx", "txt", "html"],
            "sheets" => vec!["nxs", "xlsx", "csv", "tsv"],
            _ => vec!["nxp", "pptx"],
        };
        if !allowed.contains(&ext) {
            return Err("Unsupported export format".into());
        }
        let old_path = core
            .sessions
            .lock()
            .map_err(err)?
            .get(&document.id)
            .and_then(|s| s.path.clone());
        let path = if native && !save_as && old_path.is_some() {
            old_path.clone().ok_or("Missing save path")?
        } else {
            let safe_title = document
                .title
                .chars()
                .map(|c| {
                    if c.is_control() || "/\\:*?\"<>|".contains(c) {
                        '_'
                    } else {
                        c
                    }
                })
                .take(100)
                .collect::<String>();
            let selected = app
                .dialog()
                .file()
                .add_filter(ext, &[ext])
                .set_file_name(format!("{safe_title}.{ext}"))
                .blocking_save_file();
            let Some(file) = selected else {
                return Ok(None);
            };
            let path = file.into_path().map_err(err)?;
            let path = if path.extension().is_none() {
                path.with_extension(ext)
            } else {
                path
            };
            if path
                .extension()
                .and_then(|e| e.to_str())
                .is_none_or(|e| !e.eq_ignore_ascii_case(ext))
            {
                return Err(format!("Please use the .{ext} extension for this format"));
            }
            checked_path(&path).map_err(err)?
        };
        let mut sessions = core.sessions.lock().map_err(err)?;
        let session = sessions.entry(document.id).or_default();
        let new_lock = if old_path.as_ref() != Some(&path) {
            Some(FileLock::acquire(&path).map_err(err)?)
        } else {
            None
        };
        if old_path.as_ref() == Some(&path)
            && session
                .hash
                .as_ref()
                .is_some_and(|h| fingerprint(&path).map_or(true, |current| current != *h))
        {
            return Err("This file changed on disk. Save a copy to preserve both versions.".into());
        }
        let bytes = if native {
            nexafile::encode(&document, &session.source, &cancel).map_err(err)?
        } else {
            office_io::export(&document, ext, &session.source, &cancel).map_err(err)?
        };
        nexafile::checkpoint(&cancel).map_err(err)?;
        atomic_write(&path, &bytes).map_err(err)?;
        if native {
            session.path = Some(path.clone());
            session.hash = Some(nexafile::digest(&bytes));
            if new_lock.is_some() {
                session.lock = new_lock;
            }
            RecoveryStore::new(core.root.join("recovery"))
                .map_err(err)?
                .clear_through(document.id, document.revision)
                .map_err(err)?;
            record(&core, &document, &path)?;
            watch_path(&core, &path)?;
        }
        tracing::info!(
            kind = document.kind(),
            elapsed_ms = started.elapsed().as_millis(),
            bytes = bytes.len(),
            "Document saved"
        );
        Ok(Some(Saved {
            path,
            revision: document.revision,
        }))
    })
    .await
}
#[tauri::command]
async fn autosave(core: State<'_, Core>, document: Document) -> Result<()> {
    let core = core.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let sessions = core.0.sessions.lock().map_err(err)?;
        let empty = Parts::new();
        let source = sessions.get(&document.id).map_or(&empty, |s| &s.source);
        RecoveryStore::new(core.0.root.join("recovery"))
            .map_err(err)?
            .snapshot(&document, source, &AtomicBool::new(false))
            .map_err(err)
    })
    .await
    .map_err(err)?
}
#[tauri::command]
async fn list_recovery(core: State<'_, Core>) -> Result<Vec<RecoveryEntry>> {
    let root = core.0.root.clone();
    tauri::async_runtime::spawn_blocking(move || {
        RecoveryStore::new(root.join("recovery"))
            .map_err(err)?
            .list()
            .map_err(err)
    })
    .await
    .map_err(err)?
}
#[tauri::command]
async fn restore_recovery(core: State<'_, Core>, id: Uuid) -> Result<Opened> {
    let core = core.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let file = RecoveryStore::new(core.0.root.join("recovery"))
            .map_err(err)?
            .read(id)
            .map_err(err)?;
        let mut sessions = core.0.sessions.lock().map_err(err)?;
        if sessions.contains_key(&file.document.id) {
            return Err(
                "This document is already open. Close its tab before restoring recovery.".into(),
            );
        }
        sessions.insert(
            file.document.id,
            Session {
                source: file.preserved,
                ..Session::default()
            },
        );
        Ok(Opened {
            document: file.document,
            path: None,
            warnings: vec![],
        })
    })
    .await
    .map_err(err)?
}
#[tauri::command]
fn discard_recovery(core: State<'_, Core>, id: Uuid) -> Result<()> {
    // Discarding a snapshot must not drop an active session's source parts/lock.
    let _sessions = core.0.sessions.lock().map_err(err)?;
    RecoveryStore::new(core.0.root.join("recovery"))
        .map_err(err)?
        .discard(id)
        .map_err(err)
}
#[tauri::command]
fn close_document(core: State<'_, Core>, id: Uuid, discard: bool) -> Result<()> {
    let mut sessions = core.0.sessions.lock().map_err(err)?;
    if discard {
        RecoveryStore::new(core.0.root.join("recovery"))
            .map_err(err)?
            .discard(id)
            .map_err(err)?;
    }
    sessions.remove(&id);
    Ok(())
}
#[tauri::command]
fn cancel_operation(core: State<'_, Core>, operation: String) -> Result<()> {
    if let Some(c) = core.0.jobs.lock().map_err(err)?.get(&operation) {
        c.store(true, Ordering::Relaxed);
    }
    Ok(())
}
#[tauri::command]
fn get_settings(core: State<'_, Core>) -> Result<Settings> {
    let path = core.0.root.join("settings.json");
    if !path.exists() {
        return Ok(Settings::default());
    }
    let settings: Settings = serde_json::from_slice(&fs::read(path).map_err(err)?).map_err(err)?;
    settings.validate().map_err(err)?;
    Ok(settings)
}
#[tauri::command]
fn set_settings(core: State<'_, Core>, settings: Settings) -> Result<()> {
    settings.validate().map_err(err)?;
    atomic_write(
        &core.0.root.join("settings.json"),
        &serde_json::to_vec(&settings).map_err(err)?,
    )
    .map_err(err)
}
#[tauri::command]
async fn choose_image(app: tauri::AppHandle) -> Result<Option<serde_json::Value>> {
    tauri::async_runtime::spawn_blocking(move||{let Some(file)=app.dialog().file().add_filter("Images",&["png","jpg","jpeg","webp"]).blocking_pick_file()else{return Ok(None)};let path=file.into_path().map_err(err)?;if fs::metadata(&path).map_err(err)?.len()>32*1024*1024{return Err("Image exceeds 32 MiB".into());}let bytes=fs::read(&path).map_err(err)?;let size=imagesize::blob_size(&bytes).map_err(err)?;if size.width>16384||size.height>16384||size.width.saturating_mul(size.height)>64_000_000{return Err("Image dimensions exceed safety limits".into());}let ext=path.extension().and_then(|s|s.to_str()).unwrap_or("").to_lowercase();let mime=match ext.as_str(){"png"=>"png","jpg"|"jpeg"=>"jpeg","webp"=>"webp",_=>return Err("Unsupported image type".into())};Ok(Some(serde_json::json!({"src":format!("data:image/{mime};base64,{}",STANDARD.encode(bytes)),"width":size.width,"height":size.height}))) }).await.map_err(err)?
}
#[tauri::command]
fn diagnostics(core: State<'_, Core>) -> serde_json::Value {
    serde_json::json!({"version":env!("CARGO_PKG_VERSION"),"os":std::env::consts::OS,"uptimeSeconds":core.0.started.elapsed().as_secs(),"telemetry":false,"updates":"disabled-until-signing-configured"})
}
#[tauri::command]
fn startup_files(core: State<'_, Core>) -> Result<Vec<PathBuf>> {
    Ok(core
        .0
        .granted
        .lock()
        .map_err(err)?
        .iter()
        .cloned()
        .collect())
}
pub fn run() {
    let builder = tauri::Builder::default().plugin(tauri_plugin_dialog::init());
    // An explicit feature and a configured signed release channel are required.
    // Registration itself never initiates a network/update request.
    #[cfg(feature = "signed-updates")]
    let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    let result = builder
        .setup(|app| {
            let root = app.path().app_data_dir()?;
            fs::create_dir_all(&root)?;
            let log_path = root.join("nexa.log");
            if fs::metadata(&log_path).is_ok_and(|m| m.len() > 8 * 1024 * 1024) {
                let _ = fs::rename(&log_path, root.join("nexa.previous.log"));
            }
            let log = fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(log_path)?;
            let _ = tracing_subscriber::fmt()
                .with_ansi(false)
                .with_writer(Mutex::new(log))
                .with_max_level(tracing::Level::INFO)
                .try_init();
            tracing::info!(version = env!("CARGO_PKG_VERSION"), "Nexa starting");
            let granted = std::env::args_os()
                .skip(1)
                .map(PathBuf::from)
                .filter(|p| p.is_absolute() && p.is_file())
                .collect();
            let core = Core(Arc::new(Inner {
                root,
                sessions: Mutex::new(HashMap::new()),
                jobs: Mutex::new(HashMap::new()),
                granted: Mutex::new(granted),
                started: Instant::now(),
                watcher: Mutex::new(None),
                watched_dirs: Mutex::new(HashSet::new()),
            }));
            let weak = Arc::downgrade(&core.0);
            let handle = app.handle().clone();
            let watcher =
                notify::recommended_watcher(move |result: notify::Result<notify::Event>| {
                    let Ok(event) = result else {
                        return;
                    };
                    if !(event.kind.is_modify() || event.kind.is_remove() || event.kind.is_create())
                    {
                        return;
                    }
                    let Some(core) = weak.upgrade() else {
                        return;
                    };
                    let Ok(sessions) = core.sessions.lock() else {
                        return;
                    };
                    // Compare hashes while holding the same mutex as durable saves;
                    // our own atomic replacement must not look like an external edit.
                    for (id, session) in sessions.iter() {
                        if let Some(path) = &session.path
                            && event.paths.contains(path)
                            && fingerprint(path).ok() != session.hash
                        {
                            let _ = handle.emit("nexa-file-changed", id.to_string());
                        }
                    }
                });
            match watcher {
                Ok(watcher) => *core.0.watcher.lock().map_err(err)? = Some(watcher),
                Err(_) => tracing::warn!("Filesystem watcher could not start"),
            }
            app.manage(core);
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) = event {
                let core = window.state::<Core>();
                if let Ok(mut granted) = core.0.granted.lock() {
                    granted.extend(paths.iter().cloned());
                }
                let _ = window.emit("nexa-open-files", paths);
            }
        })
        .invoke_handler(tauri::generate_handler![
            open_document,
            open_recent,
            open_granted,
            list_recent,
            save_document,
            autosave,
            list_recovery,
            restore_recovery,
            discard_recovery,
            close_document,
            cancel_operation,
            get_settings,
            set_settings,
            choose_image,
            diagnostics,
            startup_files
        ])
        .run(tauri::generate_context!());
    if let Err(error) = result {
        tracing::error!(error=%error,"Desktop runtime failed");
        eprintln!("Nexa could not start: {error}");
    }
}
