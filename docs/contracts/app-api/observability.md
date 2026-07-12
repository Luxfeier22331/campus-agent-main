---
doc_type: contract
truth_scope: ops
owner_boundary: apps/app-api
status: active
created: 2026-04-03
updated: 2026-07-11
---
# App API Ops Index Contract

## Boundary

This contract defines the browser-facing app-api data used by Operator Console
for request and runtime triage:

```text
operator browser -> operator-console-web -> app-api Ops Index
```

App-api is not a Sentry, Axiom, Langfuse, Temporal or Prometheus proxy. It
exposes product-owned request state, runtime health, stage timing and safe
correlation fields only.

## Shared Rules

- JSON uses `camelCase`; timestamps use ISO 8601 UTC strings.
- `requestId`, `traceId`, `conversationId` and optional `runId` are correlation
  values, not external sink locators.
- Query endpoints read app-api-owned projections only.
- Unknown fields, malformed upstream readiness and missing auth fail closed.
- Responses never include raw prompts, answers, transcripts, source/retrieval
  payloads, provider payloads, SDK spans, Temporal history, sink bodies, auth
  material, secrets, local paths or object-store coordinates.

## Active Endpoints

- `GET /api/operator/overview`
- `GET /api/operator/runtime/health`
- `GET /api/requests`
- `GET /api/operator/requests/:requestId`

Provider configuration routes are defined by
`docs/contracts/app-api/operator-ops.md`. App-api has no operator or internal
runtime-trace configuration endpoint.

Retired endpoint families must not be restored without a new product contract:

- broad quality, safety, cost, intent and audit dashboards;
- external sink projection ingestion or query;
- browser-facing Temporal/autoscaler history;
- external sink proxy or trace-body lookup.

## Overview

`GET /api/operator/overview` may return request volume/status summaries,
runtime status, explicit blockers, canonical stage-latency summaries, latency
budget summaries and `asOf`.

It must not copy external dashboard data or infer success from missing data.

## Runtime Health

`GET /api/operator/runtime/health` projects the authenticated
execution-control `/readyz` result into bounded operator-safe blocks such as:

- `status` and `asOf`;
- execution runtime;
- agent runtime;
- provider config gate;
- run projection store;
- Temporal runtime and required poller summaries.

Missing configuration, auth failure, network error, non-JSON response or an
invalid readiness projection fails closed.

## Request List

`GET /api/requests` may return:

- request, trace, conversation and run identity;
- surface and principal summary;
- status, error code and bounded question/answer preview;
- start/completion/duration values;
- requested/selected tool ids;
- compact reason-code and latency summaries.

The list is materialized from app-api projections, not reconstructed from chat
messages, logs or telemetry sinks.

## Request Detail

`GET /api/operator/requests/:requestId` returns the safe request projection and
an optional Ops Index. The Ops Index may contain:

- request identity and terminal state;
- `stageTiming` with canonical `stage_timing.v1` fields;
- `stageTimingBudget` derived from the versioned latency budget;
- model/provider identity and safe fingerprint versions/hashes;
- requested/selected tool and fail-close reason;
- bounded retrieval count/status summaries;
- trace availability and projection lag.

It does not return external trace URLs, SDK span bodies, step-by-step execution
dumps, raw tool/provider diagnostics or unbounded source details. Engineers use
`traceId` to search the authorized observability platform directly.

## Runtime Trace Boundary

App-api propagates W3C trace context. Execution-control and agent-runtime export
sanitized OTLP to the environment-owned Collector; the Collector owns sink
credentials and Langfuse fan-out. App-api does not configure this pipeline and
does not persist sink-specific trace references.

## Related Documents

- `docs/architecture/system/ops-observability.md`
- `docs/architecture/system/operator-console.md`
- `docs/architecture/system/langfuse.md`
- `docs/contracts/stage-timing.md`
- `docs/reference/runtime-otel-telemetry-taxonomy.md`
