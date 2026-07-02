---
doc_type: contract
truth_scope: ops
owner_boundary: apps/app-api
status: active
created: 2026-04-03
updated: 2026-06-30
---

# App API Ops Index Contract

## Boundary

This document freezes the browser-facing `apps/app-api` contract for the
Operator Console Ops Index.

The active query path is:

```text
operator browser -> operator-console-web -> app-api Ops Index
```

The contract does not define a Sentry, Axiom, Langfuse, Temporal, Prometheus or
raw log explorer. External observability platforms remain the detailed sink
truth. `app-api` exposes only product-owned request state, runtime health
summary and safe correlation fields.

## Shared Rules

- JSON body uses `camelCase`.
- Timestamps use ISO 8601 UTC strings.
- All errors use `docs/contracts/app-api/error.md`.
- `requestId` is the product request correlation id.
- `traceId` is the runtime trace correlation id.
- `runId` links to durable execution when available.
- Request, overview and health endpoints read app-api-owned request/runtime
  projections only.
- Sink links or dashboard entries are safe correlation helpers. They must not
  include raw sink event bodies or route-time sink query results.

Forbidden response material:

- raw prompt
- raw answer
- raw transcript
- raw auth material, JWT, cookie, secret or token
- raw retrieval payload or support snippet dump
- raw provider response
- raw log body
- raw trace body
- raw sink event body
- raw Sentry issue/event detail
- raw Axiom dashboard result
- raw Langfuse trace/observation/score body
- raw Temporal history
- local artifact path
- object bucket/key unless a separate contract explicitly allows it

## Active Endpoint Summary

Active Operator Console endpoints:

- `GET /api/operator/overview`
- `GET /api/operator/runtime/health`
- `GET /api/requests`

Candidate endpoint, not currently part of the shipped Worker allowlist unless a
request detail workflow is deliberately restored:

- `GET /api/operator/requests/:requestId/ops-index`

Retired / non-current endpoint families:

- `GET /api/operator/quality/*`
- `GET /api/operator/safety/*`
- `GET /api/operator/cost/*`
- `GET /api/operator/intent/*`
- `GET /api/operator/audit*`
- `POST /api/internal/operator/quality/grades`
- `POST /api/internal/operator/trace-backlinks`
- browser-facing Temporal / autoscaler history query endpoints

If any of these routes still exist in current code, they are implementation
residue and must not be used as target architecture evidence.

## `GET /api/operator/overview`

Returns the minimal operator overview for launch triage.

Response shape remains implementation-owned, but it may only contain:

- request volume summary
- request terminal status counts
- runtime health status
- explicit blocker summaries from app-api / execution-control projections
- sink write/correlation health when available
- `asOf`

Rules:

- This endpoint is not a custom dashboard API.
- It must not copy Sentry/Axiom/Langfuse dashboard data.
- It may expose that a sink is configured, degraded or recently written to.
- Backend query errors return standard errors; the panel must not disguise them
  as empty state.

## `GET /api/operator/runtime/health`

Returns operator-safe execution runtime health projection.

Allowed response blocks:

- `asOf`
- `status`
- `executionRuntime`
- `runProjectionStore`
- `temporalRuntime`

Rules:

- This endpoint is not Temporal UI, raw Temporal history, Prometheus or a
  metrics explorer.
- `status=degraded` means app-api received a structured degraded runtime
  projection.
- Missing execution-control config, auth failure, network error, non-JSON
  response or malformed readyz payload fail closed through the standard error
  envelope.
- Task queue / worker information must stay at reason-code and count summary
  level.

## `GET /api/requests`

Returns the Operator Console request list.

Allowed fields:

- request identity: `requestId`, `traceId`, `conversationId`, `runId`
- surface and principal summary
- status and `errorCode`
- bounded question / answer preview
- started / completed / duration timestamps
- selected/requested tool ids if already part of request projection
- safe diagnostics summary

Rules:

- This is the canonical Operator Console request list.
- It is not reconstructed from chat messages, raw logs or telemetry sinks.
- It must not expose raw prompt, raw answer, raw transcript, raw retrieval
  payload or raw sink data.

## Candidate `GET /api/operator/requests/:requestId/ops-index`

This endpoint is reserved for a future visible request detail workflow.

If implemented, it may return only:

- request identity and terminal state
- minimal runtime health/correlation summary for that request
- external sink link entries generated from safe templates or allowlisted
  dashboard metadata
- compact reason-code diagnostics

It must not return:

- step-by-step raw execution dump
- raw Temporal history
- raw Sentry/Axiom/Langfuse payload
- quality grade body or eval output
- replay controls

## Internal Producer Guidance

Internal producers should emit sanitized OTel/log/trace events to the protected
Collector and external sinks. They should not publish broad operator
observability projections into app-api unless a current app-api contract admits
the field family.

Allowed app-api internal writes remain limited to product request state,
projection outbox entries required for request list materialization and runtime
health summaries required by `GET /api/operator/runtime/health`.

Quality scores, eval outputs, trace bodies, issue bodies and dashboard results
belong to Langfuse, Sentry or Axiom. If a future curated summary is required for
operators without sink access, it must be introduced as a new allowlisted
contract rather than by reactivating retired broad endpoints.

## Related Documents

- `docs/architecture/system/ops-observability.md`
- `docs/architecture/system/operator-console.md`
- `docs/architecture/system/langfuse.md`
- `docs/reference/runtime-otel-telemetry-taxonomy.md`
