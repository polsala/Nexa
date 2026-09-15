# Security and privacy boundaries

Normal editing is offline. Production CSP permits only bundled scripts, local workers, constrained image data and Tauri IPC. There is no shell command bridge, generic filesystem API, account, telemetry implementation, content upload or remote font loader. The updater is an optional Cargo feature and never checks a server automatically.

## Untrusted documents

Rust validates every ZIP entry, not only the parts understood by an Office adapter. Traversal, symlinks, duplicate names, excessive expansion, corrupt checksums, oversized image headers, excessive XML depth and DTDs are rejected. See the [container specification](../file-formats/container.md) for numerical limits. A native SHA-256 manifest detects corruption, not a malicious producer who can recompute hashes.

Images are PNG/JPEG/WebP only, with bounded byte size and dimensions checked before decode. SVG, active objects and external image/file URLs are not rendered. Safe HTTP(S)/mailto hyperlinks may be retained as text links. Macros are never executed. Embedded original packages are passive preservation data: Nexa does not recursively unpack or launch them. Do not treat a preserved source package as sanitized for opening in another office application.

OOXML adapters do not call Microsoft Office, LibreOffice, a subprocess or an online conversion endpoint. The optional independent LibreOffice test script is a developer verification tool only.

## File authority and recovery

Open commands accept a native dialog result, a known recent-file ID, or a one-time OS startup/drop grant. Frontend-supplied paths alone do not grant authority. Save uses the session's existing path or a native Save As dialog. Symlink destinations are rejected, saves use same-directory temporary files and durable atomic replacement, and fingerprint conflicts block overwriting externally edited files.

Locks are advisory and automatically released by the kernel when the application dies. Another copy with the same native UUID cannot replace an active session's path. Recovery snapshots have their own bounded native archives; restoring an already-open document cannot silently replace its session. Discarding recovery does not discard an active file lock or preserved source parts.

Snapshots, recent-file previews/paths and documents are private user data stored locally, without encryption-at-rest. Logs are bounded local diagnostic files and must never contain document or clipboard content. Report a bug with a minimal synthetic fixture; do not attach personal documents or private paths without reviewing them.

## Residual risks and release checks

- ZIP/XML limits reduce resource exhaustion; they are not a hard process-memory ceiling. Full-model parsing and IPC can still require substantial memory near the supported limits.
- There is no isolated parser subprocess in this version. Keep Rust dependencies and the OS WebView patched. Check both dependency advisories and platform-library notices before public distribution.
- Advisory locks cannot stop unrelated applications from writing, and no application can make a transactional promise about a concurrently hostile filesystem. Save As is the conflict escape hatch; original files are never auto-repaired.
- Passing tests is not a security audit, accessibility certification or proof of compatibility with arbitrary Office packages. The owned fixture corpus is intentionally small and should grow with reviewed, redistributable regression samples.
- Public release requires Windows execution, clean-machine installer tests, signing/channel configuration, and completion of per-artifact platform-license/source compliance. Never publish private signing material.

Current npm dependency findings and their scoped fixes are recorded in [dependency decisions](dependencies.md). Use `pnpm audit --prod --audit-level high` and `cargo audit` with a freshly fetched advisory database during release verification.
