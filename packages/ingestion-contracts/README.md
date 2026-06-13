# campus-ingestion-contracts

Shared ingestion task contract schemas and lightweight validators.

This package is the source of truth for cross-runtime ingestion task shapes used
by TypeScript control-plane code and Python worker execution seams. Runtime
packages must validate task envelopes and task registries through this package
instead of copying DTO rules.

Current contracts:

- `IngestionTaskEnvelope`
- `IngestionTaskRegistry`

The JSON fixtures under `fixtures/` are used by both TypeScript and Python tests.
