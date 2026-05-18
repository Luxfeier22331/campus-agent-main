---
doc_type: phase_summary
status: completed
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 6 Summary: Ingestion Projection Admission

## Completed

- Official-web replay now reads `targetMatches` from target-workset source-truth before falling back to legacy `consumerMatches`.
- Replay reports now expose `collection_mode`, `target_family_counts`, `target_materialization_policy_counts`, and `target_lineage_issues`.
- Target-workset pages missing lineage are reported as projection admission issues and fail validation.
- Target lineage is projected into stable-reference documents and contact/service/notice candidate rows.
- `notice_news_candidate` stays inventory-only and maps to `official_web_public_notice` source-family metadata without introducing `public_notice_inventory`.
- Promotion quality gate blocks missing/invalid target lineage and inventory-only promotable documents.
- Direct official-web projection import rejects inventory-only target documents when promotable import is required.

## Verification

```bash
uv run --all-packages python -m unittest tests.ingestion.official_web_projection_core_replay_suite tests.ingestion.official_web_handoff_consumer_promotion_gate_suite
uv run --all-packages python -m unittest tests.ingestion.test_official_web_projection tests.ingestion.test_official_web_handoff_consumer tests.ingestion.test_official_web_projection_import_worker tests.ingestion.test_official_web_source_handoff_adapter tests.ingestion.test_official_web_handoff_receiver tests.ingestion.test_official_web_live_seam_no_promotion_script
uv run --all-packages ruff check packages/ingestion-core/src/campus_ingestion_core/official_web_projection_engine.py packages/ingestion-core/src/campus_ingestion_core/official_web_projection_shared.py packages/ingestion-core/src/campus_ingestion_core/official_web_projection_validation.py apps/ingestion-worker/src/campus_ingestion_worker/official_web_handoff_consumer_reporting.py apps/ingestion-worker/src/campus_ingestion_worker/official_web_projection_import.py tests/ingestion/official_web_projection_test_support.py tests/ingestion/official_web_projection_core_replay_suite.py tests/ingestion/official_web_handoff_consumer_promotion_gate_suite.py
uv run --all-packages ruff format packages/ingestion-core/src/campus_ingestion_core/official_web_projection_engine.py packages/ingestion-core/src/campus_ingestion_core/official_web_projection_shared.py packages/ingestion-core/src/campus_ingestion_core/official_web_projection_validation.py apps/ingestion-worker/src/campus_ingestion_worker/official_web_handoff_consumer_reporting.py apps/ingestion-worker/src/campus_ingestion_worker/official_web_projection_import.py tests/ingestion/official_web_projection_test_support.py tests/ingestion/official_web_projection_core_replay_suite.py tests/ingestion/official_web_handoff_consumer_promotion_gate_suite.py --check
```

## Follow-Up

- Phase 7 can now consume app-api target-job projection and ingestion report fields in protected panel.
- Phase 8 no-promotion live seam should assert the new target-family and target-lineage fields in execution reports.
