---
doc_type: plan
status: completed
created: 2026-04-29
updated: 2026-04-29
---

<!-- markdownlint-disable MD013 -->

# Phase 6R.5 Plan: Target Classification Hardening

## Goal

Repair the remaining collected-notice target classification gaps after Phase
6R.4. Phase 6R.4 stopped weak keyword hints from driving regulation admission,
but review found target-level precision gaps for `transport_schedule`,
`service_status`, and file-release regulation taxonomy coverage.

## Implementation

- Replace broad family-to-target projection with target-specific resolution.
- Keep true shuttle/commute notices as `transport_schedule`.
- Stop classroom, parking, non-motor-vehicle, bathroom, and facility notices
  from becoming `transport_schedule`.
- Stop procurement / construction / bid / award-result notices from becoming
  `service_status`.
- Expand stable file-release regulation patterns so owner documents classify as
  `policy_regulation` instead of relying on downstream fallback.
- Keep weak keyword hits as audit-only metadata.

## Evidence

- Refresh Phase 4 searchable/reimport preview.
- Refresh Phase 5 multimodal readiness.
- Refresh Phase 6R.1 regulation admission.
- Refresh Phase 6R.3 regulation materialization quality gate.
- Write Phase 6R.5 target-classification hardening audit.

## Validation

```bash
uv run --all-packages python -m unittest tests.ingestion.test_collected_notice_classification tests.ingestion.authenticated_notice_notice_family_classification_suite tests.ingestion.test_collected_notice_reimport_preview
uv run --all-packages python -m unittest tests.ingestion.test_collected_notice_multimodal_readiness tests.ingestion.test_collected_notice_regulation_admission tests.ingestion.internal_notice_consumption_projection_routing_suite
uv run --all-packages python -m campus_ingestion_worker.preview_collected_notice_reimport
uv run --all-packages python -m campus_ingestion_worker.preview_collected_notice_multimodal_readiness
uv run --all-packages python -m campus_ingestion_worker.preview_collected_notice_regulation_admission --owner-text-execution-report-path .planning/workstreams/collected-notice-consumption-replay-closeout/evidence/phase-06-r1b-regulation-owner-text-recovery-execution/regulation-owner-text-execution-report.json
uv run --all-packages python -m campus_ingestion_worker.preview_collected_notice_regulation_materialization
find .planning/workstreams/collected-notice-consumption-replay-closeout/evidence/phase-06-r5-target-classification-hardening -name '*.json' -print0 | xargs -0 -n1 jq empty
```
