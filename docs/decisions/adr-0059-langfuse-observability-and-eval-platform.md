---
doc_type: decision
truth_scope: repository
owner_boundary: docs/decisions
decision_id: ADR-0059
status: accepted
created: 2026-06-18
updated: 2026-06-18
---
# ADR-0059: Langfuse Observability And Eval Platform

## Context

The online answer path already uses Temporal for durable execution and
repo-owned run / event / step projection for product diagnostics. Existing
telemetry sinks are useful for runtime debugging, but they do not provide a
single LLM-oriented surface for traces, datasets, experiments, scores and
annotation workflows.

Langfuse provides that LLM observability / eval platform. The integration must
not move execution truth, product truth or contract truth out of this repo.

## Decision

Adopt Langfuse as a self-host-first LLM observability and eval platform.

- Temporal remains the durable execution substrate.
- `apps/app-api` and repo-owned projection stores remain product and operator
  diagnostic truth.
- Langfuse is a telemetry / eval sink and feedback workflow platform.
- Langfuse receives sanitized OTel traces through the repo OTel Collector.
- `packages/eval-langfuse` may publish datasets, experiments and scores to
  Langfuse, but deterministic release verdicts remain repo-owned. ADR-0061 later
  retired the old `packages/evals` package from active eval ownership.
- Operator Console must not query Langfuse directly. After ADR-0064, it may show
  only minimal app-api Ops Index correlation or safe link-template output; it
  must not store Langfuse observations or scores in app-api.
- Langfuse types and provider SDKs must not leak into `packages/contracts`.

Self-host is the default deployment target. Cloud Langfuse remains compatible
through the same base URL and OTLP endpoint configuration.

## Consequences

The runtime integration is enabled through explicit configuration:

- Collector config declares `otlphttp/langfuse`, with secret-bearing values
  supplied by deployment secret management.
- execution-control runtime config owns whether Temporal tracing is enabled.
- app-api propagates W3C `traceparent` in addition to current Sentry trace
  headers.
- execution-control attaches the Temporal Go SDK OpenTelemetry interceptor to
  configured Temporal clients and workers.
- eval score report generation and publishing are owned by `packages/eval-langfuse`
  and fail closed unless base URL, public key and secret key are all present.
- local/staging runtime compose fails closed when the Langfuse Collector
  endpoint, Basic auth header or ingestion version is missing.

Runtime completion still requires release evidence from a real deployed
chat-request trace reaching Langfuse through the Collector.
