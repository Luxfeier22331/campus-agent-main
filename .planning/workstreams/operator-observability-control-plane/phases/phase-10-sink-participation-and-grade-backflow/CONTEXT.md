---
phase: "10"
name: "Sink Participation And Grade Backflow"
created: 2026-04-20
updated: 2026-04-20
status: active
---

# Phase 10 Context

## Goal

交付 operator observability 的 sink participation / grading backflow 收口。

它要把当前已经存在但还未完全 productize 的 sink/backflow 路径，收口成稳定的 app-owned 输入层：

- `Sentry` tag/context boundary alignment
- `Axiom` event governance alignment
- sampled grading backflow 的 sink-level productization

## Current Truth

- `Phase 1-3` 已经完成 request observability fact、audit projection、aggregate APIs
- `Phase 4-9` 已经完成 panel side rollout：
  - `Overview`
  - `Quality`
  - `Safety/Authz`
  - `Cost`
  - `Audit`
- `apps/app-api` 当前已具备：
  - `quality_grade_projection`
  - `trace_backlink_projection`
  - `/api/internal/operator/quality/grades`
  - `/api/internal/operator/trace-backlinks`
  - `createAppTelemetry()`
  - `createAxiomRuntimeEventSink()`
- 当前 panel 已能消费：
  - sampled grade summary / timeseries / badcase grade
  - trace / issue backlink

## Contract Reality

- operator-facing panel 仍只允许消费 app-owned read model
- sink-derived truth 必须先经过 internal ingest seam 写回 app-owned projection
- 当前长期 accepted 规则已在 ADR / architecture 中冻结：
  - `Sentry` 只负责 error / trace / minimal deep link
  - `Axiom` 负责高吞吐结构化事件
  - `grader` 结果必须先回流 `quality_grade_projection`
  - panel 不得直接查询 sink

## Why This Phase Exists

虽然当前 repo 已有 internal ingest seam 和部分 telemetry adapter，但仍存在几个明显 residual gap：

- `Axiom` 当前仍以通用黑名单过滤为主，还没升级到 `event_type -> allowlist`
- `Sentry` 当前仍把 `request_id` 等高基数字段打进 tag，未按 ADR 拆到 context
- sampled grading 已回流 projection，但还没有稳定的 sink-level `quality.sampled_grade` productization

这会让当前实现停在“能跑但没有完全对齐 accepted sink posture”的状态。

## Locked Decisions

### Ownership Decision

- `apps/app-api` 继续是 sink backflow 的第一 owner
- `protected-panel-web` 不新增 sink query 能力
- `Sentry` / `Axiom` / grader 继续只作为 sink 或回流输入

### Sentry Decision

- searchable tags 只保留长期可控、低风险、对 request debugging 真有帮助的字段
- 高基数 request identity 与 richer diagnostics 进入 structured context
- panel 继续只消费 app-owned trace backlink projection，不直接发起 sink query

### Axiom Decision

- 当前 phase 必须把治理从 blacklist-only 收口到 `event_type -> allowlist`
- 所有稳定事件必须带 canonical envelope
- unsupported / undeclared event type 不应继续静默进入 sink

### Grading Backflow Decision

- sampled grading 的 canonical write path 继续是 internal ingest seam -> `quality_grade_projection`
- 同时补齐 sink-level `quality.sampled_grade` 事件 productization
- 不把 grader 原始 payload、逐 token 判断材料或 raw trace blob 直接送入 panel truth

### Anti-Shortcut Decision

- 不新增 panel 直查 `Sentry` / `Axiom`
- 不把 `trace_backlink_projection` 变成 raw sink cache
- 不把 `quality_grade_projection` 变成 grader vendor schema 镜像
- 不接受“继续只靠 blacklist”作为长期事件治理

## External Best-Practice Inputs

### Sentry Official Docs

- `Tags` 官方文档明确说明 tags 是 indexed and searchable，驱动 filters 与 tag-distribution map
- `Context` 官方文档明确说明 structured context 可附加任意数据，但不可搜索
- 这与 ADR-0023 中“低基数字段进 tag，高基数字段进 context”完全一致

### Axiom Official Docs

- 官方 dataset 文档建议按 environment / signal type / service 拆 dataset
- 官方明确反对 `kitchen sink` dataset
- 这与 ADR-0023 中 `event_type -> allowlist`、统一 envelope、拒绝半结构化 dump 的方向一致

### OpenAI Official Docs

- `trace grading` 官方文档确认 trace-based grading 是正式支持的质量治理路径
- 这支撑 sampled grading 继续作为独立 backflow 输入层，而不是混进 panel query backend

## Existing Code Insights

### Relevant App Files

- `apps/app-api/src/modules/telemetry/index.ts`
- `apps/app-api/src/modules/telemetry/axiom.ts`
- `apps/app-api/src/modules/operator-observability-command/service.ts`
- `apps/app-api/src/modules/operator-observability-command/store.ts`
- `apps/app-api/src/app.ts`

### Relevant Tests

- `apps/app-api/test/telemetry.index.test.ts`
- `apps/app-api/test/telemetry.axiom.test.ts`
- `apps/app-api/test/operator-observability-ingest.route.test.ts`
- `apps/app-api/test/operator-observability-shared-db.integration.test.ts`

## Phase 10 Deliverable Boundary

本 phase 结束时，仓库应具备：

- `Sentry` tag/context split 与 ADR 对齐
- `Axiom` allowlist + envelope 治理落地
- `quality.sampled_grade` 事件从 ingest seam 稳定产出
- app-owned projection / panel truth 边界保持不变

本 phase 不要求：

- panel 新页面
- sink dashboard UI
- raw trace / raw grader explorer
- dev/staging smoke

## Canonical References

- `docs/architecture/system/operator-observability-architecture.md`
- `docs/decisions/adr-0023-operator-observability-control-plane-and-sink-participation.md`
- `docs/contracts/app-api-operator-observability-http.md`
- `docs/plans/archive/completed/operator-observability-control-plane-foundation.md`
