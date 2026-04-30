---
doc_type: plan
status: completed
created: 2026-04-30
updated: 2026-04-30
---

<!-- markdownlint-disable MD013 -->

# Phase 8 Plan: Source Retention Preview Audit And Integration

## Goal

Move the authenticated notice source retention state machine from reference validation
into source-truth and collected notice reimport preview outputs.

## Tasks

- Add a source retention decision model with notice-first route mapping.
- Preserve metadata-only attachment relations without treating their bytes as required
  source objects.
- Add retention summary fields to `notice-manifest.json`.
- Add per-attachment capture / retention fields to `attachment-refs.jsonl`.
- Expose the same summary in collected notice reimport preview.
- Add regression tests for `notice_level_query_only`, `candidate_service_fact`,
  `candidate_document_owner` and `capture_only_no_adoption`.
- Keep Batch 3 audit evidence for legacy `process/no target` rows.

## Verification

```bash
uv run --all-packages python -m unittest tests.ingestion.test_authenticated_notice_source_retention_decision tests.ingestion.test_authenticated_notice_retention_preview_audit tests.ingestion.test_authenticated_notice_routing_sampling tests.ingestion.test_authenticated_notice_routing_taxonomy_eval tests.ingestion.test_evaluate_authenticated_notice_routing_taxonomy_worker tests.ingestion.test_collected_notice_reimport_preview tests.ingestion.test_preview_collected_notice_reimport_worker tests.ingestion.authenticated_notice_import_bundle_suite tests.ingestion.authenticated_notice_import_inventory_suite
uv run --all-packages ruff check packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_source_retention_decision.py packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_source_truth_artifacts.py packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_import.py packages/ingestion-core/src/campus_ingestion_core/collected_notice_reimport_preview.py tests/ingestion/test_authenticated_notice_source_retention_decision.py tests/ingestion/test_collected_notice_reimport_preview.py tests/ingestion/test_authenticated_notice_retention_preview_audit.py tests/ingestion/test_authenticated_notice_routing_sampling.py tests/ingestion/test_authenticated_notice_routing_taxonomy_eval.py
uv run --all-packages ruff format packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_source_retention_decision.py packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_source_truth_artifacts.py packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_import.py packages/ingestion-core/src/campus_ingestion_core/collected_notice_reimport_preview.py tests/ingestion/test_authenticated_notice_source_retention_decision.py tests/ingestion/test_collected_notice_reimport_preview.py tests/ingestion/test_authenticated_notice_retention_preview_audit.py tests/ingestion/test_authenticated_notice_routing_sampling.py tests/ingestion/test_authenticated_notice_routing_taxonomy_eval.py --check
```
