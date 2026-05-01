---
doc_type: phase_plan
status: completed
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 1 Plan: Supervisor API Trace Owner Hardening

## Goal

Make `apps/supervisor-api` the explicit online trace owner and harden trace propagation,
attribute allowlisting, exporter failure behavior and self-health evidence.

## Tasks

1. Audit current Go OTel emitter and identify missing span/event names.
2. Add or tighten spans/events for request admission, answer streaming, worker bridge, tool call
   dispatch, finalization and error path.
3. Ensure trace context and request id are propagated to downstream worker calls.
4. Add tests for config validation, secret redaction, exporter failure and trace propagation.
5. Update `supervisor-api` README/runbook if env or readiness behavior changes.

## Acceptance

- `go test` focused supervisor-api telemetry/config/httpapi suites pass.
- Exporter failure does not break answer path.
- Readiness/metrics expose telemetry enabled/configured/exported/failed/dropped state.
