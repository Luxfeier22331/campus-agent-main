---
doc_type: plan
status: active
created: 2026-04-28
updated: 2026-04-28
---
# Phase 1 Plan: Promotion Eligibility Contract

<!-- markdownlint-disable MD013 -->

## Goal

Freeze the machine-checkable contract for when a regulation-like notice may cross from
`campus_notices/internal_notice` into `regulations/institutional_rules` or
`regulations/scoped_rules`.

## Tasks

1. Define positive eligibility:
   - embedded complete regulation/scoped-rule body;
   - attachment-backed complete body;
   - file-release-backed complete body;
   - official-web-backed complete canonical body.
2. Define negative eligibility:
   - amendment summary only;
   - publication wrapper only;
   - referenced owner not captured;
   - missing full-text owner;
   - title-only regulation signal.
3. Extend promotion report reasons so held/rejected cases are explainable.
4. Add regression fixtures:
   - `187233` style amendment summary;
   - embedded full `第一条/第二条/第三条` body;
   - attachment-backed full regulation;
   - scoped annual/time-bound rule;
   - referenced but missing owner document.
5. Ensure consumer projection rebuild replaces selected notices and does not leave stale
   `ready_for_target_materialization` rows after a route is rejected.

## Acceptance Criteria

- Negative fixtures never produce target-ready regulation projection entries.
- Positive fixtures still materialize into the correct target collection.
- The reason code for amendment summary is stable:
  `parent_notice_body_not_full_regulation_text`.
- Selected rebuild for `187233` remains at `ready_for_target_count=0`.

## Verification Commands

```bash
uv run --all-packages python -m unittest \
  tests.ingestion.internal_notice_regulation_promotion_manifest_suite \
  tests.ingestion.internal_notice_regulation_promotion_manifest_followup_suite \
  tests.ingestion.internal_notice_regulation_promotion_title_preview_suite \
  tests.ingestion.internal_notice_regulation_promotion_export_suite \
  tests.ingestion.test_dry_run_internal_notice_regulation_document_site_worker

uv run --all-packages ruff check \
  packages/ingestion-core/src/campus_ingestion_core/internal_notice_regulation_promotion_heuristics.py \
  tests/ingestion/internal_notice_regulation_promotion_manifest_followup_suite.py \
  tests/ingestion/internal_notice_regulation_promotion_title_preview_suite.py \
  tests/ingestion/internal_notice_regulation_promotion_export_suite.py
```
