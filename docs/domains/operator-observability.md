---
doc_type: index
status: active
created: 2026-04-12
updated: 2026-04-12
---

# Operator Observability Domain

## 先看什么

- supporting architecture：`../architecture/operator-observability-architecture.md`
- product/runtime ownership：`../architecture/product-runtime-architecture.md`
- 当前 merged truth：`../architecture/current-architecture.md`
- 当前项目执行真相：`../../.planning/PROJECT.md`

## 长期边界与决策

- `../architecture/operator-observability-architecture.md`
- `../decisions/adr-0023-operator-observability-control-plane-and-sink-participation.md`
- `../decisions/adr-0016-app-api-request-projection-and-panel-query-ownership.md`

## Contract 与 Data

- `../contracts/app-api-operator-observability-http.md`
- `../contracts/app-api-http.md`
- `../data/app-api-schema.md`

## 当前阅读顺序

- 当前 merged truth 以 `../architecture/current-architecture.md`、`../architecture/operator-observability-architecture.md` 与 contract/data 文档为准
- 当前与本域直接相关的 active project work 主要是 Phase 15 中的 observability summary / artifact retention 扩展
- operator observability control plane 扩面与 `Requests` triage table 重构仍是 accepted follow-up，但当前没有独立 active execution wave

## Active Plan

- `../plans/hallucination-governance-and-grounded-generation-execution-plan.md`

## Deferred Follow-up Plans

- `../plans/operator-observability-control-plane-foundation.md`
- `../plans/protected-panel-requests-triage-table-redesign.md`

## Runbooks / smoke

- `../runbooks/worker-observability-smoke-runbook.md`
- `../runbooks/worker-observability-smoke-artifact-template.md`
- `../runbooks/dev-backed-supervisor-staging-smoke-runbook.md`

## Reference

- `../reference/testing-and-verification-lanes.md`
- `../reference/runtime-serving-and-index-terms.md`

## 使用说明

- panel 只能读 `app-api` owned projections / rollups
- `Sentry`、`Axiom`、grader 结果只作为 sink 或输入来源，不是 panel query backend
- 如需判断当前 pending work，优先看 `.planning/PROJECT.md` / `.planning/STATE.md`，不要把 deferred follow-up 文档误读成当前 active lane
