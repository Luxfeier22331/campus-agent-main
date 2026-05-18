---
doc_type: roadmap
status: completed
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Roadmap: Runtime OTel Observability Bridge

## Status Semantics

This workstream is completed. Phase execution truth is the explicit `Status:` line in this
roadmap, plus `STATE.md` and each phase `PLAN.md` / `SUMMARY.md`.

## Phase 0: Scope And Schema Freeze

**Status:** completed on 2026-05-01.

**Goal:** 冻结 OTel 接入边界、runtime ownership、event/span/log/metric taxonomy、
attribute allowlist、redaction policy 和 focused verification plan。

**Scope:**

- 盘点现有 telemetry implementation：`supervisor-api` Go OTel、`app-api` telemetry、
  `retrieval-core` observation seam、eval monitoring JSONL。
- 定义 runtime ownership matrix：`supervisor-api`、`supervisor-agent-worker`、
  `ingestion-worker`、`app-api`、Collector、Sentry、Axiom。
- 定义 event taxonomy：
  - `runtime.request.accepted/finalized/failed`
  - `agent.bridge.started/completed/failed`
  - `retrieval.runtime_observation`
  - `ingestion.run.started/completed/failed`
  - `index.release.audit/publish`
  - `telemetry.export.failed/dropped`
- 定义 allowed attributes and forbidden fields。
- 定义 trace correlation：`trace_id`、`span_id`、`request_id`、`run_id`、`step_id`、
  `collection`、`surface`、`profile_hash`。

**Acceptance:**

- Requirements / architecture / runbook docs 对接入边界一致。
- `retrieval-core` / contracts 不新增 OTel dependency。
- Phase 1-5 有明确 focused test gate。

**Evidence:** `./phases/phase-00-scope-and-schema-freeze/SUMMARY.md`.

## Phase 1: Supervisor API Trace Owner Hardening

**Status:** completed on 2026-05-01.

**Goal:** 把 `apps/supervisor-api` 固定为在线请求 trace owner，并补齐 request -> orchestration ->
worker bridge -> finalization 的 trace/span/event 口径。

**Scope:**

- 审计现有 OTel emitter、config、readiness、metrics self-health。
- 为 request admission、answer stream、agent bridge transport、tool call、finalization/error
  建立稳定 span/event 名称。
- 确保 `traceparent` / request id 传给 `supervisor-agent-worker`。
- 增加 OTel attribute allowlist validation 和 secret redaction tests。
- exporter failure 只影响 telemetry health，不影响 answer path。

**Acceptance:**

- Go tests 覆盖 enabled/disabled、missing endpoint、sample ratio、headers redaction、
  exporter failure 和 trace propagation。
- `/readyz` / metrics 能表达 telemetry enabled/exporter configured/exported/failed/dropped。

**Evidence:** `./phases/phase-01-supervisor-api-trace-owner-hardening/SUMMARY.md`.

## Phase 2: Retrieval Runtime Observation Bridge

**Status:** completed on 2026-05-01.

**Goal:** 在 `apps/supervisor-agent-worker` 或明确 runtime adapter 中把
`retrieval.runtime_observation` 接到 OTel-compatible event/log/span。

**Scope:**

- 接入 `build_retrieval_observation_event_sink()` 或等价 adapter。
- 映射字段：`request_id`、`plan_id`、`step_id`、`scope.corpus`、`scope.collection`、
  `query_mode`、`retrieval_mode`、`terminal_state`、`failure_kind`、`candidate_count`、
  `reference_count`、`latency_ms`、`query_sha256`、`release_id`、`profile_hash`。
- 禁止 raw query / raw snippet / document body 进入 OTel attributes。
- 派生低基数 metrics：request count、latency histogram、no-hit、low-confidence、
  forbidden-hit、release metadata drift、reranker degraded。
- sink failure warning only，不破坏 answer path。

**Acceptance:**

- Python tests 覆盖 no-hit、release drift、reranker degraded、sink failure、raw query absent。
- `packages/retrieval-core` 保持无 OTel import。

**Evidence:** `./phases/phase-02-retrieval-runtime-observation-bridge/SUMMARY.md`.

## Phase 3: Ingestion Worker OTel Run Telemetry

**Status:** completed on 2026-05-01.

**Goal:** 为离线 ingestion/data plane 增加 run-level OTel bridge，覆盖 canonical -> chunk ->
embedding -> index publish 的关键阶段。

**Scope:**

- 为 ingestion worker 增加 runtime telemetry adapter，不改变 `ingestion-core` 的核心逻辑边界。
- 发出 run-level events/spans：canonicalization、OCR/parser、chunking、embedding batch、
  cache hit/miss、Qdrant upsert、payload index audit、release audit、alias publish。
- 记录 count summary、latency、cost estimate、surface、collection、release id、run id、
  failure kind。
- 默认不发送 canonical body、chunk body、OCR raw text 或 source credential。
- exporter failure 不让 job 失败，但 job summary 要记录 telemetry degraded。

**Acceptance:**

- Ingestion focused tests 覆盖 run event schema、redaction、failure kind 和 fail-safe。
- Dry-run release benchmark / ingestion smoke 能生成 telemetry evidence。

**Evidence:** `./phases/phase-03-ingestion-worker-otel-run-telemetry/SUMMARY.md`.

## Phase 4: Collector And Sink Pipeline

**Status:** completed on 2026-05-01.

**Goal:** 提供 repo-owned Collector/adapter 配置和 runbook，让 sanitized telemetry 可以进入
Sentry/Axiom，同时保持 vendor 可替换。

**Scope:**

- 增加 local/staging Collector config template 或等价 adapter config。
- 配置 processors：memory limiter、batch、resource、attributes/filter redaction、sampling。
- 配置 exporters：Sentry traces/errors、Axiom logs/events/metrics；本地可用 debug exporter。
- 记录 env：OTLP endpoint、headers、service name、sample ratio、dataset、token secret handling。
- 明确 local 默认 off，staging/prod 显式开启。

**Acceptance:**

- Config lint / smoke 验证 Collector 可以启动或 dry-run validate。
- Runbook 能说明如何确认 Sentry/Axiom 收到 sanitized test event。

**Evidence:** `./phases/phase-04-collector-and-sink-pipeline/SUMMARY.md`.

## Phase 5: E2E Smoke And Closeout

**Status:** completed on 2026-05-01.

**Goal:** 用真实 runtime 路径证明 online retrieval、offline ingestion 与 sink failure 都满足
production acceptance，并关闭 workstream。

**Scope:**

- Online smoke：`app-api/public-chat` request -> `supervisor-api` -> worker -> retrieval
  observation -> OTel backend/debug sink。
- Offline smoke：sample canonical/index release run -> ingestion telemetry -> backend/debug sink。
- Negative smoke：Collector/exporter unavailable，product path 不失败，degraded health 有证据。
- 更新 docs/runbooks/architecture/current state。
- 完成 workstream summary、verification evidence、reopen rule。

**Acceptance:**

- Focused tests passing。
- Local debug Collector 或 staging sink smoke 有 evidence。
- `.planning/WORKSTREAMS.md` registry 与 workstream state 一致。

**Evidence:** `./phases/phase-05-e2e-smoke-and-closeout/SUMMARY.md`.
