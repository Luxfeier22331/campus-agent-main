---
doc_type: phase_summary
phase: "0"
phase_name: "Admission And 187233 Cleanup"
status: completed
created: 2026-04-28
updated: 2026-04-28
---

# Phase 0 Summary: Admission And 187233 Cleanup

<!-- markdownlint-disable MD013 -->

## Outcome

Phase 0 is complete. The regulation-like notice quality-gate workstream has
been admitted, and the known bad `187233` promotion has been cleaned up without
removing its authenticated notice source truth.

## Decisions

- This is a new active closeout workstream:
  `notice-derived-regulation-consumption-quality-gate`.
- It does not reopen the completed
  `authenticated-notice-regulation-consumption` workstream.
- Notice `187233` is the canonical negative case for this line:
  amendment-summary-only parent notices must not become
  `regulations/institutional_rules`.
- Source-truth notice records remain in `campus_notices/internal_notice`.
- Target cleanup is limited to erroneous regulation/docs/read-model/bucket
  materialization.

## Evidence

- `187233` source truth has no complete regulation body, attachment, or
  linked full-text owner.
- Selected projection rebuild now leaves `187233` only as
  `notice_level_query|retained_for_notice_query`.
- Erroneous `regulations/institutional_rules` registry, document, reader,
  search, and bucket references for the promoted `采购工作管理办法` body were
  removed.
- Rejected dry-run artifact:
  `.tmp/historical-intake/run14-policy-regulation-expanded/document-site-dry-run-187233-rejected-20260428/dry-run-report.json`
- Selected projection rebuild batch:
  `internal_notice_consumption:projection_rebuild:862a90e84c054cd9`

## Verification

- Regulation promotion/materialization/docs subset: `30 tests OK`
- `uv run --all-packages ruff check ...`: passed
- `uv run --all-packages ruff format --check ...`: passed
- `pnpm docs:lint`: passed
- `git diff --check`: passed

## Follow-up

Phase 1 freezes the promotion eligibility contract so that full regulation
body, scoped-rule body, wrapper notice, amendment summary, reference-only owner,
and notice-level query card cases are classified before downstream
materialization.
