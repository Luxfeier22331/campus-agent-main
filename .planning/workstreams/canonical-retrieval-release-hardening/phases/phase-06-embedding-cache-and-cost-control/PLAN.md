---
doc_type: plan
status: planned
created: 2026-04-30
updated: 2026-04-30
---

<!-- markdownlint-disable MD013 -->

# Plan: Phase 6 Embedding Cache And Cost Control

## Goal

Add deterministic embedding cache for release builds, reducing repeated provider calls and making
rebuild cost observable.

## Requirements

- Cache key includes text hash, embedding provider/model/dimensions, doc/query mode, and relevant
  chunk/query profile identity.
- Cache value stores vector, dimension, created_at, provider/model metadata, and source text hash.
- Cache hit validates dimension and model identity.
- Cache miss calls provider and writes cache.
- Release report records hit/miss/provider-call counts.
- Cache corruption fails closed for the affected chunk and does not publish alias.

## Implementation Tasks

1. Add RED tests.
   - cache hit avoids provider call.
   - cache miss calls provider and writes cache.
   - dimension mismatch rejects cached vector.
   - release report includes cache stats.

2. Choose storage shape.
   - Preferred: object store value plus optional Postgres metadata pointer only if needed.
   - Do not store object bytes in Postgres.

3. Add embedding cache module.
   - Suggested module: `campus_ingestion_core.embedding_cache`.
   - Reader/writer protocol for tests.

4. Integrate with chunk embedding.
   - Release path uses cache-aware batch embedding.
   - Provider replay remains preview-safe and does not publish alias.

5. Update docs/runbook.
   - Cache invalidation rule.
   - Provider retry/cost counters.

## Verification

```bash
uv run --all-packages python -m unittest \
  tests.ingestion.test_embed \
  tests.ingestion.test_registry_scope_release \
  tests.ingestion.test_index_release
uv run --all-packages ruff check <touched-python-files>
uv run --all-packages ruff format <touched-python-files> --check
pnpm docs:lint
```

## Done Criteria

- Re-running a release over unchanged chunks can use cached embeddings.
- Cache identity is strict enough to avoid cross-model vector reuse.
- Release reports expose cache effectiveness.
