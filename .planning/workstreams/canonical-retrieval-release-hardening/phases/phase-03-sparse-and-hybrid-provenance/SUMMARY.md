---
doc_type: summary
status: completed
created: 2026-04-30
updated: 2026-04-30
---

<!-- markdownlint-disable MD013 -->

# Summary: Phase 3 Sparse And Hybrid Provenance

## Result

Index release manifest and Qdrant point release metadata now carry sparse and hybrid retrieval
identity.

## Changes

- Added manifest / point payload fields for:
  - sparse provider / model / tokenizer / language
  - dense and sparse vector names
  - dense and sparse prefetch limits
  - RRF k and dense/sparse weights
  - embedding query instruction hash
  - hybrid query profile hash
- Registry-scope release passes runtime profile and sparse settings into manifest construction.
- Provider-response replay indexing now records the same provenance without changing alias publish
  posture.
- Qdrant backup manifest loading remains backward-compatible with older release manifests.

## Verification

```bash
uv run --all-packages python -m unittest \
  tests.ingestion.test_index_release \
  tests.ingestion.test_registry_scope_release \
  tests.ingestion.test_qdrant_backup \
  tests.ingestion.test_qdrant_backup_worker \
  tests.ingestion.provider_result_replay_rebuild_index_suite \
  tests.ingestion.provider_result_replay_rebuild_replay_indexing_suite
```

Result: `Ran 37 tests in 1.940s` / `OK`.
