# NXS — Nexa Spreadsheet

Extension .nxs; MIME application/vnd.nexa.spreadsheet. Container schema version 1. See [shared container rules](container.md).

content.kind is sheets. workbook contains sheets, charts and extensions. Each worksheet has a unique id/name, rowCount, columnCount, cells, merges, freeze, rowDimensions, columnDimensions and extensions. Cell keys are zero-based sparse row/column indices represented as JSON object keys; empty grid coordinates need no records.

Cells contain a string/number/boolean/null value, optional canonical formula beginning with '=', format, richText and extensions. Formula results are caches, recalculated by the OSS engine. Numeric dates use Excel-compatible number formatting, not local formatted text. Canonical formula names remain English regardless of UI locale.

Charts reference a sheet ID and an inclusive zero-based rectangular range; chart series are derived from real current cell values. Supported local charts: bar, line, donut/pie and scatter. Charts and all extension resources survive native save/reopen; OOXML chart fidelity is separately documented.

Common font/number/alignment styles have engine-independent keys. Versioned Univer resources for validation, conditional formatting, named ranges and filters are retained in extensions; an adapter migration is required before changing their engine version. The entire workbook is not an undocumented raw Univer state dump.

## Unfinished cell recovery

Timed recovery snapshots may include an optional document-level `recoveryDraft`: `{ "version": 1, "sheetId": "…", "row": 0, "column": 0, "text": "=SUM(A2:" }`. Coordinates are zero-based, must address an existing worksheet and fall within its dimensions; text is limited to 1 MiB UTF-8. This additive schema-1 field is engine-independent. Older readers may ignore it, so use this version or newer to recover unfinished input.

The committed cell in `content` is **not changed** by capturing a draft, and capture does not confirm input or move focus. Cancelling input increments the recovery revision and removes the draft from the next timed snapshot. On restore, the text is applied literally through an ordinary undoable cell command, with a localized notice; Undo returns to the committed cell. An unfinished formula is not evaluated. Complete and confirm the restored text to interpret it as a formula/number. In-progress rich-text styling is not restored; the draft guarantees text preservation, while previously committed formatting remains in the model.

Explicit Save commits the live editor first and emits ordinary content without `recoveryDraft`. Direct Office export of an unresolved recovery record is rejected, so converters cannot silently omit it. As with all timed recovery, input after the most recent successful interval can still be lost in an abrupt crash.
