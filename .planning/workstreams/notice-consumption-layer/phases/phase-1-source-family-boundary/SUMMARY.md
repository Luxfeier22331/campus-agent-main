---
doc_type: phase_summary
phase: "1"
phase_name: "Source Family Boundary"
status: completed
created: 2026-04-28
updated: 2026-04-28
---

# Phase 1 Summary: Source Family Boundary

## Outcome

Phase 1 is complete. The notice consumption line froze the boundary between
source-channel holding truth and downstream consumption truth.

## Decisions

- `campus_notices/internal_notice` remains source-channel-first holding truth.
- Source-family labels do not by themselves open target materialization.
- Internal restricted notices can be retained for notice-level query without
  becoming regulations, campus-services facts, or public notice truth.

## Follow-up

Phase 2 defines the derived consumption unit schema used by projection and
read-model rebuilds.
