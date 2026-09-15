# ADR-002 — Rust native core

Status: accepted.

Document validation, bounded ZIP/XML parsing, source preservation, durable writes, recovery and native file authority live in Rust crates independently testable without a WebView. Tauri commands run expensive work with spawn_blocking; cancellation is cooperative at archive/chunk boundaries. serde and thiserror provide stable serialization and errors. tracing records timings and failure categories, never contents or clipboard data. We do not add a second custom async runtime: Tauri already supplies one.
