# Quick Task 260414-regulation-cohort-b-discovery Verification

## Commands

1. `set -a && source .env && set +a && CAMPUS_SHARED_POSTGRES_URL='postgresql://postgres:postgres@127.0.0.1:5432/campus_agent?sslmode=disable&gssencmode=disable' DOCUMENT_REGISTRY_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/campus_agent?sslmode=disable&gssencmode=disable' RAW_ASSET_REGISTRY_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/campus_agent?sslmode=disable&gssencmode=disable' AUTHENTICATED_NOTICE_SOURCE_TRUTH_INVENTORY_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/campus_agent?sslmode=disable&gssencmode=disable' uv run --package campus-ingestion-worker python -m campus_ingestion_worker.build_internal_notice_regulation_promotion_manifest --corpus campus_notices --collection internal_notice --output-dir .planning/quick/260414-regulation-cohort-b-discovery/run-output-verify`
2. `uv run --all-packages python -m unittest tests.ingestion.test_internal_notice_regulation_promotion`

## Results

### 1. Fresh current-scope manifest

- passed
- output: [run-output-verify/promotion-manifest.json](/home/reptilian/code/campus-agent/.planning/quick/260414-regulation-cohort-b-discovery/run-output-verify/promotion-manifest.json)
- `candidate_count = 10`
- `hold_count = 6`
- `manual_review_count = 5`
- fresh rerun 与 `run-output-after-parent-title-signal` 一致，说明 Cohort B direct parent-body expansion 仍为空

### 2. Targeted unit tests

- passed
- `Ran 19 tests`
- `OK`
