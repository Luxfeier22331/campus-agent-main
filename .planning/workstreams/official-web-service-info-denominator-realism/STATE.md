---
doc_type: state
status: completed
created: 2026-05-02
updated: 2026-05-02
---

<!-- markdownlint-disable MD013 -->

# State: Official Web Service Info Denominator Realism

## Current Slice

All planned phases are complete. The official-web service-info denominator now distinguishes
release-blocking required evidence from optional source-backed evidence and propagates
`source_not_provided` through ingestion, release task evidence, app-api and panel projections.

## Blockers

- None.

## Verification Log

- `pnpm --filter official-web-core test -- target-inventory.test.ts config.test.ts policy.test.ts`
- `pnpm --filter official-web-collector test -- consumer-denominator.test.ts`
- `uv run --all-packages python -m unittest tests.ingestion.official_web_handoff_consumer_staging_suite tests.ingestion.test_official_web_release_task_admission tests.ingestion.test_release_official_web_selected_write`
- `pnpm --filter app-api test -- official-web-target-inventory.service.test.ts official-web-target-inventory.route.test.ts official-web-target-release-gates.service.test.ts`
- `pnpm --filter app-api typecheck`
- `pnpm --filter protected-panel-web typecheck`
- `pnpm web:lint`
- `pnpm docs:lint`
- `uv run --all-packages ruff check apps/ingestion-worker/src/campus_ingestion_worker/official_web_handoff_consumer_reporting.py apps/ingestion-worker/src/campus_ingestion_worker/release_official_web_selected_write.py packages/ingestion-core/src/campus_ingestion_core/official_web_release_task_admission.py tests/ingestion/official_web_handoff_consumer_staging_suite.py tests/ingestion/test_official_web_release_task_admission.py tests/ingestion/test_release_official_web_selected_write.py`
- `uv run --all-packages ruff format apps/ingestion-worker/src/campus_ingestion_worker/official_web_handoff_consumer_reporting.py apps/ingestion-worker/src/campus_ingestion_worker/release_official_web_selected_write.py packages/ingestion-core/src/campus_ingestion_core/official_web_release_task_admission.py tests/ingestion/official_web_handoff_consumer_staging_suite.py tests/ingestion/test_official_web_release_task_admission.py tests/ingestion/test_release_official_web_selected_write.py --check`
