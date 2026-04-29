# Quick Task 260414-8rt Verification

## Commands

1. `uv run --all-packages python -m py_compile .planning/quick/260414-8rt-regulation-replay-rematerialization/replay_regulation_local.py`
2. `uv run --all-packages python -m unittest tests.ingestion.test_internal_notice_regulation_promotion tests.ingestion.test_internal_notice_regulation_projection tests.ingestion.test_internal_notice_regulation_materialization tests.ingestion.test_materialize_internal_notice_regulation_worker`
3. `uv run --all-packages python .planning/quick/260414-8rt-regulation-replay-rematerialization/replay_regulation_local.py`

## Results

### 1. Replay script syntax gate

- passed

### 2. Regulation targeted regression suite

- passed
- `Ran 25 tests in 0.049s`
- `OK`

### 3. Local replay/rematerialization

- passed
- isolated `355282` sample:
  - `promotion_candidate_count = 1`
  - `materialized_document_count = 1`
  - `target_document_id = institutional_regulation:muc:中央民族大学关于学生使用人工智能的指导意见:089bcf7907da`
  - `target_title = 中央民族大学关于学生使用人工智能的指导意见 / 2026版`
  - `canonical_heading = 中央民族大学关于学生使用人工智能的指导意见（2026版）`
- formal Cohort A local refresh:
  - `promotion_candidate_count = 10`
  - `materialized_document_count = 10`
  - `before_target_count = 10`
  - `after_target_count = 10`
  - replay 前 target rows 的 `regulation_work_title / regulation_display_title` 为空
  - replay 后 target rows 已补齐这些 metadata
