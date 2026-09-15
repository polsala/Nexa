# Office compatibility — honest V1 matrix

Full means the listed basic semantic feature, not pixel-identical Office rendering. Partial means limited editable mappings. Preserved means source XML/assets survive in a native save and unmodified same-format export; they may not appear in the editor. Unsupported features are never executed or silently advertised as editable.

| DOCX feature                                          | Status                                                           |
| ----------------------------------------------------- | ---------------------------------------------------------------- |
| Paragraph text, Unicode, simple headings              | Full                                                             |
| Basic font, size, bold/italic/underline/strike, color | Partial (theme/style inheritance is limited)                     |
| Lists and nesting                                     | Partial                                                          |
| Basic rectangular tables                              | Partial (complex/vertical merged cells and table styles limited) |
| Embedded PNG/JPEG images                              | Partial (inline positioning, no Office crop/wrap parity)         |
| Hyperlinks                                            | Partial (safe HTTP(S)/mailto only)                               |
| Page size, orientation and margins                    | Full for a single section                                        |
| Headers/footers                                       | Partial (plain text, first supported part)                       |
| Comments, tracked changes, fields, custom styles      | Preserved but not editable                                       |
| Multi-section layout, text boxes, equations, SmartArt | Preserved but not editable                                       |
| VBA / active objects                                  | Never executed; quarantined source only                          |

| XLSX feature                                                | Status                                                                        |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Sparse cells, Unicode, numbers, booleans                    | Full                                                                          |
| Formulas and cached results                                 | Partial (common formulas recalculate; shared/array/external formulas limited) |
| Basic fonts, fills, alignment and number formats            | Partial                                                                       |
| Merged cells, row/column dimensions, frozen panes           | Full for supported basic ranges                                               |
| Multiple sheets                                             | Full                                                                          |
| Sorting/filtering/validation/conditional formatting in Nexa | Editable; native preservation                                                 |
| Imported advanced filters, rules, validations, named ranges | Preserved; OOXML mappings incomplete                                          |
| Charts                                                      | Native charts editable; Office chart parts preserved, not editable            |
| Pivot tables, external links, connections                   | Preserved but not editable; no fetching                                       |
| Macros                                                      | Never executed; quarantined source only                                       |

| PPTX feature                              | Status                                                                          |
| ----------------------------------------- | ------------------------------------------------------------------------------- |
| Static text and object positions          | Partial (rich runs/theme inheritance flatten on Office conversion)              |
| Rectangles, ellipses, lines/arrows        | Partial                                                                         |
| Embedded PNG/JPEG images                  | Partial                                                                         |
| Slide order and dimensions                | Full                                                                            |
| Speaker notes                             | Partial (plain text)                                                            |
| Tables, charts, SmartArt, grouped objects | Preserved but not editable                                                      |
| Layouts and themes                        | Partial (local layouts are explicit objects; Office master inheritance limited) |
| Transitions and animations                | Preserved but not played/edited                                                 |
| Embedded media, OLE, macros               | Never executed                                                                  |

## Preservation policy

Save imported files as NXD/NXS/NXP to retain all source parts. Export without edits to the original format retains original package parts byte-for-byte. After edits, supported parts are rebuilt; opaque non-macro parts are retained where safe and the original package is embedded at nexa/original.zip. This does not guarantee that Office will display disconnected legacy objects. Compatibility warnings explain this before a user exports. A native save is always the safest working copy.

Archive limits apply even to parts we do not edit. DTDs, traversal and oversized images cause a safe rejection. Encrypted Office packages and legacy .doc/.xls/.ppt binary formats are not supported. DOCM/XLSM/PPTM are accepted only as passive OOXML input with warnings, never macro-enabled output.

CSV/TSV are UTF-8 with quoted delimiters and newlines. Import treats leading '=' as text; export prefixes formula-like textual values to avoid spreadsheet injection. Export is the first worksheet's displayed values, not a workbook or style-preserving format.

PDF uses the local print view and system dialog. Writer uses configured page dimensions/margins; Slides uses one landscape page per slide. Sheets prints a multi-cell selection, or the active worksheet's used area when a single cell is selected, with displayed number formatting. Printing is bounded to 200 rows, 50 columns and 10,000 cells per operation; select a smaller range for larger sheets. Exact Office pagination, repeated headers/footers, merged-range printing, embedded fonts and complex spreadsheet page setup are not guaranteed. There is no cloud conversion. Automated Chromium PDF checks verify the render pipeline, not every OS-owned print dialog or printer driver.
