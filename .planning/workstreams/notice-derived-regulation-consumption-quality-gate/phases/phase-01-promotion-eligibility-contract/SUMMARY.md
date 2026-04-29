---
doc_type: summary
status: completed
created: 2026-04-28
updated: 2026-04-28
---
# Phase 1 Summary: Promotion Eligibility Contract

<!-- markdownlint-disable MD013 -->

## Outcome

Phase 1 froze the machine-checkable promotion contract for regulation-like internal notices:

- complete embedded parent-body regulation text may promote;
- attachment-backed full regulation text may promote;
- annual-cycle and time-bound rule text routes to `regulations/scoped_rules`;
- wrapper-only, amendment-summary-only, title-only, and missing-owner cases fail closed;
- `parent_notice_body_not_full_regulation_text` is the stable reason for parent notice bodies
  that strip down to amendment summaries instead of full regulation text.

## Implementation

- Added an amendment-summary guard that still rejects summaries when they mention numbered
  clauses such as `第一条` / `第二条`, unless the body contains a complete regulation opening
  clause such as `第一条 ... 制定本办法`.
- Added regression coverage for amendment summaries with article-number references.
- Added selected projection rebuild coverage proving stale `ready_for_target_materialization`
  rows are removed when the selected notice is reclassified as a retained notice-level query row.

## Verification

```bash
uv run --all-packages python -m unittest \
  tests.ingestion.internal_notice_regulation_promotion_manifest_suite \
  tests.ingestion.internal_notice_regulation_promotion_manifest_followup_suite \
  tests.ingestion.internal_notice_regulation_promotion_title_preview_suite \
  tests.ingestion.internal_notice_regulation_promotion_export_suite \
  tests.ingestion.test_dry_run_internal_notice_regulation_document_site_worker -v
```

Result: `21 tests OK`.

```bash
uv run --all-packages python -m unittest \
  tests.ingestion.test_internal_notice_regulation_promotion \
  tests.ingestion.test_internal_notice_consumption_projection -v
```

Result: `52 tests OK`.

```bash
uv run --all-packages ruff check \
  packages/ingestion-core/src/campus_ingestion_core/internal_notice_regulation_promotion_heuristics.py \
  tests/ingestion/internal_notice_regulation_promotion_manifest_followup_suite.py \
  tests/ingestion/internal_notice_regulation_promotion_title_preview_suite.py \
  tests/ingestion/internal_notice_regulation_promotion_export_suite.py \
  tests/ingestion/internal_notice_consumption_projection_core_suite.py
```

Result: `All checks passed`.

```bash
uv run --all-packages ruff format --check \
  packages/ingestion-core/src/campus_ingestion_core/internal_notice_regulation_promotion_heuristics.py \
  tests/ingestion/internal_notice_regulation_promotion_manifest_followup_suite.py \
  tests/ingestion/internal_notice_consumption_projection_core_suite.py
```

Result: `3 files already formatted`.

## Next Phase

Proceed to Phase 2: selected cohort audit.
