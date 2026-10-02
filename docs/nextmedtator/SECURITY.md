# Security and privacy boundary

The new review workspace makes no clinical-data network requests. Source text and fields are rendered as text, not HTML. App installation fetches only an allowlisted immutable public asset inventory. Models are local-file imports in this preview; no inference API exists.

This statement does not qualify the inherited MedTator application. Legacy jQuery/HTML sinks and experimental network helpers require a separate audit. The build externalizes application scripts, precompiles Vue templates and sanitizes Vue `v-html`, but that alone is not proof that all legacy sinks are safe.

## Storage and provenance

Browser recovery is opt-in and contains potentially sensitive data. Exports may contain PHI. Browser extensions, shared computers, OS backups, cloud-synced folders and disk encryption are outside the application. Deletion is not a forensic-erasure guarantee. Hashes detect content corruption and track identity; they do not prove annotator identity or prevent deliberate local tampering.

ZIP imports enforce size, expansion, path, uniqueness and CRC limits. Native bundles verify every declared member hash and reject extra files. Annotation XML rejects DOCTYPE/ENTITY declarations. Legacy offset disagreement fails import rather than guessing. Model packages cannot install code plugins.

## Required live-origin tests

- Load, edit and export a canary document while recording all network requests and payloads.
- Install public assets, block the network, reload and complete/export a review.
- Verify model downloads/runtime binaries do not trigger an external inference request.
- Exercise two-tab recovery conflicts, quota errors, abrupt reload and stale export status.
- Verify original MedTator workflows under the generated CSP and sanitized rendering.
- Inspect local logs/console/error reports for accidental patient-content persistence.

The included real-origin test suite was blocked by environment policy, not passed. In-memory DOM tests are explicitly weaker and cannot substitute for these gates.
