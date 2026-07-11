---
doc_type: contract
truth_scope: ops
owner_boundary: apps/app-api
status: active
created: 2026-04-03
updated: 2026-07-04
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
- `GET /api/operator/observability-config/llm-debug-trace`
- `PATCH /api/operator/observability-config/llm-debug-trace`
- `GET /api/requests`
- `GET /api/operator/requests/:requestId`

Active machine-only internal endpoint:

- `GET /api/internal/observability-config/llm-debug-trace`

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
- stage latency summary derived from `stage_timing.v1` canonical fields
- latency budget summary derived from `configs/runtime/latency-budgets.v1.json`
- sink write/correlation health when available
- `asOf`

Rules:

- This endpoint is not a custom dashboard API.
- It must not copy Sentry/Axiom/Langfuse dashboard data.
- It may expose that a sink is configured, degraded or recently written to.
- It may expose `stageLatency` as p50/p95/p99/sample/warn/critical counts per
  canonical stage field.
- It may expose `latencyBudget` as version, warn count, critical count and worst
  field only.
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
- Safe diagnostics summary means compact ids, titles, reason codes, verdicts,
  counts and latency/status summaries. It must not include query rewrite text,
  retrieval query text, source snippets or raw tool/provider diagnostics.

## `GET /api/operator/requests/:requestId`

Returns one Operator Console request detail and its optional safe Ops Index.

Top-level response shape:

```json
{
  "request": {
    "requestId": "req_...",
    "traceId": "trace_...",
    "status": "completed"
  },
  "opsIndex": {
    "stageTiming": {
      "agent.primary_ms": 620,
      "stream.browser_ttft_ms": 410
    },
    "stageTimingBudget": {
      "agent.primary_ms": {
        "budgetState": "within_budget",
        "budgetVersion": "latency-budget-v1",
        "durationMs": 620,
        "warnMs": 7000,
        "criticalMs": 14000
      }
    },
    "debugTraceRefs": [
      {
        "sink": "langfuse_otlp",
        "traceId": "trace_...",
        "traceRef": "langfuse://...",
        "url": "https://..."
      }
    ],
    "model": {},
    "tool": {},
    "retrieval": {},
    "sinkLinks": {}
  }
}
```

`request` uses the same safe projection field family as `GET /api/requests`.
`opsIndex` may be `null` when runtime observability fact has not been projected.

`opsIndex` may contain only:

- request identity and terminal state
- minimal runtime health/correlation summary for that request
- external sink link entries generated from safe templates or allowlisted
  dashboard metadata
- compact reason-code diagnostics
- compact `knowledge_search` scope/version and evidence summary without query
  text or raw filter payload
- `stageTiming`: `stage_timing.v1` allowlisted numeric duration map; see
  `docs/contracts/stage-timing.md`
- `stageTimingBudget`: per canonical timing field budget projection derived
  from `configs/runtime/latency-budgets.v1.json`; contains only budget state,
  budget version and thresholds for fields that have a configured latency budget
- `debugTraceRefs`: sink name, trace id/ref and optional safe deep link
- `model`: provider/name, execution state/detail, token/cost summary, prompt id/version/hash
- `tool`: requested/selected tool, business outcome and fail-close reason code
- `retrieval`: retrieval attempted flag, candidate/source counts, collection and adequacy reason code
- `sinkLinks`: trace availability and projection lag

`stageTiming` is the app-api merged safe timing projection. It includes
execution-control returned runtime stages plus app-api-owned
`request.total_ms`, optional `stream.browser_ttft_ms` and optional
`projection.closeout_ms`.
`stageTimingBudget` is derived by app-api from the same canonical fields and
budget artifact. Non-canonical timing keys are not returned through Ops Index
and must not be interpreted by Operator Console.

It must not return:

- step-by-step raw execution dump
- raw Temporal history
- raw Sentry/Axiom/Langfuse payload
- quality grade body or eval output
- replay controls

## LLM Debug Trace Config

Operator routes expose only config summaries:

- `mode`: `off` or `langfuse_otlp`
- `sampleRatio`
- `includeModelIo`, default `false`
- Langfuse OTLP endpoint and public trace base URL
- auth header configured/fingerprint/last4 summary
- revision and operator update metadata

They must not return the raw `Authorization` header.

The internal route is machine-only and returns the execution-runtime snapshot:

```json
{
  "config": {
    "schema_version": "llm_debug_trace_config.v1",
    "mode": "langfuse_otlp",
    "include_model_io": false,
    "sample_ratio": 1,
    "langfuse_otlp": {
      "endpoint": "https://cloud.langfuse.com/api/public/otel",
      "auth_header": "Basic ...",
      "public_trace_base_url": "https://cloud.langfuse.com/project/demo/traces"
    }
  }
}
```

Rules:

- app-api owns this online config surface.
- execution-control consumes an app-api-produced projection path from its
  runtime config.
- agent-runtime receives only request-scoped `debug_trace_config`.
- Do not add agent-runtime environment variables for this config.
- `include_model_io=true` requires request-scoped admission by
  `raw_capture_policy.v1`; it is never enabled by global default or process env.
- `langfuse_otlp.auth_header` must use Basic auth.
- `langfuse_otlp.endpoint` must end with `/api/public/otel`.
- app-api/operator projections may store and display only safe deep links,
  trace refs and `stage_timing.v1` fields.
- app-api/operator projections must not store raw replay packet bodies. Replay
  packet index, metadata and access audit are governed by
  `docs/contracts/replay-capture.md`.

## Internal Producer Guidance

Internal producers should emit sanitized OTel/log/trace events to the protected
Collector and external sinks. They should not publish broad operator
observability projections into app-api unless a current app-api contract admits
the field family.

Allowed app-api internal writes remain limited to product request state,
projection outbox entries required for request list materialization and runtime
health summaries required by `GET /api/operator/runtime/health`.

Quality scores, eval outputs, trace bodies, issue bodies and dashboard results
belong to Langfuse, Sentry or Axiom. If a curated summary is required for
operators without sink access, it must be introduced as a new allowlisted
contract rather than by reactivating retired broad endpoints.

## Related Documents

- `docs/architecture/system/ops-observability.md`
- `docs/architecture/system/operator-console.md`
- `docs/architecture/system/langfuse.md`
- `docs/contracts/replay-capture.md`
- `docs/reference/runtime-otel-telemetry-taxonomy.md`
