---
doc_type: summary
status: completed
created: 2026-04-30
updated: 2026-04-30
---

<!-- markdownlint-disable MD013 -->

# Summary: Phase 5 Retrieval Runtime Drift Guard

## Result

Retrieval runtime now validates alias release metadata before querying when Qdrant point payload
contains release identity.

## Changes

- Added `campus_retrieval_core.backend_qdrant_release_guard`.
- `QdrantRetrievalBackend.retrieve` now reads one alias point payload and compares release metadata
  against current `RetrievalSettings` and `CollectionRuntimeProfile`.
- Guard compares dense embedding identity, sparse identity, cleaning/chunk policy, vector names,
  hybrid prefetch/RRF settings, query instruction hash, and validation status.
- Mismatch or partial release metadata fails closed with `RetrievalBackendError` before
  `query_points`.
- Matching validation is cached with bounded TTL.
- Existing query-mock unit tests remain isolated from online guard behavior.

## Verification

```bash
uv run --all-packages python -m unittest \
  tests.retrieval.test_backend_qdrant \
  tests.retrieval.test_service
```

Result: `Ran 125 tests in 4.690s` / `OK`.
