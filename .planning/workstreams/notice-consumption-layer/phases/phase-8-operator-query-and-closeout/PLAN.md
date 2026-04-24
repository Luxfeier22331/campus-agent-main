---
doc_type: phase_plan
phase: "8"
phase_name: "Operator Query And Closeout"
status: completed
created: 2026-04-24
updated: 2026-04-24
---

# Phase 8 Plan

## Objective

Close the operator/read-model observability gap for internal_notice consumption
projection truth.

## Scope

- read-model status for a single source notice
- explicit held / ready / manual / no-adoption unit counts
- reason projection for hold/manual/no-adoption/archive states
- ingestion-worker CLI for operator status inspection
- stale-unit cleanup during selected-notice projection rebuild

## Non-goals

- protected panel UI
- app-api operator API
- live collector/control-plane
- query-serving opening

## Completion Notes

- `read_notice_consumption_projection_status` exposes per-notice counts and unit
  reasons.
- `show_internal_notice_consumption_projection_status` prints the status read model
  from the worker shell.
- selected-notice rebuild now replaces existing units for those notices, avoiding
  stale projection rows.
- `rebuild_internal_notice_read_model` and the worker CLI materialize queryable
  read-model rows from consumption projection + document registry + canonical
  markdown.
- `NoticeReadModelQueryService` maps the read model and canonical body into the
  notice discover/get contract while keeping restricted access fail-closed.
