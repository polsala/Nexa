# Verification

Run the README commands before packaging. `cargo test` runs portable core crates; `cargo test --workspace` additionally builds the Tauri application and needs the native system headers. The Linux/Windows CI workflow is `.github/workflows/ci.yml`; the manual installer workflow is separate.

Do not run two Playwright invocations against the same workspace concurrently: they share the development server and output directory. Run performance measurements separately from compilers, installer compression and other browser tests. Production native assertions and browser development assertions are complementary, not interchangeable.

## Real native desktop tests

The official Tauri WebDriver starts the production binary in WebKitGTK on Linux. The test script uses real UI controls, normal OS command-line file grants and the same narrow native commands available to the shell. No arbitrary-path or test-only IPC command is compiled into Nexa.

```sh
pnpm fixtures
cargo install tauri-driver --version 2.0.6 --locked
sudo apt-get install -y webkit2gtk-driver xvfb dbus-x11
dbus-run-session -- xvfb-run -a node scripts/native-qa.mjs
```

By default the binary is `target/release/nexa-office`; set `NEXA_BINARY` for an installed binary or an AppImage, `NEXA_DRIVER` for a nonstandard driver path, and `NEXA_QA_OUTPUT` for separate evidence directories. Use isolated `XDG_DATA_HOME`, `XDG_CONFIG_HOME` and `XDG_CACHE_HOME` so test recovery/settings do not affect your normal profile. The script copies its native input fixtures to a fresh temporary directory before saving; it never edits committed originals.

For the provided Docker build (driver installed under the project cache):

```sh
docker run --rm --user 1000:1000 -e CARGO_HOME=/work/.cache/cargo -v "$PWD:/work" nexa-linux-builder:local cargo install tauri-driver --version 2.0.6 --locked --root /work/.cache/driver
docker run --rm --network none --user 1000:1000 -e XDG_DATA_HOME=/tmp/nexa-test-data -e XDG_CONFIG_HOME=/tmp/nexa-test-config -e XDG_CACHE_HOME=/tmp/nexa-test-cache -e NEXA_BINARY=/work/target/linux/release/nexa-office -e NEXA_DRIVER=/work/.cache/driver/bin/tauri-driver -v "$PWD:/work" nexa-linux-builder:local dbus-run-session -- xvfb-run -a node scripts/native-qa.mjs
```

The network-disabled run proves these workflows do not need external services. Results and screenshots are written to `artifacts/native-qa`. WebKitGTK's headless accessibility-bus warning is a test-environment warning; do not use this environment to certify screen-reader behavior. A clean desktop with a running accessibility bus is required for that audit.

The debug native binary can be tested against Vite as well: run `cargo build -p nexa-desktop --locked`, start `pnpm dev`, wait until `http://localhost:1420/` responds, then run the same probe with `NEXA_BINARY=target/debug/nexa-office` (or `target/linux/debug/nexa-office` for the container) and `NEXA_QA_OUTPUT=artifacts/qa-dev`. Use the same isolated XDG profile variables. For a network-disabled container with a fresh `XDG_CACHE_HOME`, set `COREPACK_HOME=/work/.cache/build/node/corepack` to reuse the package manager downloaded during the production build. Otherwise Corepack attempts a dependency download before the development server starts. None of this development tooling is shipped or needed by release packages.

## Compatibility

Owned DOCX/XLSX/PPTX fixtures live under `tests/fixtures/`. Rust imports, exports and reimports them against normalized semantic golden files. Additional tests cover nested lists, formulas, tables, notes, passive source preservation, malformed XML, archives and CSV injection. `node scripts/validate-office.mjs` independently opens the generated files in optional LibreOffice and checks its PDF output. This is a readability check, not OOXML schema certification or exact layout comparison.

Browser tests also exercise 35 formula cases through TSV clipboard input and the real formula worker, save/reopen boolean caches, chart undo chronology, image/HTML clipboard, recovery and generated Writer/Sheets/Slides print PDFs. The print tests deliberately intercept `window.print` to inspect the prepared render tree and use Chromium's PDF output; native OS print-dialog behavior still needs platform smoke testing.

The native probe deliberately types while another editor finishes initializing, asserts the entire input (including punctuation), and saves a formula without pressing Enter. These cases catch hidden-editor focus theft and the distinction between in-progress cell input and a committed workbook snapshot. Native failure diagnostics contain only synthetic fixture input; never run this diagnostic script against private documents or a normal user profile.

The unfinished-input regression leaves a formula in edit mode across timed recovery intervals, continues typing, cancels with Escape, and verifies that the next snapshot removes the cancelled draft. A fresh browser instance restores unfinished input as literal text, with Undo back to the committed value. The native runner additionally restarts the actual packaged process, inspects the persisted committed cell/draft through the normal recovery API, restores through Home, and restarts again to verify the restored literal cell was durably captured. No test-only engine globals are exposed in production.

## Performance

Generate fixtures with `pnpm bench`, then use `node scripts/benchmark-ui.mjs`. Set `NEXA_URL=http://127.0.0.1:4173` against `pnpm preview` for production assets. A run against Vite development mode is explicitly labelled and must not be presented as release performance. Keep the machine otherwise idle and report the engine, viewport, rendering backend and measurement boundaries.
