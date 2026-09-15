# NXP — Nexa Presentation

Extension .nxp; MIME application/vnd.nexa.presentation. Container schema version 1. See [shared container rules](container.md).

content.kind is slides. deck contains width, height and an ordered nonempty slides array. Slides have id, name, background, notes and ordered objects (back to front). Each object has id, kind, x, y, width, height, rotation, fill, stroke, strokeWidth, text, fontSize, fontFamily, color, bold, italic, align, optional src and optional richText.

Kinds are text, rectangle, ellipse, line, arrow and image. Rotation is degrees around the object center. Text uses the same bounded semantic node representation as Writer where supported. Image data uses shared hashed assets. Geometry must be finite and bounded; negative dimensions are rejected.

The ordered array defines painting order. Pointer drags render transient previews and commit one undo transaction. Presenter mode reads the same deck, including notes. Native files do not depend on Office themes/masters or on a presentation license server.
