---
doc_type: plan
status: pending
created: 2026-04-28
updated: 2026-04-28
---
# Phase 2 Plan: Selected Cohort Audit

<!-- markdownlint-disable MD013 -->

## Goal

Build a real selected cohort of regulation-like notices and classify each into a bounded
consumption outcome before any target import.

## Tasks

1. Query current `notice_consumption_projection` for regulation-like retained/query/candidate rows.
2. Build an audit report with notice id, title, source url, attachment/link counts, owner expectation, target recommendation, and rejection reason.
3. Classify rows into:
   - `full_text_candidate`;
   - `scoped_rule_candidate`;
   - `attachment_owner_candidate`;
   - `file_release_owner_candidate`;
   - `official_web_owner_candidate`;
   - `amendment_summary_only`;
   - `wrapper_notice_only`;
   - `missing_owner`;
   - `notice_card_only`.
4. Produce a selected import list for Phase 3 and a rejected/held list for notice card consumption.

## Acceptance Criteria

- No row enters Phase 3 without an explicit classification.
- Every rejected row has a stable reason code.
- Delayed review states are not used; ambiguous rows must route to a machine-owned recovery lane or fail closed.
