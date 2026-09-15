# ADR-006 — Local-first privacy

Status: accepted.

No account, analytics, document upload, cloud conversion or remote fonts. Documents, recovery, logs and settings stay on the machine. Normal editing works air-gapped after installation. Production update publishing is disabled until a maintainer supplies a public verification key and an HTTPS release endpoint. Private signing keys must remain outside the repository.

Recovery is separate from the user's original file. Explicit durable save or explicit discard controls deletion. Saving never becomes an undo operation. Platform advisory locks and content fingerprints prevent accidental overwrite of another editor's changes.
