# Quick Task 260414-regulation-effective-date-and-355282-materialization Verification

## Commands

1. `uv run --all-packages python -m unittest tests.ingestion.test_authenticated_notice_source_projections tests.ingestion.test_internal_notice_regulation_promotion tests.ingestion.test_internal_notice_regulation_materialization`
2. `uv run --all-packages python .planning/quick/260414-regulation-effective-date-and-355282-materialization/materialize_355282_isolated.py`

## Results

### 1. Targeted regression tests

- fresh result:
  - `Ran 51 tests in 0.457s`
  - `OK`

### 2. Isolated materialization for `355282`

- result:
  - `promotion_candidate_count = 1`
  - `materialized_document_count = 1`
  - created target:
    - `institutional_regulation:muc:中央民族大学关于学生使用人工智能的指导意见-2026版:8859071c0a7e`
- target metadata verified:
  - `semantic_owner_kind=attachment_document`
  - `source_notice_release_time=2026-03-27 15:15`
  - `effective_date=null`
