# Quick Task 260412-k7s Verification

## Commands

1. `uv run --all-packages python .planning/quick/260412-k7s-internal-notice-institutional-regulation/materialize_institutional_regulations_local_only.py`
2. `uv run --all-packages python -m py_compile packages/ingestion-core/src/campus_ingestion_core/raw_ingestion.py`
3. `uv run --all-packages python -m unittest tests.ingestion.test_internal_notice_regulation_materialization tests.ingestion.test_materialize_internal_notice_regulation_worker`

## Results

### 1. Local-only materialization acceptance

- passed
- `promotion_candidate_count = 10`
- `materialized_document_count = 10`
- `manual_review_not_materialized = true`
- write manifest shows `20` derived-object writes under the quick-task output root only

### 2. Syntax gate

- passed
- `raw_ingestion.py` no longer fails Python compilation

### 3. Targeted unit tests

- passed
- `Ran 3 tests`
- `OK`
