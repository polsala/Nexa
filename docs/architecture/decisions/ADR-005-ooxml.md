# ADR-005 — Conservative local OOXML compatibility

Status: accepted.

Use narrow owned mappings behind importer/exporter interfaces, built on bounded zip and roxmltree. The evaluated high-level libraries differ in scope, round-trip guarantees and stability; none removes the need for an independent loss-preservation boundary. See the dependency investigation and compatibility matrix.

V1 supports ordinary text, tables, images, sparse workbook cells/formulas/basic styles and static slide objects. It does not promise Word-identical layout or arbitrary Excel/PowerPoint features. Unedited source export keeps original package parts byte-for-byte. Edited export creates supported parts, retains opaque non-macro parts where safe and embeds the original package as nexa/original.zip. Changed relationships can leave opaque parts uneditable/unrendered: warn explicitly and keep the native source archive.

No macros, DTDs, network fetching, Office automation or mandatory LibreOffice. LibreOffice may independently validate test fixtures; it is not used by the application.
