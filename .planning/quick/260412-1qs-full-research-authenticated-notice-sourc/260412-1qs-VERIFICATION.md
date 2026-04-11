# Quick Task 260412-1qs Verification

**Completed:** 2026-04-12  
**Status:** pass

## Verified Commands

```bash
UV_OFFLINE=1 uv run --all-packages python -m unittest tests.ingestion.test_authenticated_notice_import tests.ingestion.test_internal_notice_regulation_promotion tests.ingestion.test_authenticated_notice_source_truth_inventory
```

Result:

- `Ran 28 tests`
- `OK`

```bash
UV_OFFLINE=1 uv run --all-packages python -m unittest tests.ingestion.test_internal_notice_regulation_projection tests.ingestion.test_internal_notice_regulation_materialization tests.ingestion.test_internal_notice_regulation_candidate_chunk_prep tests.ingestion.test_prepare_internal_notice_regulation_candidate_chunks_worker
```

Result:

- `Ran 7 tests`
- `OK`

## Verified Outcomes

- source-truth manifest now preserves explicit `owner_expectations` when relation rows are missing
- inventory `parent_snapshot` keeps those expectations for downstream promotion
- promotion now prefers explicit owner expectation metadata before falling back to body heuristics
- attachment-backed / file-release-backed wrapper notices continue to fail closed instead of being promoted as regulation body
