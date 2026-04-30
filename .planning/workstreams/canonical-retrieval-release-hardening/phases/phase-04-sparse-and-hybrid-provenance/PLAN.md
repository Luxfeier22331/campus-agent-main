---
doc_type: plan
status: planned
created: 2026-04-30
updated: 2026-04-30
---

<!-- markdownlint-disable MD013 -->

# Plan: Phase 4 Sparse And Hybrid Provenance

## Goal

Make release manifest and point payload fully describe dense, sparse, and hybrid retrieval identity.

## Requirements

- Release manifest records sparse provider/model/tokenizer/language.
- Release manifest records hybrid query profile: dense/sparse vector names, prefetch limits,
  RRF k/weights, and embedding query instruction hash.
- Point payload carries enough metadata for runtime drift guard and backup validation.
- Qdrant backup loader remains backward-compatible with older manifests.

## Implementation Tasks

1. Add RED tests.
   - `tests/ingestion/test_index_release.py`.
   - `tests/ingestion/test_registry_scope_release.py`.
   - `tests/ingestion/test_qdrant_backup.py`.
   - provider replay tests.

2. Extend dataclasses.
   - `IndexReleaseManifest`.
   - release document/ref payload as needed.

3. Extend builders.
   - `build_index_release_manifest`.
   - `build_release_metadata_payload`.
   - `publish_scope_release`.
   - provider replay indexing path.

4. Extend backup/restore compatibility.
   - Missing fields load as empty/default.
   - New fields round-trip in backup validation.

5. Update docs.
   - `docs/reference/runtime-serving-and-index-terms.md`.
   - release runbook if operator-visible fields change.

## Verification

```bash
uv run --all-packages python -m unittest \
  tests.ingestion.test_index_release \
  tests.ingestion.test_registry_scope_release \
  tests.ingestion.test_qdrant_backup \
  tests.ingestion.test_qdrant_backup_worker \
  tests.ingestion.provider_result_replay_rebuild_index_suite \
  tests.ingestion.provider_result_replay_rebuild_replay_indexing_suite
pnpm docs:lint
```

## Done Criteria

- New release manifests can prove sparse/hybrid identity.
- Old release manifests remain readable.
- Provider replay preview artifacts include provenance without alias publish.
