---
doc_type: plan
status: planned
created: 2026-04-30
updated: 2026-04-30
---

<!-- markdownlint-disable MD013 -->

# Plan: Phase 3 Retrieval Runtime Drift Guard

## Goal

Prevent runtime retrieval from silently querying an alias whose release metadata does not match the
current retrieval settings and runtime profile.

## Requirements

- Runtime can discover current alias release metadata.
- Runtime validates dense embedding model/dimensions, sparse settings, chunk/cleaning policy,
  collection alias, and validation status.
- Mismatch fails closed with a clear retrieval backend error.
- Manifest lookup is cached with bounded TTL.
- Tests do not require a live object store.

## Implementation Tasks

1. Add RED tests.
   - New retrieval tests for matching manifest, dense mismatch, sparse mismatch,
     chunk policy mismatch, missing manifest metadata, and cache behavior.

2. Add release metadata discovery.
   - Preferred path: read `index_release_manifest_key` from a point payload in the alias.
   - Fallback path: use point metadata only for fields already stored there.
   - Do not scan arbitrary object-store prefixes during online query.

3. Add manifest reader interface.
   - Inject test fake reader.
   - Production reader uses existing object-store settings only if accepted by runtime env.

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
- Matching release metadata does not add repeated object-store reads per request.
- Fail-closed behavior is covered by tests.
