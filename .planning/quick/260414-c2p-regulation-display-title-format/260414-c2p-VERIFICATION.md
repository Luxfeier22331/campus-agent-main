# Quick Task 260414-c2p Verification

## Commands

1. `uv run --all-packages python -m py_compile packages/ingestion-core/src/campus_ingestion_core/internal_notice_regulation_promotion.py packages/ingestion-core/src/campus_ingestion_core/internal_notice_regulation_projection.py packages/ingestion-core/src/campus_ingestion_core/internal_notice_regulation_materialization.py`
2. `uv run --all-packages python -m unittest tests.ingestion.test_internal_notice_regulation_promotion tests.ingestion.test_internal_notice_regulation_projection tests.ingestion.test_internal_notice_regulation_materialization tests.ingestion.test_materialize_internal_notice_regulation_worker`
3. `rg -n '2026版|2026年修订|/ 2026|2026届|民大校发〔2025〕104号|regulation_display_title' docs/decisions/adr-0040-regulation-work-title-and-edition-separation.md docs/reference/institutional-regulations-promotion-quality-acceptance.md docs/runbooks/internal-notice-policy-regulation-promotion-runbook.md configs/ingestion/regulations/institutional_regulations/README.md configs/ingestion/regulations/institutional_regulations/canonical-profile.json .planning/STATE.md .planning/quick/260414-c2p-regulation-display-title-format tests/ingestion/test_internal_notice_regulation_promotion.py -S`

## Results

### 1. Syntax gate

- passed

### 2. Regulation-lane targeted suite

- passed
- `Ran 27 tests in 0.044s`
- `OK`

### 3. Doc truth grep

- passed
- repo 文档、planning artifacts 与回归测试已同时写明：
  - `display_title` 保留完整 `edition_label`
  - `... / 2026` 不是当前接受格式
  - `暂行 / 2026届 / 民大校发〔2025〕104号` 不得误拆成 `edition_label`
