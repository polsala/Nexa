# Compatibility fixtures
The committed semantic DOCX/XLSX/PPTX fixtures are owned/generated test data (repository MIT license), not copied user documents. Regenerate deliberately with pnpm fixtures and review golden diffs. Rust tests import, compare normalized models, export without edits (byte-identical package parts), rebuild without the source shortcut, reopen and compare semantic goldens.

pnpm test:e2e exercises browser editing, canvas formulas, native save/reopen and recovery. node scripts/validate-office.mjs optionally verifies that the committed generated packages open in an independently installed LibreOffice and produce real PDFs; LibreOffice is not an application dependency. A PDF conversion passing is evidence of readability, not complete schema or Microsoft Office layout compliance.

Generated large benchmark files are ignored under artifacts/benchmarks and must not bloat the source repository.
