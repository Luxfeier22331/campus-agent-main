---
doc_type: plan
status: completed
created: 2026-04-28
updated: 2026-04-28
---
# Phase 0 Plan: Admission And 187233 Cleanup

<!-- markdownlint-disable MD013 -->

## Goal

Admit a new workstream for regulation-like notice consumption quality gates and remove the known bad target materialization for notice `187233`.

## Completed Tasks

- Confirmed `187233` source truth contains no complete `中央民族大学采购工作管理办法` body, attachment, or link.
- Added negative promotion behavior: amendment-summary-only parent notice must not become `regulations/institutional_rules`.
- Rebuilt selected projection for `187233`; only `notice_level_query|retained_for_notice_query` remains.
- Deleted erroneous `regulations/institutional_rules` registry/docs/read-model/search rows for `187233`.
- Deleted erroneous promoted regulation blobs from `campus-rag-derived`.
- Preserved source-truth and internal notice source-channel objects.

## Evidence

- rejected dry-run:
  `.tmp/historical-intake/run14-policy-regulation-expanded/document-site-dry-run-187233-rejected-20260428/dry-run-report.json`
- selected projection rebuild batch:
  `internal_notice_consumption:projection_rebuild:862a90e84c054cd9`

## Verification

- `uv run --all-packages python -m unittest ...` regulation promotion/materialization/docs subset: `30 tests OK`
- `uv run --all-packages ruff check ...`: passed
- `uv run --all-packages ruff format --check ...`: passed
- `pnpm docs:lint`: passed
- `git diff --check`: passed
