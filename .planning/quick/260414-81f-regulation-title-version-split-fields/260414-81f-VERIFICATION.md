# Quick Task 260414-81f Verification

## Commands

1. `uv run --all-packages python -m py_compile packages/ingestion-core/src/campus_ingestion_core/internal_notice_regulation_promotion.py packages/ingestion-core/src/campus_ingestion_core/internal_notice_regulation_projection.py`
2. `uv run --all-packages python -m unittest tests.ingestion.test_internal_notice_regulation_promotion tests.ingestion.test_internal_notice_regulation_projection tests.ingestion.test_internal_notice_regulation_materialization tests.ingestion.test_materialize_internal_notice_regulation_worker`
3. `rg -n "regulation_work_title|regulation_edition_label|regulation_display_title|source_title_literal|ADR-0040" docs configs .planning/STATE.md .planning/quick/260414-81f-regulation-title-version-split-fields -S`

## Results

### 1. Syntax gate

- passed
- `uv run --all-packages python -m py_compile packages/ingestion-core/src/campus_ingestion_core/internal_notice_regulation_promotion.py packages/ingestion-core/src/campus_ingestion_core/internal_notice_regulation_projection.py`
- promotion / projection modules compile successfully

### 2. Targeted regulation-lane tests

- passed
- `Ran 24 tests in 0.047s`
- `OK`
- promotion / projection tests pass
- materialization tests prove split metadata survives into target document metadata
- worker request wiring remains unchanged

### 3. Doc truth grep

- passed
- current docs and planning artifacts show:
  - split metadata is now current execution metadata truth
  - identity migration remains ADR-0040 target, not current truth
