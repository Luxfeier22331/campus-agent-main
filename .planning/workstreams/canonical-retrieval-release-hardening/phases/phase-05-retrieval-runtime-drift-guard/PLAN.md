---
doc_type: plan
status: planned
created: 2026-04-30
updated: 2026-04-30
---

<!-- markdownlint-disable MD013 -->

# Plan: Phase 5 Retrieval Runtime Drift Guard

## Goal

Prevent runtime retrieval from silently querying an alias whose release metadata does not match the
current retrieval settings and runtime profile.

## Requirements

- Runtime can discover current alias release metadata.
- Runtime validates dense embedding model/dimensions, sparse settings, chunk/cleaning policy,
  collection alias, and validation status.
- Mismatch fails closed with a clear retrieval backend error.
- Online request path reads Qdrant point payload / current release metadata only; object-store
  manifest is audit / recovery evidence and must not become request-path dependency.
- Alias release validation result is cached with bounded TTL / invalidation.
- Tests do not require a live object store.

## Implementation Tasks

1. Add RED tests.
   - New retrieval tests for matching manifest, dense mismatch, sparse mismatch,
     chunk policy mismatch, missing manifest metadata, and cache behavior.

2. Add release metadata discovery.
   - Preferred path: read required release identity fields from a point payload in the alias.
   - Allow a manifest key only as diagnostic/audit metadata, not as a request-path fetch
     requirement.
   - Do not scan arbitrary object-store prefixes during online query.

3. Add runtime metadata reader interface.
   - Inject test fake reader.
   - Production reader uses Qdrant payload/current metadata only.
   - Object-store manifest readers, if needed, stay in offline validation or operator tooling.

4. Add validation.
   - Compare against `RetrievalSettings`, `SparseEmbeddingSettings`, and
     `CollectionRuntimeProfile`.
   - Cache pass/fail per alias release id.

5. Wire error behavior.
   - Raise `RetrievalBackendError` with stable message.
   - Preserve existing empty-evidence behavior only for missing collection, not drift.

## Verification

```bash
uv run --all-packages python -m unittest \
  tests.retrieval.test_backend_qdrant \
  tests.retrieval.test_service
uv run --all-packages ruff check <touched-python-files>
uv run --all-packages ruff format <touched-python-files> --check
```

## Done Criteria

- Runtime drift is detected before returning evidence.
- Matching release metadata does not add object-store reads per request.
- Fail-closed behavior is covered by tests.
