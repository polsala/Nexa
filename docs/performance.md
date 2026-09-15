# Performance — measured, not promised

Release candidate 0.1.0, measured 2026-09-15 on Linux x86_64: Intel Core i7-1165G7 (4 cores/8 threads), 32 GiB RAM, local SSD-backed workspace, Linux 6.19.14. Rust 1.94.1 release profile, Node 24.13.0, production Vite assets, Chromium 148.0.7778.178 headless at 1360 × 900. Native GUI tests use Debian 12/WebKitGTK under Xvfb, with software rendering and the external network disabled.

These are single-run samples on this machine, not statistically established cross-platform guarantees. Benchmarks ran separately from compilers and installer compression. Warm filesystem caches were not flushed. Browser numbers are not native WebKit memory numbers.

## Native encode / durable save / reopen

Run `pnpm bench`. It generates semantic, editable workloads with 1/50/300 explicitly separated Writer pages, 1k/100k/1m populated spreadsheet cells (20 columns, formulas in the twentieth), and 10/100/300 slides (three objects and notes each). Writer text is deliberately repetitive, and there are no photographic assets: compression ratios and timings do not model every real document.

Each row encodes a model, writes it using the real tempfile/fsync/atomic-replacement service, reads and decodes the native file, and asserts exact model equality. Times are milliseconds. Save total is encode + durable write; reopen includes filesystem read, decompression, checksum and model validation, but not IPC, editor construction or formula recalculation.

| Editor | Pages / cells / slides | Encode ms | Durable write ms | Reopen ms |
| ------ | ---------------------: | --------: | ---------------: | --------: |
| Writer |                      1 |      0.32 |            13.33 |      0.14 |
| Writer |                     50 |      1.32 |            12.66 |      1.98 |
| Writer |                    300 |      9.67 |            12.85 |      9.63 |
| Sheets |                  1,000 |      0.39 |            13.30 |      1.60 |
| Sheets |                100,000 |     49.72 |            13.22 |     44.07 |
| Sheets |              1,000,000 |    519.70 |            22.25 |    507.91 |
| Slides |                     10 |      0.21 |            12.98 |      0.17 |
| Slides |                    100 |      0.94 |            13.12 |      1.09 |
| Slides |                    300 |      3.56 |            12.54 |      3.16 |

The largest workbook archive was 3.16 MiB. The benchmark process reached 723.1 MiB high-water RSS with both source and reopened models present. This is cumulative for the sequential benchmark process, **not** per-editor idle memory. Earlier implementation measurements exposed excess generic JSON/model copies; typed content deserialization and the sparse Sheets fast path removed those copies. Source snapshots/IPC are still material costs.

## Production editor loading and scrolling

Run `pnpm build`, `pnpm preview`, then in another terminal:

```sh
NEXA_URL=http://127.0.0.1:4173 node scripts/benchmark-ui.mjs --all
```

Each workload gets a fresh browser process. Open time starts at file-chooser delivery and stops when its editing surface and content/count are present. It includes the browser native-file adapter and lazy editor-module loading, **not** completion of every background formula. JS heap is the main renderer's reported used heap before scrolling, not process RSS and not the formula worker's heap. DOM nodes include the shell. The long-task observer records tasks over 50 ms; the scrolling probe issues twenty wheel events 50 ms apart.

| Editor |      Size | Open ms | Main JS heap MiB | DOM nodes | Longest opening task ms | Scrolling tasks >50 ms |
| ------ | --------: | ------: | ---------------: | --------: | ----------------------: | ---------------------: |
| Writer |         1 |  834.15 |             6.91 |       580 |                      84 |                      0 |
| Writer |        50 |  840.98 |             5.78 |     1,168 |                      83 |                      0 |
| Writer |       300 |  814.42 |             7.44 |     4,168 |                     220 |                      0 |
| Sheets |     1,000 | 1432.64 |            40.20 |     1,159 |                     175 |                      0 |
| Sheets |   100,000 | 1402.03 |            47.21 |     1,159 |                     165 |                      0 |
| Sheets | 1,000,000 | 2626.54 |           166.48 |     1,159 |                     689 |                      0 |
| Slides |        10 |  830.16 |             6.32 |       686 |                      85 |                      0 |
| Slides |       100 |  834.96 |             7.24 |     2,576 |                      87 |                      0 |
| Slides |       300 |  838.34 |             9.17 |     6,776 |                      88 |                      0 |

This production run was recorded at 16:05 UTC on 2026-09-15 after the draft-recovery changes. All nine cases reported zero JavaScript page errors. Spreadsheet DOM size stayed at 1,159 nodes from 1,000 to 1,000,000 cells: there is no DOM element per cell. Writer and slide thumbnails are document DOM/SVG and grow with content. This short scrolling probe recorded no long tasks, but an earlier 10:30–10:31 UTC run did record one/four/four for the three spreadsheet sizes (87/80/65 ms longest). This is **not a measured 60 FPS certification**. The final million-cell opening still produced a 689 ms frontend task and needs further optimization.

Runs on this shared machine varied materially, including earlier million-cell samples around 2.56, 5.24 and 7.61 seconds. The 5.24-second run produced a 1,373 ms opening task. The table reports the latest completed production run at the stated timestamp, not the fastest sample. Background system activity was not fully controlled, and these samples do not establish a regression cause, an optimization speedup or a performance percentile.

Raw generated evidence is under `artifacts/benchmarks/results.json` and `ui-all-results.json`, alongside the fixtures and screenshots. The UI script now archives the previous JSON report under `artifacts/benchmarks/history/` before each run; the earlier 10:30–10:31 UTC evidence was retained. Fixtures/screenshots are regenerated, not user documents.

## Native desktop startup and memory

The installed DEB's real WebKitGTK probe reached Home in 438 ms including WebDriver session setup on a warm filesystem (16:03 UTC, 2026-09-15). A controlled cold-start result and Windows timings are not available. The <=1.8-second cold-start goal is therefore not certified.

The actual AppImage reached Home in 1,140 ms with `APPIMAGE_EXTRACT_AND_RUN=1`, including launcher extraction and WebDriver session setup (16:04 UTC). Its three-second Home sample was 700.5 MiB RSS / 507.5 MiB PSS. This is a separate single run, not a controlled DEB-versus-AppImage comparison; raw evidence is in `artifacts/qa-appimage/results.json`.

After waiting three seconds at Home, the DEB probe measured 708.9 MiB summed RSS / 511.7 MiB proportional set size, and 1,282.8 MiB RSS / 1,083.2 MiB PSS with the three editor types initialized. RSS sums double-count shared libraries. The measurements include Nexa plus its WebKit web/network processes, but exclude the WebDriver, compiler and container runtime. Software rendering, font/shader initialization and native WebView allocations make these very different from the browser JS-heap numbers. The run timestamp, executable SHA-256 and individual process readings are in `artifacts/qa-deb/results.json`.

**The <=180 MiB empty-suite target was not met in this environment.** Hardware-rendered clean-desktop profiling, longer settled-idle sampling and tab/worker memory reclamation remain release-quality work. Do not advertise the target as achieved or equate a small installer with low runtime memory.

## Bundle and regression controls

The initial shell JS is about 340 kB minified / 106 kB gzip. Sheets (~6.90 MB) and its formula worker (~7.59 MB) are lazy-loaded; the shell does not wait for them. Vite's large-chunk warning remains visible because engine payload reduction is still relevant. Debug source maps are opt-in through `NEXA_SOURCEMAPS=1`; removing them reduced shipped frontend assets from about 70 MiB to 20 MiB and the Linux DEB from about 15 MiB to 7.7 MiB including final MIME metadata packaging.

Avoid simultaneous benchmark/build jobs. Repeat on battery and mains, multiple fresh launches, physical Windows and Linux desktops, representative fonts, and image-heavy documents before publishing broad performance claims. Add long-session memory growth, native million-cell IPC timing, cancellation latency and percentile measurements to the release corpus.
