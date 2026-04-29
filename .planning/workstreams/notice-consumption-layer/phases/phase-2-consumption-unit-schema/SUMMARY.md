---
doc_type: phase_summary
phase: "2"
phase_name: "Consumption Unit Schema"
status: completed
created: 2026-04-28
updated: 2026-04-28
---

# Phase 2 Summary: Consumption Unit Schema

## Outcome

Phase 2 is complete. The workstream established `source_notice -> derived
consumption unit` as the core modeling unit for notice consumption.

## Decisions

- A single source notice may produce multiple derived units.
- Derived units carry primary role, semantic owner, temporal policy,
  completeness, answerability, target surface, and consumption status.
- Source truth remains upstream; derived units do not rewrite source identity.

## Follow-up

Phase 3 freezes authority, completeness, and answerability semantics.
