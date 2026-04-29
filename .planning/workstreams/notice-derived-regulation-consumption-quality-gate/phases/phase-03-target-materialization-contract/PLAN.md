---
doc_type: plan
status: pending
created: 2026-04-28
updated: 2026-04-28
---
# Phase 3 Plan: Target Materialization Contract

<!-- markdownlint-disable MD013 -->

## Goal

Ensure regulation target materializers consume only promotion-gated projection truth and never recreate target candidates from raw notice inventory.

## Tasks

1. Verify institutional and scoped materializers read selected projection entries only.
2. Add rejected-case tests proving held notices do not produce registry rows.
3. Add stale-row regression tests for selected notice rebuild.
4. Validate target metadata preserves source notice and owner-document provenance.

## Acceptance Criteria

- `regulations/institutional_rules` contains only full institutional regulation text.
- `regulations/scoped_rules` contains only annual/time-bound scoped rule text.
- Held notices remain discoverable only through notice-level query/card surfaces.
