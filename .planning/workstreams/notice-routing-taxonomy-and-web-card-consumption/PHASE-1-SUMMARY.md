---
doc_type: phase_summary
status: completed
created: 2026-04-28
updated: 2026-04-28
---

# Phase 1 Summary: Routing Matrix Review

## Result

Phase 1 completed the first-phase notice downstream denominator cleanup.

- Dedicated downstream notice consumption is limited to regulation and
  service-status candidate routes; transport schedule is represented through the
  service-status candidate family.
- Procurement, lecture, activity, publicity, campus-news, meeting/training,
  staff/internal-admin, governance-life and similar low-priority families now
  route to `notice_level_query` as generic title/url cards.
- Generic-card-only families use `machine_processing_policy=skip`; attachments
  remain metadata-only and do not create OCR/VLM backlog.
- `procurement_notice_history` remains a deferred target surface, but the active
  routing config no longer emits that route.
- Projection no longer creates procurement-history sidecar units from title
  heuristics, and lecture/activity notices no longer create no-adoption sidecar
  units when they are admitted as generic cards.

## Verification

- `uv run --all-packages python -m unittest tests.ingestion.authenticated_notice_notice_family_config_suite tests.ingestion.test_authenticated_notice_routing_sampling tests.ingestion.test_internal_notice_consumer_admission_builder tests.ingestion.authenticated_notice_notice_family_classification_suite tests.ingestion.internal_notice_consumption_projection_core_suite tests.ingestion.test_authenticated_notice_routing_taxonomy_eval -v`
- `uv run --all-packages python -m unittest tests.ingestion.test_evaluate_authenticated_notice_routing_taxonomy_worker -v`
- `uv run --all-packages python -m unittest tests.ingestion.test_internal_notice_read_model tests.ingestion.test_rebuild_internal_notice_read_model_worker tests.ingestion.test_internal_notice_pipeline_quality -v`

