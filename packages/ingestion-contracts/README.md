# campus-ingestion-contracts

Shared ingestion task contract schemas and lightweight validators.

This package is the source of truth for cross-runtime ingestion task shapes used
by TypeScript control-plane code and Rust kernel dispatch. Runtime packages must
validate task envelopes and task registries through the TypeScript validator or
JSON Schema instead of copying DTO rules.

Current contracts:

- `IngestionTaskEnvelope`
- `IngestionTaskRegistry`

The JSON fixtures under `fixtures/` are used by TypeScript tests and contract
schema checks.
