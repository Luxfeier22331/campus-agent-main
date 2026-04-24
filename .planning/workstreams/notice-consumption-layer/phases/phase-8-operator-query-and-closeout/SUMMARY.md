---
doc_type: phase_summary
phase: "8"
phase_name: "Operator Query And Closeout"
status: completed
created: 2026-04-24
updated: 2026-04-24
---

# Phase 8 Summary

## Outcome

The notice consumption layer implementation line is closed for internal_notice:

- operator/read-model status can answer whether a source notice has target-ready
  units
- held/manual/no-adoption/archive reasons are surfaced from projection metadata
- worker CLI provides a narrow status inspection entrypoint
- partial rebuild no longer accumulates stale projection units for selected
  notices
- authenticated notice import can explicitly rebuild the internal_notice query
  read model when projection/read-model stores are available
- notice-agent now has the package-level read-model backing query service and
  canonical body adapter for internal_notice, without opening product serving
- projection target/status terminology now separates notice archive, consumption
  projection, notice-level query/read-model candidates, and future query
  runtime execution:
  `notice_level_query`, `procurement_notice_history`,
  `campus_services/service_status_candidate`, `unsupported`, and
  `retained_for_notice_query` replace new `notice_runtime`-style writes

## Remaining Boundary

This closeout does not open internal_notice query-serving, campus services
runtime, document-center rollout, panel APIs, or live authenticated notice
control-plane. Those remain separate workstreams or future admission decisions.
