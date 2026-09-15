# NXD — Nexa Document

Extension .nxd; MIME application/vnd.nexa.document. Container schema version 1. See [shared container rules](container.md).

content.kind is writer. content.body is a doc node containing paragraphs, headings (level 1–6), lists, tables and inline rich text. Nodes have type, optional text, attrs, marks and content. Supported nodes include paragraph, heading, text, hardBreak, pageBreak, bulletList, orderedList, listItem, table, tableRow, tableCell, tableHeader, image, horizontalRule, blockquote and codeBlock. Marks include bold, italic, underline, strike, textStyle, highlight, link, superscript and subscript.

Page stores width, height, margins in top/right/bottom/left order, and plain-text header/footer. Paragraph attributes include textAlign, indent, lineHeight and spaceAfter. Table cells carry colspan/rowspan and optional column widths. Images reference deduplicated assets, with width/height/align attributes. Links are restricted to HTTP(S), mailto or document anchors.

Native preserves the configured semantic content and supported formatting. Editing uses a continuous paper surface; print performs pagination. Native losslessness does not imply identical layout across different installed fonts. Original imported OOXML is retained separately.
