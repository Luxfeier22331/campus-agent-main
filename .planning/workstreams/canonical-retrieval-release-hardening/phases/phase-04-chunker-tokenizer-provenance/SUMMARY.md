---
doc_type: summary
status: completed
created: 2026-04-30
updated: 2026-04-30
---

<!-- markdownlint-disable MD013 -->

# Summary: Phase 4 Chunker And Tokenizer Provenance

## Result

Registry-scope chunk preparation manifests now record chunker/tokenizer/normalizer/document-units
provenance and mandatory release gates reject stale preparation identity.

## Changes

- Added preparation manifest fields:
  - `tokenizer_name`
  - `tokenizer_package_version`
  - `chunker_implementation_version`
  - `normalizer_version`
  - `document_units_schema_version`
  - `chunk_preparation_provenance_hash`
- Mandatory preparation scopes now validate provenance in addition to document scope,
  document-units content, chunk profile, and chunk fingerprint hashes.
- Existing optional-scope behavior remains backward-compatible when no preparation manifest is
  required.

## Verification

```bash
uv run --all-packages python -m unittest \
  tests.ingestion.test_internal_notice_scope_chunk_pipeline \
  tests.ingestion.test_regulation_serving_release_gates \
  tests.ingestion.test_chunking_policy
```

Result: `Ran 53 tests in 1.742s` / `OK`.
