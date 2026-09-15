# Verification — 2026-09-15

Nexa Office 0.1.0 is a working release candidate. This report records executed checks, not a claim that every product target or Office feature is complete. Windows execution, public-release compliance and the idle-memory target remain open gates.

## Executed checks

Host: Linux x86_64, Node 24.13.0, pnpm 10.33.3, Rust 1.94.1. Native builds/tests use the provided Debian 12 container because the host lacks GTK/WebKit development headers. Browser tests use installed Chromium 148.0.7778.178; native tests use real WebKitGTK through Tauri WebDriver 2.0.6 and Xvfb.

| Check                                                                                 | Result                                                                        |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                                                      | Passed, including the checked-in Univer patch                                 |
| `pnpm typecheck`                                                                      | Passed, strict TypeScript                                                     |
| `pnpm lint`                                                                           | Passed, no disabled rules to hide failures                                    |
| `pnpm test`                                                                           | 15 tests passed                                                               |
| `pnpm test:e2e`                                                                       | 12 workflows passed                                                           |
| `cargo fmt --all --check`                                                             | Passed                                                                        |
| `cargo clippy --workspace --all-targets --locked -- -D warnings`                      | Passed                                                                        |
| `cargo test --workspace --locked`                                                     | 24 tests passed                                                               |
| `cargo check -p nexa-desktop --features signed-updates --locked`                      | Passed                                                                        |
| `pnpm build`                                                                          | Passed, also run by the native production build                               |
| `pnpm desktop:build --bundles deb,appimage`                                           | Both Linux packages built                                                     |
| Installed DEB native workflows, external network disabled                             | Passed                                                                        |
| Actual AppImage native workflows, external network disabled                           | Passed; runner exits successfully and cleans up its process group             |
| Debug native binary with the local Vite development server, external network disabled | Passed, including timed recovery across process restarts                      |
| DEB installation, MIME detection and uninstallation in a disposable container         | Passed for all three native extensions                                        |
| `pnpm release:checksums target/linux/release/bundle` and `sha256sum -c SHA256SUMS`    | Both packages verified                                                        |
| `pnpm audit --prod --audit-level high`                                                | No known vulnerabilities reported                                             |
| Cargo advisory scan                                                                   | No blocking advisories; seven informational warnings remain, documented below |
| Independent LibreOffice readability/PDF check                                         | DOCX: 1 page, XLSX: 1 page, PPTX: 2 pages                                     |

The final Cargo advisory rescan used the previously fetched database at commit `e2e640471715167f73e22eaf761f2e547adafeec`. Six unmaintained-package warnings and one GLib iterator soundness warning remain in the upstream desktop stack. See [dependency decisions](dependencies.md); passing Clippy is unrelated to advisory clearance. Vite still reports the large lazy-loaded Sheets/worker chunks.

## Workflow evidence

The packaged application was exercised through real UI controls and narrow production IPC, with no test-only native commands. Tests cover Writer typing/save/close/reopen; a real formula worker calculating `SUM(A1:A2)` as 32.5 and saving/reopening it; Slides notes/save/close/reopen; native recovery persistence/restore/discard; and retaining the active file path/lock after recovery discard. Native inputs are copies of owned fixtures in fresh temporary directories.

Native tests exposed delayed spreadsheet focus theft and an unfinished-cell save omission. Both were corrected, then retested in the installed DEB and AppImage. Writer/Slides assertions now include the full typed text, and the spreadsheet probe deliberately saves without pressing Enter. The AppImage runner also owns its subprocess group so the launcher cannot leave headless processes behind.

The final packages also preserve unfinished cell text in timed recovery without confirming it. Browser tests verify continued typing, Escape cancellation, crash-style restoration and Undo back to the committed value. Both native package probes restart the process twice around timed capture/UI restoration, checking that the draft and committed formula were stored separately and that the restored input persists as literal text. Invalid draft identities, coordinates, versions and size are rejected; direct Office export of an unresolved recovery record fails instead of dropping the draft.

Browser workflows additionally cover headings/tables/images, rich HTML/image clipboard, all 35 formula cases, multiple sheets, chart references and chronological undo, slide object clipboard/distribution/undo, localization/theme, recovery and rendered print PDFs. Rust golden tests import/export/reimport DOCX/XLSX/PPTX and assert normalized semantic properties, plus corrupted archives, traversal/expansion, image bounds, migrations, atomic replacement and recovery revision safety. The independent Office check uses LibreOffice only as a developer validator; it is not a Nexa runtime dependency.

Generated native evidence is in `artifacts/qa-deb/`, `artifacts/qa-appimage/` and `artifacts/qa-dev/`. Each `run.json` records status, timestamp and tested executable hash; `results.json` contains workflow and memory readings. The final debug run passed at 16:12 UTC after correcting the test harness to reuse the installed package-manager cache and wait for Vite before launching the WebView. Debug/Vite measurements are not production performance numbers. Browser screenshots/PDFs are under `artifacts/qa/`, compatibility output under `artifacts/compatibility/`, and benchmarks under `artifacts/benchmarks/`. These generated files are ignored by Git.

## Local packages

Under `target/linux/release/bundle/`:

- `deb/Nexa Office_0.1.0_amd64.deb`: 8,070,024 bytes.
- `appimage/Nexa Office_0.1.0_amd64.AppImage`: 102,578,680 bytes.
- `SHA256SUMS`: relative package checksums, suitable for `sha256sum -c` from the bundle directory.

```text
48656587dd15106ef09f7167151638707b9e48772fcac97d4bd90bbdad48949d  deb/Nexa Office_0.1.0_amd64.deb
51e1f28bf3ab1fc7377bdba060c482e116919647008e5bfca0d0955ee6fbfe88  appimage/Nexa Office_0.1.0_amd64.AppImage
```

The Linux MIME database identifies NXD/NXS/NXP correctly after installation, and the desktop entry forwards file arguments through `%F`. No Office defaults are registered. No package was installed into the host OS during these checks.

## Limits and remaining release gates

- Windows CI and NSIS configuration exist, but no Windows installer or Windows execution result was produced on this Linux host. Run the Windows workflow and clean-machine smoke test before calling Windows supported in a public release.
- The [performance report](../performance.md) records the nine real workloads. The headless native idle-memory target is **not met**, and million-cell loading still produces a substantial frontend task. Cold-start and hardware-rendered 60 FPS claims are not certified.
- The [Office matrix](../compatibility/office.md) is intentionally partial. Source preservation is not proof that edited Office exports reproduce unknown layout/objects. Native working copies are safest.
- Native printer dialogs, physical screen-reader behavior and full WCAG AA conformance still need platform testing. Some embedded spreadsheet controls fall back to English.
- Public release needs signing/channel setup and per-artifact platform license/source compliance. The generated notices inventory is not legal clearance for all AppImage system libraries. No private signing key or insecure unsigned updater is enabled.

The original project `LICENSE` was preserved. No user documents or existing source files were deleted. Verification itself did not commit or publish the repository; subsequent version-control operations are separate.
