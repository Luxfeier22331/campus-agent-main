# Quick Task 260411-pzz Verification

## Executed Checks

- `uv run --all-packages python -m unittest tests.ingestion.test_internal_notice_regulation_projection tests.ingestion.test_internal_notice_regulation_candidate_chunk_prep tests.ingestion.test_prepare_internal_notice_regulation_candidate_chunks_worker`
- `uv run --all-packages python -m unittest tests.ingestion.test_internal_notice_regulation_promotion tests.ingestion.test_export_internal_notice_regulation_candidate_artifacts_worker tests.ingestion.test_internal_notice_regulation_materialization tests.ingestion.test_internal_notice_regulation_candidate_chunk_prep tests.ingestion.test_prepare_internal_notice_regulation_candidate_chunks_worker tests.ingestion.test_internal_notice_regulation_projection tests.ingestion.test_processing_pipeline tests.test_workspace_layout`
- `uv run --all-packages python .planning/quick/260411-ptg-institutional-regulations-cohort-a-targe/cohort_a_target_chunk_acceptance.py --output-dir .planning/quick/260411-pzz-institutional-regulations-structure-awar`

## Observed Results

- Targeted + regression unit tests:
  - `51/51` passed
- Cohort A rerun summary:
  - `promotion_candidate_count = 1`
  - `promotion_manual_review_count = 10`
  - `prepared_candidate_count = 1`
  - `quality_posture = ready_for_target_materialization`
  - `short_body_chunk_count = 0`
  - `failed_candidate_ids = []`

## Final Verdict

- `institutional_regulations` 的 structure-aware short-fragment merge tuning 已通过 repo-local 验收。
- 当前唯一 promoted candidate `187233` 不再存在 target-side short fragment blocker。
