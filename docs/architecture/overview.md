# Architecture

Nexa is one offline desktop application, not a local web server. Tauri serves compiled assets inside the operating system WebView. Rust owns file authority; React owns shell UI state.

## Boundaries

```text
React shell ── commands ── EditorEngine
                           ├─ Writer: Tiptap / ProseMirror
                           ├─ Sheets: Univer OSS + formula worker
                           └─ Slides: local geometry engine + SVG + Tiptap text
     │ narrow, typed IPC          │ engine-independent Content
     ▼                           ▼
Tauri commands ── document-model ── nexafile / office-io
     │
native-services: atomic saves, locks, settings, recovery
```

- `apps/desktop/src`: Home, tabs, menus, dialogs, settings, keyboard routing. Editors are dynamically imported. Inactive tabs stay mounted so selection and undo survive switching.
- `packages/editor-core`: versioned domain types, templates, transaction history and editor contract. No Univer imports.
- `packages/sheets`: the only application package that imports Univer. Conversion maps sparse cells to/from its canvas model. Additional plugin resources are namespaced extensions, not the primary schema.
- `packages/writer`: semantic document nodes and constrained rich-text extensions. Native paragraph/page properties do not depend on React state.
- `packages/slides`: ordered slides and geometry, preview-only pointer movement, one committed history transaction per drag.
- `packages/commands`: ID, translated label key, icon, availability, shortcut and handler. Menus, palette and keyboard use the same actions; editor-specific controls delegate to engine transactions.
- `crates/document-model`: independently validated data contracts and migrations.
- `crates/nexafile`: bounded archives, deduplicated assets, checksums and source-package preservation.
- `crates/office-io`: replaceable import/export interfaces, deliberately limited OOXML mappings and safe CSV/TSV.
- `crates/native-services`: persistence without Tauri, enabling real filesystem tests.
- `apps/desktop/src-tauri`: dialogs, path grants, native integration, operation cancellation, local diagnostics.

## Save and recovery

Typing mutates the editor, not a global React document tree. Revisions and dirty state are tracked separately. A timed snapshot crosses IPC; compression, hashing, parsing and filesystem work execute on Tauri's blocking pool. Formula recalculation runs in a Web Worker. Snapshot serialization across IPC still has a large-document cost: see performance notes.

A native save checks the original fingerprint, takes a kernel-backed advisory sidecar lock, writes a same-directory temporary file, syncs it and atomically replaces the destination. On Unix the parent directory is synced too. Only after success may recovery at or below the saved revision be removed. A newer recovery revision is retained. Autosave never writes over an original document.

The engine boundary separates explicit `prepareSnapshot()` from non-mutating `recoveryDraft()` capture. Sheets observes public cell-edit events, keeping only the current draft text/coordinate outside React state. Timed recovery stores that versioned input beside the unchanged committed content. Escape invalidates an earlier draft revision. Restoring applies unfinished text literally through the command/undo layer and explains that it must be confirmed to become a formula or number; no incomplete formula is evaluated during recovery. See [NXS recovery semantics](../file-formats/NXS.md).

Imported Office files default to Save As native. Export does not clear the native dirty flag or delete its recovery. Unknown OOXML source parts are retained in native archives. Unmodified same-format export preserves source parts; edited export rebuilds supported parts and includes an intact original package.

## Security and future extensions

There is no generic filesystem/shell/network bridge. Opening requires an OS file picker, a recent-file identifier, or a path actually granted by OS startup/drop events. A session authorizes only its own save destination. Links/images are constrained, macros never execute, and XML DTDs are disabled. The CSP forbids remote requests and embedded frames. No analytics, accounts or update requests occur by default.

A future application implements EditorEngine and adds a Content variant plus a versioned migration. Plugins are not loaded in V1: a future plugin must declare capabilities and receive explicit grants, not inherit frontend or native authority. Collaboration, sync and AI are optional future adapters; no server assumptions are embedded in current persistence.

The browser adapter exists for UI development and automated tests only. Production desktop editing and persistence use Rust. It is not a supported cloud/web product.
