---
doc_type: requirements
status: active
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Requirements: Runtime OTel Observability Bridge

## Goal

把 repo 已接受的 OpenTelemetry-first 方向落成 production-ready runtime bridge：
在线请求、agent worker、retrieval observation、离线 ingestion run 与 Collector/sink fan-out
都能用统一 trace/request correlation、字段白名单、脱敏和 fail-safe 规则进入观测系统。

## Background

当前事实：

- `apps/supervisor-api` 已经有 Go OTel SDK、OTLP HTTP exporter、采样、env gate、readiness
  和 Prometheus telemetry self-metrics。
- `apps/app-api` 已有 request lifecycle telemetry、Axiom sink 与 trace propagation helper。
- `packages/retrieval-core` 已有 `RetrievalObservationSink` 和
  `build_retrieval_observation_event_sink()`，会产生 `retrieval.runtime_observation`。
- canonical retrieval workstream 已明确：production observation 集成应由 runtime adapter
  负责，不进入 `retrieval-core`。
- ADR-0010 已接受 `OpenTelemetry-first -> Collector -> Axiom/Sentry` 方向。

剩余缺口：

- `retrieval.runtime_observation` 还没有正式映射成 OTel-compatible log/event/span。
- `supervisor-api -> supervisor-agent-worker -> rag-agent -> retrieval-core` 的 trace/request
  correlation 还没有完整验收。
- `ingestion-worker` 的 canonicalize / chunk / embedding / index publish run telemetry
  还没有统一 OTel bridge。
- Collector pipeline、redaction、sampling、fan-out、local smoke 与 staging acceptance
  还没有 repo-owned contract。
- Sentry/Axiom 只作为 sink；字段 schema、脱敏、采样与业务语义仍需由 repo 定义。

## In Scope

- OTel field allowlist and event taxonomy for runtime, retrieval and ingestion telemetry。
- `apps/supervisor-api` trace owner hardening：request admission、orchestration、agent bridge、
  tool call、finalization 与 error path 的 trace/span/event 口径。
- `apps/supervisor-agent-worker` retrieval observation bridge：把
  `retrieval.runtime_observation` 转成 sanitized OTel-compatible event/log/span。
- `apps/ingestion-worker` run-level telemetry bridge：canonicalize、chunk、embedding、index
  release、publish、audit、failure kind 与 cost/latency summary。
- `apps/app-api` trace propagation alignment：继续只做 request scope、traceparent 透传、
  product lifecycle event，不承担核心 retrieval/ingestion telemetry truth。
- Collector / adapter config template：batching、retry、memory limit、attribute filtering、
  redaction、sampling、Sentry/Axiom fan-out。
- Tests and runbooks proving exporter failure does not break product paths。
- Local/staging smoke commands and acceptance evidence。

## Non-goals

- 不把 OTel SDK 引入 `packages/retrieval-core`、`packages/rag-agent`、`packages/contracts`
  或其他稳定业务能力包。
- 不把 Axiom/Sentry 事件 schema 作为仓库 canonical contract。
- 不通过 telemetry sink 向 panel 或 product UI 提供 canonical read model。
- 不发送 raw prompt、raw query、raw answer、raw snippet、chunk body、OCR body、JWT、cookie、
  access envelope、session token、auth portal token 或 long-term memory 原文。
- 不重开 canonical retrieval release / qrels / reranker / freshness policy。
- 不解决 unrelated dirty worktree、agents-sdk pilot、authenticated-notice queue 或 public UI
  事项。

## Success Criteria

1. Repo 有明确 telemetry taxonomy 与 attribute allowlist，覆盖 request、agent bridge、
   retrieval runtime observation、ingestion run 和 exporter self-health。
2. `supervisor-api` 是在线请求 trace owner；trace/request/span correlation 能贯穿到 worker
   bridge 和 retrieval observation。
3. `retrieval.runtime_observation` 可被 runtime adapter 转成 OTel-compatible event/log/span；
   默认只包含 `query_sha256`，不包含 raw query。
4. Ingestion run 能报告 canonicalize/chunk/embedding/index publish 的 run id、surface、
   collection、release id、profile hash、latency、count summary、failure kind 与 cost estimate。
5. Collector / adapter 配置可以把 sanitized telemetry fan-out 到 Sentry/Axiom，并能本地 smoke。
6. Exporter / sink / Collector 不可用时，answer path、worker path 和 ingestion job 不失败；
   但 self-health、drop/failure counter 和 degraded readiness 有证据。
7. Tests 覆盖字段脱敏、trace propagation、sink failure fail-safe、retrieval observation bridge、
   ingestion run event 和 config validation。
8. Docs/runbooks 说明本地默认 off、staging 如何开启、需要哪些 env、如何验证 Sentry/Axiom
   收到事件、如何排查 drop/failure。

## Canonical Entry

- `.planning/workstreams/runtime-otel-observability-bridge/README.md`
