---
doc_type: phase_summary
status: completed
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 1 Summary: Supervisor API Trace Owner Hardening

## Result

Phase 1 is complete. `apps/supervisor-api` now has a clearer online trace-owner posture:
it extracts inbound trace context, propagates sanitized trace/request headers to the worker bridge,
uses Phase 0 taxonomy names for request telemetry, emits bridge lifecycle telemetry, and preserves
fail-open behavior when telemetry export is unavailable.

## Implementation

- `apps/supervisor-api/internal/telemetry/propagation.go`
  - added W3C `traceparent` / `baggage` extraction
  - added current `app-api` `sentry-trace` compatibility conversion to `traceparent`
  - added bridge trace header injection for `traceparent`, `baggage`, `x-request-id`, `x-trace-id`
- `apps/supervisor-api/internal/telemetry/emitter.go`
  - fixed TraceContext/Baggage propagator setup
  - normalized legacy `answer.*` / `answer_stream.*` event names to
    `runtime.request.accepted` / `runtime.request.finalized`
  - added `telemetry.allowed_attributes_version` as an emitted allowlisted attribute
- `apps/supervisor-api/internal/bridge`
  - added `TraceHeaders` to bridge requests
  - propagated only allowlisted trace/request headers to `supervisor-agent-worker`
  - dropped non-allowlisted headers such as `authorization`
- `apps/supervisor-api/internal/httpapi`
  - extracted trace context at `ServeHTTP`
  - attached bridge trace headers for single-step and multi-step bridge execution
  - emitted `agent.bridge.started`, `agent.bridge.completed` and `agent.bridge.failed`
- Docs:
  - `apps/supervisor-api/README.md`
  - `docs/runbooks/supervisor-api-staging-operations.md`

## Tests Added / Updated

- `apps/supervisor-api/internal/telemetry/emitter_test.go`
  - parent trace preservation
  - taxonomy-normalized span name
  - allowlisted attributes
- `apps/supervisor-api/internal/telemetry/propagation_test.go`
  - `sentry-trace` compatibility conversion
  - invalid `sentry-trace` ignored
- `apps/supervisor-api/internal/bridge/http_client_test.go`
  - trace header allowlist and secret-header drop
- `apps/supervisor-api/internal/httpapi/answer_bridge_test.go`
  - request trace headers propagate through supervisor to bridge

## Verification

```bash
cd apps/supervisor-api && \
  go test ./internal/config ./internal/telemetry ./internal/bridge ./internal/httpapi
```

Result: passed.

```bash
cd apps/supervisor-api && go test ./internal/observability
```

Result: passed.

```bash
cd apps/supervisor-api && go test ./...
```

Result: passed.

## Remaining Work

Phase 2 should connect `retrieval.runtime_observation` in `apps/supervisor-agent-worker` or the
runtime adapter to OTel-compatible sanitized events/logs/spans. `retrieval-core` must remain free of
OTel imports.
