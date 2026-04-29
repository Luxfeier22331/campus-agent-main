# Quick Task 260412-0qr Verification

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
UV_OFFLINE=1 uv run --all-packages python -m unittest tests.ingestion.test_internal_notice_regulation_materialization
```

Result:

- `Ran 2 tests`
- `OK`

```bash
UV_OFFLINE=1 uv run --all-packages python -m unittest tests.ingestion.test_internal_notice_regulation_projection tests.ingestion.test_internal_notice_regulation_candidate_chunk_prep tests.ingestion.test_prepare_internal_notice_regulation_candidate_chunks_worker
```

Result:

- `Ran 5 tests`
- `OK`

## Verified Outcomes

- attachment-backed wrapper notice without recovered attachment owner now fails closed to `manual_review_required`
- file-release-backed wrapper notice without recovered owner document now fails closed to `manual_review_required`
- existing regulation materialization / projection / candidate chunk-prep paths remain green
