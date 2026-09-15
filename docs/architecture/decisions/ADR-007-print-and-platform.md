# ADR-007 — Local deterministic print view

Status: accepted with limitations.

Print/PDF uses an isolated semantic print tree and the OS WebView print pipeline. Writer honors page size and margins; Slides renders one landscape slide per page; Sheets uses a bounded printable table. This is an independent output tree, never a screenshot of the editing UI. The platform print dialog can save as PDF where available. No remote conversion and no mandatory extra runtime.

Exact Word pagination, complex repeating headers, spreadsheet charts in print and font embedding are outside this version's fidelity guarantee. Print behavior must be exercised on both WebKitGTK and WebView2. A native PDF renderer can replace the output adapter without changing editor models.
