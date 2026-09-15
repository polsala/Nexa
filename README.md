# Nexa Office

A local-first desktop office suite for Linux and Windows: Writer, Sheets and Slides in one tabbed Tauri 2 application. No Electron, Node server, account, telemetry, license server or cloud conversion. Normal desktop editing works offline.

This repository contains a working **0.1.0 release candidate**, not a claim of Microsoft Office fidelity. Linux packages and test evidence are generated locally. Windows CI is configured to build it, but Windows execution has not been verified from this Linux environment. Read the [compatibility matrix](docs/compatibility/office.md) before editing valuable Office originals.

## What works

- Home, editable templates, recent files, multiple document tabs, command palette, keyboard shortcuts and unsaved-close prompts.
- Writer: rich text, headings/lists, tables, inline images, page settings, outline, search/replace, undo and print view.
- Sheets: Univer OSS canvas grid, multiple sheets, worker-based formulas, formatting, range operations, filtering, sorting, validation, conditional formatting and local data-linked charts.
- Slides: layouts, rich text, images, shapes, multi-selection, geometry, snapping, arrangement/distribution, notes, undo, thumbnails and full-screen static presentations.
- Versioned `.nxd`, `.nxs`, `.nxp` ZIP files, checksummed/deduplicated assets, atomic saves, advisory locks, external-change protection and separate recovery snapshots.
- Local DOCX/XLSX/PPTX import/export, CSV/TSV, Writer text/HTML export. PDF uses the local system print pipeline.
- English, Catalan and Spanish shell UI; light/dark/system theme and configurable accent.

## Prerequisites

Use Node.js **24 LTS**, pnpm **10.33.3**, and stable Rust **1.94.1 or newer**. Rust, Cargo and the native toolchain must be on `PATH`. Dependencies are locked in both package lockfiles. Internet access is needed to install/build dependencies, not to use the installed application.

### Ubuntu / Debian

Tested native build environment: Debian 12 container on an x86_64 Linux host. CI also targets Ubuntu 24.04.

```sh
sudo apt-get update
sudo apt-get install -y build-essential pkg-config curl libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev patchelf
rustup component add rustfmt clippy
corepack enable
pnpm install --frozen-lockfile
pnpm desktop:dev
```

Install Node and Rust using their official installers if absent. On minimal Linux desktops, install a fonts package such as `fonts-dejavu-core` and an appropriate spellchecking dictionary. Writer uses fonts installed on the machine and the WebView's spellchecker; fonts and dictionaries are not downloaded by the application.

### Windows x86_64

Install Visual Studio 2022 Build Tools with **Desktop development with C++**, a Windows SDK, Node.js 24 LTS, Rust's MSVC toolchain and Microsoft Edge WebView2 Runtime. In Developer PowerShell:

```powershell
rustup default stable-x86_64-pc-windows-msvc
rustup component add rustfmt clippy
corepack enable
pnpm install --frozen-lockfile
pnpm desktop:dev
```

WebView2 normally exists on supported Windows versions. For air-gapped deployment, provision the WebView2 standalone runtime offline before installing Nexa. The default NSIS bootstrapper may need internet if the runtime is missing.

## Development commands

```sh
pnpm dev                # Browser UI workspace at http://127.0.0.1:1420
pnpm desktop:dev        # Actual Tauri desktop, Rust filesystem and Office support
pnpm typecheck
pnpm lint
pnpm test
pnpm test:e2e
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
pnpm build             # Production frontend
```

Browser mode is a development adapter: IndexedDB, native-format downloads and browser printing. It does **not** provide Rust Office conversion or native filesystem authority. Use `desktop:dev` for complete vertical slices. Browser tests need Chromium: `pnpm exec playwright install --with-deps chromium` (or set `NEXA_CHROMIUM_PATH`). Core Rust tests can run without GTK headers using `cargo test` (workspace default members).

## Build installers

```sh
pnpm desktop:build --bundles deb,appimage  # Linux
pnpm desktop:build --bundles nsis         # Windows
pnpm release:checksums                   # SHA256SUMS next to the packages
```

Outputs: `target/release/bundle/`. Linux packages associate only Nexa extensions, not Office defaults. AppImages require a graphical desktop; use `APPIMAGE_EXTRACT_AND_RUN=1` on systems without FUSE. The manual GitHub release workflow builds Linux DEB/AppImage and Windows NSIS candidates. Public publishing and unsigned updates are disabled.

### Container build when host development headers are unavailable

```sh
docker build -f scripts/linux.Dockerfile -t nexa-linux-builder:local .
docker run --rm --user 1000:1000 -e CARGO_HOME=/work/.cache/cargo -e CARGO_TARGET_DIR=/work/target/linux -e XDG_CACHE_HOME=/work/.cache/build -v "$PWD:/work" nexa-linux-builder:local pnpm desktop:build --bundles deb,appimage
```

Run `pnpm install` first. Adjust the UID/GID to match your workspace ownership. Container outputs are under `target/linux/release/bundle/`; the executable is `target/linux/release/nexa-office`. Run the executable on the host graphical desktop, not in an unconfigured headless container.

## Safety and recovery

Save imported Office files as native working copies. Native saves retain the imported source package. Unmodified same-format exports preserve package parts; edited exports rebuild supported features and archive the original. Unsupported features can be preserved without being displayed or editable—this is not perfect round-trip compatibility.

Recovery snapshots are written separately, every 30 seconds by default (configurable). Home → Recover unsaved files restores them without overwriting the original. A successful durable save removes only recovery revisions no newer than that save. External modification blocks overwriting; use Save As for a separate copy. Locks are advisory: other applications can still change a file, so fingerprint checks remain necessary.

An unfinished spreadsheet cell is captured separately without ending the edit. Recovery restores that input as literal text with a notice and an Undo step back to the committed cell; complete it before treating it as a formula/number. Escape cancels the live draft. Input after the last successful recovery interval is not guaranteed to survive an abrupt crash.

Local settings, recent-file paths, recovery and logs live in Tauri's application-data directory (`app.nexa.office`, under the platform user-data root). Logs omit document and clipboard contents. Recent previews and recovery contain user data by design and should be protected like the documents themselves. No encryption-at-rest is promised.

## Verification, measurements and architecture

- [Architecture and boundaries](docs/architecture/overview.md), [decision records](docs/architecture/decisions/)
- [Native container specification](docs/file-formats/container.md), [NXD](docs/file-formats/NXD.md), [NXS](docs/file-formats/NXS.md), [NXP](docs/file-formats/NXP.md)
- [Office compatibility](docs/compatibility/office.md), [performance methodology and measured results](docs/performance.md)
- [Dependency investigation](docs/development/dependencies.md), [third-party inventory](THIRD_PARTY_LICENSES.md), [release/signing instructions](docs/development/releasing.md)
- [Verification workflows](docs/development/testing.md), [security and residual risks](docs/development/security.md)
- [Executed verification and local package checksums](docs/development/verification-2026-09-15.md)

`pnpm fixtures` generates owned compatibility fixtures and native desktop test inputs. `pnpm bench` generates realistic 1/50/300-page, 1k/100k/1m-cell, and 10/100/300-slide files and native I/O measurements. `node scripts/benchmark-ui.mjs` measures browser loading/scrolling. `node scripts/validate-office.mjs` optionally checks exported Office files with an installed LibreOffice; Nexa never requires LibreOffice to edit or convert files.

`scripts/native-qa.mjs` uses the official Tauri WebDriver, not a production test bypass. See the development documentation for the headless native test command. Test artifacts, screenshots, benchmarks and installers are generated under ignored `artifacts/` and `target/` directories; the repository keeps the source fixtures and semantic golden tests.

## Scope and limitations

Writer's editing canvas is continuous paper; the print view paginates. Advanced Word section layout, exact Office typography, advanced charts/pivots, imported slide themes/animations and media are not editable. Large models still incur snapshot/IPC costs and startup/idle-memory targets are measured goals, not guarantees. The spreadsheet's embedded engine has an English fallback for untranslated Catalan/Spanish advanced controls. See the matrix and performance report for precise limits.

Before public release: run Windows CI and clean-machine installer smoke tests, provision signing/update keys, complete bundled-platform license/source compliance, and expand the independent compatibility corpus. No private key belongs in this repository. Nexa branding is centralized in `packages/theme/branding.ts`; native identity/associations are in `tauri.conf.json` and icons under `public/` and `src-tauri/icons/`.

Project license: [MIT](LICENSE).
