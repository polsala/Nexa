# ADR-001 — Tauri instead of Electron

Status: accepted.

Use Tauri 2 with Rust stable and an offline React/TypeScript/Vite frontend. Windows uses WebView2, Linux uses WebKitGTK. No Node process or bundled Chromium is shipped. This keeps the native boundary explicit and reduces distribution overhead. Tradeoff: two WebView implementations require cross-platform UI testing and Linux system-library prerequisites. The frontend-only dev server is development tooling, never part of a release.
