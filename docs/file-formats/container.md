# Nexa container specification — version 1

All integers are JSON numbers within the documented domain limits. Text is UTF-8. Geometry is CSS pixels (96 per inch). Dates in document metadata are Unix milliseconds. The Rust document-model crate is the authoritative validator; TypeScript mirrors it.

Machine-readable companion contracts: [document JSON Schema](schema-v1.json) and [manifest JSON Schema](manifest-v1.schema.json). Runtime validation additionally enforces aggregate allocation, archive and image limits that JSON Schema alone does not express.

## ZIP layout

```text
manifest.json             format identity and per-part SHA-256
content.json              schema-versioned semantic document
metadata.json             title, timestamps, revision
assets/<sha256>.png        optional deduplicated images (also jpg/webp)
original/<package-part>   optional imported source parts
original/.nexa/baseline.json   source semantic comparison baseline
previews/                 reserved optional preview resources
compatibility/            reserved optional capability reports
```

Optional directories are omitted when empty. Entries are ordered by name, ZIP timestamps are fixed, and duplicate asset bytes share one path. The manifest itself is not hashed. Every other entry must appear exactly once in checksums; extra, missing, duplicate or corrupt entries are rejected. Hashes are lowercase hexadecimal SHA-256. This detects corruption, not hostile re-signing.

The manifest contains format="nexa", schemaVersion=1, mime, documentId, editor, editorVersion and checksums. content.json contains schemaVersion, UUID id, title, createdAt, modifiedAt, revision, content and metadata. Its kind and ID must match the manifest.

Image sources are asset://assets/<hash>.<ext> in the archive and bounded data URLs in memory. PNG/JPEG/WebP headers are checked before display; external image URLs and SVG script content are not accepted.

## Migration and forward fields

The supported legacy version 0 migrates to version 1 by adding a revision where missing. All migrations run before model validation, in memory, and never rewrite the source automatically. Future major schema/container versions are rejected with a useful error. Unknown top-level document fields survive through a flattened extension map; optional engine resources use explicit extension maps. Unknown node kinds are rejected, not silently flattened. Producers must not encode indispensable new behavior under an unchanged schema version.

## Limits

Compressed archive: 512 MiB. Expanded sum: 1 GiB. Single part: 256 MiB. Entries: 16,384. Expansion ratio: 500:1 for parts above 1 MiB. No absolute paths, dot segments, backslashes, drive prefixes, duplicate parts or symlinks. XML: 128 MiB per part, 4 million nodes and depth 64; DTDs disabled. Images: 32 MiB, maximum side 16,384 pixels, 64 million pixels. Spreadsheet: 1,048,576 rows by 16,384 columns, at most 2 million populated cells. Writer node depth: 48. See validators for other geometry and object limits.

## Recovery

A .recovery file is the same valid native container, in the application data directory, not alongside the original. Durable save uses a synced same-directory temporary file and atomic replacement. Recovery at a newer revision than a save result cannot be deleted by that save. Kernel locks are automatically released after a crash; the zero-content sidecar filename may remain and is not evidence of a live lock.
