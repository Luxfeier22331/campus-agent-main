---
doc_type: phase_plan
phase: "10"
phase_name: "Sink Participation And Grade Backflow"
status: active
created: 2026-04-20
updated: 2026-04-20
---

# Phase 10 Plan

## Objective

把 `Sentry` / `Axiom` / sampled grading 的参与边界真正收口到 app-owned sink/backflow posture。

## Current Baseline

- 已具备：
  - `quality_grade_projection`
  - `trace_backlink_projection`
  - internal ingest routes
  - `createAppTelemetry()`
  - Axiom sink adapter
- 未具备：
  - `Sentry` tags/context 完整对齐 ADR
  - `Axiom` allowlist governance
  - sampled grading 的 sink-level productization

## Online Best-Practice Alignment

### Sentry

- 官方文档明确：tags 是 indexed/searchable，context 不可搜索但可承载 richer structure
- 本 phase 应把高基数字段从 tag 移到 context

### Axiom

- 官方文档明确反对 `kitchen sink`
- 本 phase 应把 runtime event sink 从“接受所有标量字段”升级到“只接受声明过的 event schema”

### OpenAI Trace Grading

- 官方 trace grading 文档支持 trace-based grading 作为正式质量治理面
- 本 phase 应把 sampled grading 明确为 backflow input，而不是 panel-side ad-hoc join

## Phase 10 Product Decisions

### Slice 1: Sentry Governance Convergence

- 移除高基数 searchable tags：
  - `request_id`
  - 其他 request identity 类字段
- 改为 structured context：
  - request identity
  - conversation identity
  - richer diagnostics / safety marker
- 保留 searchable tags：
  - `trace_id`
  - `surface`
  - `route`
  - `status`
  - `selected_target`
  - `requested_capability`
  - `requested_scope_summary`
  - `principal_type`
  - `error_code`
  - `model_name`

### Slice 2: Axiom Event Allowlist

- 引入 `event_type -> allowlist`
- 统一 canonical envelope：
  - `event_type`
  - `occurred_at`
  - `request_id`
  - `trace_id`
  - `surface`
  - `selected_target`
  - `requested_capability`
  - `requested_scope_summary`
  - `principal_type`
  - `status`
  - `error_code`
  - `environment`
  - `release`
- unsupported event type 默认不发往 sink

### Slice 3: Sampled Grade Productization

- 为 ingest seam 增加稳定 `quality.sampled_grade` event 产出
- 保持 projection 仍为 canonical panel truth
- grader 原始 payload 不进入 sink / panel truth

### Slice 4: Regression Locking

- 为 telemetry / sink adapter / ingest service 补 tests：
  - Sentry tag/context split
  - Axiom allowlist behavior
  - sampled grade event emission
  - existing operator ingest route / shared-db integration 不回退

## Proposed Write Set

- `.planning/workstreams/operator-observability-control-plane/phases/phase-10-sink-participation-and-grade-backflow/CONTEXT.md`
- `.planning/workstreams/operator-observability-control-plane/phases/phase-10-sink-participation-and-grade-backflow/PLAN.md`
- `apps/app-api/src/modules/telemetry/index.ts`
- `apps/app-api/src/modules/telemetry/axiom.ts`
- `apps/app-api/src/modules/operator-observability-command/service.ts`
- `apps/app-api/src/app.ts`
- `apps/app-api/test/telemetry.index.test.ts`
- `apps/app-api/test/telemetry.axiom.test.ts`
- `apps/app-api/test/operator-observability-command.service.test.ts`
- `apps/app-api/test/operator-observability-shared-db.integration.test.ts`

## Verification

- `pnpm --dir apps/app-api typecheck`
- `pnpm --dir apps/app-api test:node`
- `pnpm --dir apps/app-api test:shared-db-integration`

## Exit Rule

只有在以下条件同时成立时，`Phase 10` 才算完成：

- `Sentry` tag/context posture 已对齐 ADR
- `Axiom` 已改成 allowlist + canonical envelope
- `quality.sampled_grade` 已从 ingest seam 稳定产出
- panel 仍只消费 app-owned projection / backlink
- fresh verification 全绿
