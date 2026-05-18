---
doc_type: index
status: completed
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Workstream: Runtime OTel Observability Bridge

这是 `runtime-otel-observability-bridge` 的 native workstream 入口。
它承接已完成的 canonical retrieval observation seam、现有 `supervisor-api`
OTel 基础设施，以及 ADR-0010 的 OpenTelemetry-first 方向，把 production
telemetry 接入收口到 runtime / adapter / Collector 层。

## Current Status

- status: `completed`
- current phase: completed
- active implementation: runtime OTel observability bridge closed out
- current posture: `apps/supervisor-api` 已有 Go OTel exporter / env gate；
  `packages/retrieval-core` 已有 vendor-neutral `RetrievalObservationSink`；worker 已把
  `retrieval.runtime_observation` 接成 sanitized runtime event bridge；ingestion-worker 已把
  chunk preparation、registry-scope release 和 legacy release-index shell 接成 sanitized
  started/completed/failed run-level telemetry；repo 已有 local/staging Collector config、
  forbidden-field deletion、debug exporter 与 Sentry/Axiom fan-out template；online runtime
  OTLP smoke、retrieval observation smoke、ingestion run telemetry smoke 与 sink-down fail-safe
  smoke 已收口。Phase 0 已冻结 runtime ownership、taxonomy、attribute allowlist 与
  forbidden fields；Phase 1 已收口 `supervisor-api` online trace owner、trace propagation、
  bridge telemetry events 与 exporter fail-safe tests；Phase 2 已完成 retrieval runtime
  observation bridge；Phase 3 已完成 ingestion-worker started/completed/failed run telemetry；
  Phase 4 已完成 Collector / sink pipeline 配置与 runbook；Phase 5 已完成 E2E smoke 与
  closeout。

## Native Planning Truth

- requirements: `./REQUIREMENTS.md`
- roadmap: `./ROADMAP.md`
- state: `./STATE.md`
- acceptance: `./ACCEPTANCE.md`

## Phase Plans

- Phase 0: `./phases/phase-00-scope-and-schema-freeze/PLAN.md`
- Phase 1: `./phases/phase-01-supervisor-api-trace-owner-hardening/PLAN.md`
- Phase 2: `./phases/phase-02-retrieval-runtime-observation-bridge/PLAN.md`
- Phase 3: `./phases/phase-03-ingestion-worker-otel-run-telemetry/PLAN.md`
- Phase 4: `./phases/phase-04-collector-and-sink-pipeline/PLAN.md`
- Phase 5: `./phases/phase-05-e2e-smoke-and-closeout/PLAN.md`

Phase summaries:

- Phase 0: `./phases/phase-00-scope-and-schema-freeze/SUMMARY.md`
- Phase 1: `./phases/phase-01-supervisor-api-trace-owner-hardening/SUMMARY.md`
- Phase 2: `./phases/phase-02-retrieval-runtime-observation-bridge/SUMMARY.md`
- Phase 3: `./phases/phase-03-ingestion-worker-otel-run-telemetry/SUMMARY.md`
- Phase 4: `./phases/phase-04-collector-and-sink-pipeline/SUMMARY.md`
- Phase 5: `./phases/phase-05-e2e-smoke-and-closeout/SUMMARY.md`

## Boundary Notes

- 本线只处理 OTel runtime bridge、trace propagation、sanitized event/log/metric 映射、
  Collector pipeline 与 sink acceptance。
- 本线不重新设计 canonical retrieval、chunking、embedding、release gate、qrels 或 reranker
  adoption policy。
- 本线不把 `opentelemetry` SDK 引入 `packages/retrieval-core`、`packages/rag-agent`
  或 `packages/contracts`。
- 本线不把 Sentry、Axiom、Collector schema 泄漏进 contracts。
- 本线不把 telemetry sink 当成 panel / product read model；operator-facing projection
  仍由 app-owned read model/API 承载。
- 本线默认不发送 raw prompt、raw query、raw answer、chunk 正文、OCR 原文、JWT、cookie、
  auth material 或 long-term memory 原文。

## Related Architecture

- `docs/decisions/adr-0010-observability-and-telemetry-stack.md`
- `docs/architecture/system/operator-observability-architecture.md`
- `docs/architecture/system/retrieval-serving-architecture.md`
- `docs/architecture/system/execution-and-agents-architecture.md`
- `docs/architecture/system/product-runtime-architecture.md`
- `docs/runbooks/index-release-runbook.md`
- `docs/runbooks/supervisor-api-staging-operations.md`
- `.planning/workstreams/canonical-retrieval-quality-ops-hardening/README.md`
