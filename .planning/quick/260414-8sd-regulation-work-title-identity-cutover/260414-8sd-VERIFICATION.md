# Quick Task 260414-8sd Verification

## Commands

1. `uv run --all-packages python -m py_compile packages/ingestion-core/src/campus_ingestion_core/internal_notice_regulation_projection.py packages/ingestion-core/src/campus_ingestion_core/internal_notice_regulation_materialization.py`
2. `uv run --all-packages python -m unittest tests.ingestion.test_internal_notice_regulation_projection tests.ingestion.test_internal_notice_regulation_materialization`
3. `uv run --all-packages python -m unittest tests.ingestion.test_internal_notice_regulation_promotion tests.ingestion.test_internal_notice_regulation_projection tests.ingestion.test_internal_notice_regulation_materialization tests.ingestion.test_materialize_internal_notice_regulation_worker`
4. `rg -n 'regulation_work_title|regulation_display_title|regulation_work_title_issuing_org_semantic_scope_hash|repo-local display convention' configs/ingestion/regulations/institutional_regulations configs/ingestion/campus_notices/internal_notice docs/reference/institutional-regulations-promotion-quality-acceptance.md docs/runbooks/internal-notice-policy-regulation-promotion-runbook.md docs/architecture/domains/authenticated-notice/architecture.md .planning/STATE.md .planning/quick/260414-8sd-regulation-work-title-identity-cutover -S`

## Results

### 1. Syntax gate

- passed
- `uv run --all-packages python -m py_compile packages/ingestion-core/src/campus_ingestion_core/internal_notice_regulation_projection.py packages/ingestion-core/src/campus_ingestion_core/internal_notice_regulation_materialization.py`

### 2. Focused identity/title tests

- passed
- `Ran 4 tests in 0.012s`
- `OK`

### 3. Full regulation-lane targeted suite

- passed
- `Ran 25 tests in 0.044s`
- `OK`

### 4. Doc truth grep

- passed
- current execution truth entry docs all show:
  - `document_id <- regulation_work_title + issuing_org + semantic_scope`
  - projected/materialized `title <- regulation_display_title`
  - slash display form is documented as repo-local display convention
