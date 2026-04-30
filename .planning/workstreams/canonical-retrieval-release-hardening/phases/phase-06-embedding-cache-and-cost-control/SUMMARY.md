---
doc_type: summary
status: completed
created: 2026-04-30
updated: 2026-04-30
---

<!-- markdownlint-disable MD013 -->

# Summary: Phase 6 Embedding Cache And Cost Control

## Result

Release builds now have an opt-in deterministic object-store embedding cache and report cache
effectiveness.

## Changes

- Added `campus_ingestion_core.embedding_cache`.
- Cache keys include text hash, provider, model, dimensions, document embedding mode, and
  collection profile identity.
- Cache values store provider/model/dimensions/text hash/vector JSON in object storage.
- Cache hit avoids provider calls; cache corruption / dimension mismatch fails closed.
- `release_registry_scope` enables cache with `INGESTION_EMBEDDING_CACHE_ENABLED=true`.
- `RegistryScopeReleaseReport` now reports hit/miss/provider-call counts.

## Verification

```bash
uv run --all-packages python -m unittest \
  tests.ingestion.test_embed \
  tests.ingestion.test_embedding_cache \
  tests.ingestion.test_registry_scope_release \
  tests.ingestion.test_index_release
```

Result: `Ran 34 tests in 0.284s` / `OK`.
