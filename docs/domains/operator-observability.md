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

## 长期边界与决策

- `../architecture/operator-observability-architecture.md`
- `../decisions/adr-0023-operator-observability-control-plane-and-sink-participation.md`
- `../decisions/adr-0016-app-api-request-projection-and-panel-query-ownership.md`

## Contract 与 data

- `../contracts/app-api-operator-observability-http.md`
- `../contracts/app-api-http.md`
- `../data/app-api-schema.md`

## 当前前向计划

- `../plans/operator-observability-control-plane-foundation.md`
- `../plans/protected-panel-requests-triage-table-redesign.md`
- `../plans/hallucination-governance-and-grounded-generation-execution-plan.md`

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
