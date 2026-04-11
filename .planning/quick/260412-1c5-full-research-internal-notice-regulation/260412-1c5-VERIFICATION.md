# Quick Task 260412-1c5 Verification

**Completed:** 2026-04-12  
**Status:** pass

## Verified Commands

```bash
UV_OFFLINE=1 uv run --all-packages python -m unittest tests.ingestion.test_internal_notice_regulation_promotion
```

Result:

- `Ran 12 tests`
- `OK`

```bash
UV_OFFLINE=1 uv run --all-packages python -m unittest tests.ingestion.test_internal_notice_regulation_materialization tests.ingestion.test_internal_notice_regulation_projection
```

Result:

- `Ran 3 tests`
- `OK`

```bash
UV_OFFLINE=1 uv run --all-packages python -m unittest tests.ingestion.test_internal_notice_regulation_candidate_chunk_prep tests.ingestion.test_prepare_internal_notice_regulation_candidate_chunks_worker
```

Result:

- `Ran 4 tests`
- `OK`

## Verified Outcomes

- promoted candidate / projected target docs now carry `semantic_owner_kind`
- missing attachment/file-release owner cases now keep explicit `owner_source_missing_reason`
- candidate export, projection, target materialization, and local-only candidate chunk-prep all remain green after the contract extension
