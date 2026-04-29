---
doc_type: summary
status: completed
created: 2026-04-28
updated: 2026-04-28
---
# Phase 2 Summary: Selected Cohort Audit

<!-- markdownlint-disable MD013 -->

## Outcome

Phase 2 added a repo-owned selected cohort audit for regulation-like internal notices.

The audit is projection-backed and read-only:

- reads `notice_consumption_projection`;
- joins source-truth inventory for title, source URL, attachment counts, and owner expectation
  metadata;
- optionally joins the promotion manifest for stable rejection reasons;
- emits selected import ids and held/recovery ids;
- records selected ids that have no current projection row instead of silently dropping them.

## Implementation

- Core audit module:
  `packages/ingestion-core/src/campus_ingestion_core/internal_notice_selected_regulation_audit.py`
- Worker CLI:
  `apps/ingestion-worker/src/campus_ingestion_worker/audit_internal_notice_regulation_selected_cohort.py`
- Script entry:
  `campus-ingestion-audit-internal-notice-regulation-selected-cohort`
- Tests:
  - `tests/ingestion/test_internal_notice_regulation_selected_cohort_audit.py`
  - `tests/ingestion/test_audit_internal_notice_regulation_selected_cohort_worker.py`

## Real Audit Evidence

Evidence artifact:

```text
.planning/workstreams/notice-derived-regulation-consumption-quality-gate/phases/phase-02-selected-cohort-audit/evidence/selected-cohort-audit-20260428.json
```

Selected request size: `16`.

Current projection audit result:

- `row_count=1`
- `classification_counts={"amendment_summary_only": 1}`
- `selected_import_notice_ids=[]`
- `held_notice_ids=["187233"]`
- `missing_projection_notice_ids` contains the other `15` selected ids
- `187233` stable reason:
  `parent_notice_body_not_full_regulation_text`

This means no current selected row is eligible for Phase 3 target import.

## Verification

```bash
uv run --all-packages python -m unittest \
  tests.ingestion.test_internal_notice_regulation_selected_cohort_audit \
  tests.ingestion.test_audit_internal_notice_regulation_selected_cohort_worker -v
```

Result: `2 tests OK`.

```bash
uv run --all-packages ruff check \
  packages/ingestion-core/src/campus_ingestion_core/internal_notice_selected_regulation_audit.py \
  apps/ingestion-worker/src/campus_ingestion_worker/audit_internal_notice_regulation_selected_cohort.py \
  tests/ingestion/test_internal_notice_regulation_selected_cohort_audit.py \
  tests/ingestion/test_audit_internal_notice_regulation_selected_cohort_worker.py
```

Result: `All checks passed`.

```bash
uv run --all-packages ruff format --check \
  packages/ingestion-core/src/campus_ingestion_core/internal_notice_selected_regulation_audit.py \
  apps/ingestion-worker/src/campus_ingestion_worker/audit_internal_notice_regulation_selected_cohort.py \
  tests/ingestion/test_internal_notice_regulation_selected_cohort_audit.py \
  tests/ingestion/test_audit_internal_notice_regulation_selected_cohort_worker.py
```

Result: `4 files already formatted`.

## Next Phase

Proceed to Phase 3: target materialization contract.
