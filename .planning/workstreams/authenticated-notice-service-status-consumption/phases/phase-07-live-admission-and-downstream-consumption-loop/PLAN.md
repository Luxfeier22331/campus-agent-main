---
doc_type: plan
status: active
created: 2026-04-28
updated: 2026-04-28
phase: Phase 7
workstream: authenticated-notice-service-status-consumption
---
# Phase 7 Plan: Live Admission And Downstream Consumption Loop

<!-- markdownlint-disable MD013 -->

## Goal

让真实 service-status 类 authenticated notices 正确进入
`notice_consumption_projection`，并完整消费到
`service_status_lookup` 与产品回答路径：

```text
authenticated notice
-> notice_consumption_projection
-> service_status typed projection
-> PostgreSQL release catalog/current pointer/read model
-> supervisor service_status_lookup
-> app-api/public-chat answer
```

这不是归档阶段。当前 fixture coverage 和 `355867` boundary rejection 只能证明代码路径与边界规则，不能证明 live service-status consumption 已完成。

## Tasks

1. Diagnose live admission gap.
   - Inspect `notice_consumption_projection` routing, promotion manifests and
     candidate reports for facility / IT platform / library / service-counter
     service-status families.
   - Determine whether missing live notices are absent from collection, routed
     to hold/runtime-only buckets, rejected by admission, or misclassified as
     regulation / schedule / service guide / contact / notice-level query.
   - Preserve boundary ownership; do not force unrelated notice families into
     service status to manufacture passing evidence.
1. Repair the upstream notice-consumption route when needed.
   - Update taxonomy/routing/admission rules only where the source notice is a
     real current service-status fact.
   - Add deterministic regression coverage for each repaired family.
   - Keep candidate taxonomy separate from consumer admission and runtime
     opening.
1. Build live service-status projection.
   - Run preview against selected live publishable candidate ids.
   - Require non-empty `service_status_records` with valid `service_family`,
     subject refs, status, effective window and source refs.
   - Record rejected-source rows for non-publishable candidates.
1. Publish through release/read model.
   - Stage without moving current.
   - Promote only after validation passes.
   - Verify PG release catalog, current pointer and
     `service_status_read_model`.
1. Prove downstream tool consumption.
   - Run supervisor `service_status_lookup` against the promoted live record.
   - Run app-api/public-chat structured answer path and verify Chinese answer
     text, effective window and low-distraction source presentation.
   - Capture fail-close examples for missing, ambiguous or conflict cases.
1. Update state and registry only after the true live loop is proven.
   - `README.md`
   - `STATE.md`
   - `ROADMAP.md`
   - `.planning/WORKSTREAMS.md`

## Expected Artifacts

- `evidence/phase-07-live-admission-loop/README.md`
- live admission diagnosis report
- selected live candidate manifest
- preview/stage/promote build reports
- rejected-source report
- PG current/list/read-model smoke output
- runtime `service_status_lookup` smoke output
- app-api/public-chat answer smoke output
- Updated `STATE.md`
- Updated `ROADMAP.md`

## Acceptance Criteria

- Evidence proves at least one publishable live service-status notice reaches PG
  typed read model and runtime lookup.
- Evidence proves service-status family notices enter the notice consumption
  layer intentionally, not through schedule/regulation/service-guide/contact
  misclassification.
- Rejected cases are recorded rather than silently dropped.
- Runtime remains projection-backed and fail-closed.
- Product answer does not expose technical internals.
- Workstream remains active until the full live loop is proven. Only then can
  the registry move this line to completed with a clear reopen rule.

## Verification

```bash
uv run --all-packages python -m unittest \
  tests.ingestion.test_notice_derived_service_status_materialization \
  tests.ingestion.test_build_service_status_projection_worker \
  tests.ingestion.test_structured_projection_postgres \
  tests.agent.test_campus_services_agent
```

```bash
pnpm web:test -- --runInBand \
  apps/app-api/test/chat-command.service.core.structured.suite.ts
```
