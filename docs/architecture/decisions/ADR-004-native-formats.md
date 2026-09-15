# ADR-004 — Versioned native document formats

Status: accepted.

Use deterministic ZIP containers with manifest.json, content.json, metadata.json and SHA-256-addressed image assets. NXD, NXS and NXP share container rules but have distinct MIME types and discriminated content. Store semantic paragraphs, sparse cells and slide objects, not undocumented component state. Engine-specific optional resources live in named extension fields.

Checksums detect accidental corruption; they are not a cryptographic signature or encryption. Reject incompatible future major schemas rather than opening and dropping unfamiliar content. A migration dispatcher upgrades older supported versions in memory. Keep source OOXML in original/ so a native save does not discard uneditable imported material.
