---
doc_type: index
truth_scope: ops
owner_boundary: docs/domains
status: active
created: 2026-04-12
updated: 2026-04-21
---
# Operator Observability Domain

## 先看什么

- supporting
  architecture：`../architecture/system/operator-observability-architecture.md`
- product/runtime ownership：`../architecture/system/product-runtime-architecture.md`
- 当前 merged truth：`../architecture/current-architecture.md`
- 通用执行态入口：`README.md`

## 长期边界与决策

- `../architecture/system/operator-observability-architecture.md`
- `../decisions/adr-0023-operator-observability-control-plane-and-sink-participa
  tion.md`
- `../decisions/adr-0016-app-api-request-projection-and-panel-query-ownership.md
  `

## Contract 与 Data

- `../contracts/app-api-operator-observability-http.md`
- `../contracts/app-api-http.md`
- `../data/app-api-schema.md`

## 执行路由

- 当前 merged truth 统一看 `../architecture/current-architecture.md`、`../architecture
  /operator-observability-architecture.md` 与 contract/data 文档
- 当前 work map 与 live session state 分别看 `README.md` 定义的通用执行态入口与 GSD SDK /
  Codex native session
- `Requests` triage table 重构继续只作为 follow-up 入口，不自动并入当前 active workstream

## Historical Follow-up Material

- Operator-observability foundation 与 protected-panel requests triage redesign
  的历史 plan 通过 git history 恢复；不要把旧 archive 当作当前 execution truth。

## Runbooks / smoke

- `../runbooks/execution-control-staging-operations.md`
- `../runbooks/execution-control-staging-smoke-runbook.md`
- `../runbooks/worker-observability-smoke-runbook.md`
- `../runbooks/templates/worker-observability-smoke-artifact-template.md`

## Reference

- `../reference/testing-and-verification-lanes.md`
- `../reference/runtime-serving-and-index-terms.md`

## 使用说明

- Operator Console 只能读 `app-api` owned projections / rollups
- `Sentry`、`Axiom`、grader 结果只作为 sink 或输入来源，不是 Operator Console query backend
- 如需判断当前 pending work，优先看 `README.md` 定义的通用执行态入口与 GSD SDK / Codex
  native session，不要把历史 follow-up 文档误读成当前 active lane
