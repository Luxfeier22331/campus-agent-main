---
workstream: operator-observability-control-plane
created: 2026-04-19
updated: 2026-04-20
---

# Project State

## Current Position

**Status:** Active
**Current Phase:** 12
**Current Phase Name:** Staging Smoke And Planning Closeout
**Current Plan:** `<none>`
**Total Phases:** 12
**Total Plans in Phase:** 0
**Progress:** 11/12 phases complete
**Last Activity:** 2026-04-20
**Last Activity Description:** Completed `Phase 11`: dev/local preflight, seeded data, Worker smoke, public chat live request, protected panel observability routes, and artifact pack are now closed with fresh evidence.

## Current Slice

- completed `Phase 4` artifacts:
  - context: `.planning/workstreams/operator-observability-control-plane/phases/phase-4-panel-shared-data-layer/CONTEXT.md`
  - plan: `.planning/workstreams/operator-observability-control-plane/phases/phase-4-panel-shared-data-layer/PLAN.md`
  - summary: `.planning/workstreams/operator-observability-control-plane/phases/phase-4-panel-shared-data-layer/SUMMARY.md`
- completed `Phase 5` artifacts:
  - context: `.planning/workstreams/operator-observability-control-plane/phases/phase-5-panel-overview-domain/CONTEXT.md`
  - plan: `.planning/workstreams/operator-observability-control-plane/phases/phase-5-panel-overview-domain/PLAN.md`
  - summary: `.planning/workstreams/operator-observability-control-plane/phases/phase-5-panel-overview-domain/SUMMARY.md`
- completed `Phase 6` artifacts:
  - context: `.planning/workstreams/operator-observability-control-plane/phases/phase-6-panel-quality-domain/CONTEXT.md`
  - plan: `.planning/workstreams/operator-observability-control-plane/phases/phase-6-panel-quality-domain/PLAN.md`
  - summary: `.planning/workstreams/operator-observability-control-plane/phases/phase-6-panel-quality-domain/SUMMARY.md`
- completed `Phase 7` artifacts:
  - context: `.planning/workstreams/operator-observability-control-plane/phases/phase-7-panel-safety-authz-domain/CONTEXT.md`
  - plan: `.planning/workstreams/operator-observability-control-plane/phases/phase-7-panel-safety-authz-domain/PLAN.md`
  - summary: `.planning/workstreams/operator-observability-control-plane/phases/phase-7-panel-safety-authz-domain/SUMMARY.md`
- completed `Phase 8` artifacts:
  - context: `.planning/workstreams/operator-observability-control-plane/phases/phase-8-panel-cost-domain/CONTEXT.md`
  - plan: `.planning/workstreams/operator-observability-control-plane/phases/phase-8-panel-cost-domain/PLAN.md`
  - summary: `.planning/workstreams/operator-observability-control-plane/phases/phase-8-panel-cost-domain/SUMMARY.md`
- completed `Phase 9` artifacts:
  - context: `.planning/workstreams/operator-observability-control-plane/phases/phase-9-panel-audit-domain/CONTEXT.md`
  - plan: `.planning/workstreams/operator-observability-control-plane/phases/phase-9-panel-audit-domain/PLAN.md`
  - summary: `.planning/workstreams/operator-observability-control-plane/phases/phase-9-panel-audit-domain/SUMMARY.md`
- completed `Phase 10` artifacts:
  - context: `.planning/workstreams/operator-observability-control-plane/phases/phase-10-sink-participation-and-grade-backflow/CONTEXT.md`
  - plan: `.planning/workstreams/operator-observability-control-plane/phases/phase-10-sink-participation-and-grade-backflow/PLAN.md`
  - summary: `.planning/workstreams/operator-observability-control-plane/phases/phase-10-sink-participation-and-grade-backflow/SUMMARY.md`
- completed `Phase 11` artifacts:
  - context: `.planning/workstreams/operator-observability-control-plane/phases/phase-11-dev-smoke-and-evidence/CONTEXT.md`
  - plan: `.planning/workstreams/operator-observability-control-plane/phases/phase-11-dev-smoke-and-evidence/PLAN.md`
  - summary: `.planning/workstreams/operator-observability-control-plane/phases/phase-11-dev-smoke-and-evidence/SUMMARY.md`
- current forward truth:
  - `protected-panel-web` 已有 `getOperatorOverview / getOperatorQualitySummary / getOperatorQualityTimeseries / listOperatorQualityBadcases / getOperatorSafetySummary / listOperatorSafetyAnomalies / getOperatorCostSummary / getOperatorCostTimeseries / listOperatorAudit / getOperatorAuditEvent`
  - operator list seams 统一使用 shared sequential cursor helper，不再每个 domain 自己实现一套分页历史
  - `/observability/overview` `/observability/quality` `/observability/safety` `/observability/cost` `/observability/audit` 已是实际 domain pages
  - dashboard `/` 与左侧菜单“总览”已切到 `/observability/overview`；旧 `/api/overview` 只保留 runtime diagnostics 语义
  - `OverviewPage` 已固定 `window/surface/selectedTarget` filter model，并以 `useQueries + dataProvider + @mui/x-charts` 组合消费 overview / quality timeseries / cost timeseries seams
  - `QualityPage` 已成为真正 domain page，并以 custom methods 组合消费 summary / timeseries / badcase queue，不回退成 fake CRUD resource
  - `SafetyPage` 已成为真正 domain page，并以 custom methods 组合消费 safety summary / anomaly queue，显式区分 summary filters 与 queue filters，不伪造 safety timeseries
  - `CostPage` 已成为真正 domain page，并以 custom methods 组合消费 cost summary / timeseries；`byModel` 与 `bySurface` 分布已落地，且第一版继续排除 fake billing reconciliation / queue / export 语义
  - `AuditPage` 已成为真正 domain page，并以 custom methods 组合消费 audit timeline / detail；drawer 已收口 request / trace / issue backlink，不回退成 raw log viewer 或 fake resource
  - `apps/app-api` 现在已把 `request_id` / `safety_identifier` 等高基数字段从 `Sentry` tag 移入 structured request context，只保留 ADR-0023 允许的 searchable tags
  - `apps/app-api` 现在已把 `Axiom` runtime sink 从 blacklist-only 改成 `event_type -> allowlist`，并统一补上 `occurred_at / environment / release` canonical envelope
  - internal `quality` ingest seam 现在会在 `quality_grade_projection` upsert 成功后稳定发出 `quality.sampled_grade` sink 事件，不改变 panel truth owner

## Blockers

- `apps/protected-panel-web` 现有 `/api/overview` 仍继续承担壳层状态与 auth-provider 探针；后续 phase 必须继续避免把它重新混用成 observability aggregate truth。
- `Phase 12` 的 staging smoke 与 planning closeout 仍未执行。

## Verification

- `pnpm --dir apps/app-api exec vitest run -c vitest.node.config.mts test/telemetry.index.test.ts test/telemetry.axiom.test.ts test/operator-observability-command.service.test.ts`
- `pnpm --dir apps/app-api typecheck`
- `pnpm --dir apps/app-api test:node`
- `pnpm --dir apps/app-api test:shared-db-integration`

## Session Continuity

**Stopped At:** `Phase 11` 已完成并留下 dev-local artifact；下一次恢复应直接规划 `Phase 12: Staging Smoke And Planning Closeout`。
**Resume File:** .planning/workstreams/operator-observability-control-plane/ROADMAP.md
