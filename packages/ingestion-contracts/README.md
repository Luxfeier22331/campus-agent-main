# ingestion-contracts

Shared ingestion task and canonical document-unit JSON Schemas plus the
TypeScript/Ajv validators used by ingestion owners.

This package is the source of truth for cross-runtime ingestion task shapes used
by TypeScript control-plane code and Rust kernel dispatch. Runtime packages must
validate task envelopes, task registries and canonical document units through
the TypeScript Ajv validator or the canonical JSON Schema instead of copying DTO
rules.

This package is not the ingestion runtime core. It must not import Temporal,
Crawlee, object-store clients, database clients or provider transports. Runtime
code may consume these contracts from `apps/*` / `jobs/*`; reusable ingest
helpers must remain runtime-neutral.

Current contracts:

- `CanonicalDocumentUnit`
- `IngestionReleaseManifest`
- `IngestionTaskEnvelope`
- `IngestionTaskRegistry`

Canonical document units use reader-facing identity fields: `doc_id`,
`version_id`, `chunk_id`, `root_unit_id`, `text`, `clean_text`, `metadata` and
`anchor`. Legacy `document_id` / `unit_id` input is not accepted for
`canonical_document_units.v1`.

The JSON assertions under `assertions/` are consumed by the TypeScript contract
tests. Files under `schemas/` are the only schema copies owned by this package.
