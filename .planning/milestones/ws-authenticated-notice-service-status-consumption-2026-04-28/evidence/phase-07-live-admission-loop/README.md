---
doc_type: evidence
status: active
created: 2026-04-28
updated: 2026-04-28
---
# Phase 7 Evidence: Live Admission Loop

<!-- markdownlint-disable MD013 -->

## Summary

Phase 7 已证明第一条真实 service-status authenticated notice 的完整消费闭环：

```text
authenticated notice 355650
-> notice_consumption_projection
-> service_status typed projection
-> PostgreSQL release catalog/current pointer/read model
-> supervisor service_status_lookup
-> app-api ChatCommandService
-> supervisor HTTP execution seam
-> app-api/public-chat answer normalization
```

这条 workstream 仍保持 active，不在本轮归档；当前状态是 Phase 7 live loop evidence 已捕获，等待最终 review / commit / 是否归档的显式决策。

## Initial Boundary Evidence

初始 live cohort 只有 `355867`，它是 transport/schedule 边界样本。service-status materializer 正确拒绝该 notice，证明不会把班车时刻表误吸收到 service status。

Evidence files:

- `live-355867-preview/build-report.json`
- `live-355867-preview/service-status-ws-phase7-preview-20260428T093000/service-status-projection.json`
- `live-355867-preview/service-status-ws-phase7-preview-20260428T093000/rejected-source-report.json`
- `live-355867-preview/service-status-ws-phase7-preview-20260428T093000/release-manifest.json`

## Publishable Live Candidate

Selected real authenticated notice:

- notice id: `355650`
- title: `关于静园10号楼负一层女浴室试运行的通知`
- family: `facility_transport_classroom_status`
- candidate kind: `service_status`
- target surface: `campus_services/service_status_candidate`
- source export: `apps/authenticated-notice-collector/runtime/exports/notices-bundle-20260427T040803.251Z.json`

Materialized service-status record:

- `subject_id`: `facility:bathroom:jingyuan-10`
- `display_name`: `静园10号楼负一层女浴室`
- `service_family`: `facility`
- `observed_status`: `limited_service`
- `effective_from`: `2026-04-16T00:00:00+08:00`
- `effective_until`: `2099-12-31T23:59:59+08:00`
- `related_notice_refs`: `notice:muc_internal_portal:355650`

Evidence files under `live-355650-facility-trial/`:

- `selected-bundle.json`
- `consumer-admission-manifest.json`
- `projection-gate.json`
- `import-plan.json`
- `import-admit-and-materialize.json`
- `notice-consumption-projection-rebuild.json`
- `service-status-candidate-list.json`
- `service-status-preview.stdout.json`
- `service-status-stage.stdout.json`
- `service-status-promote.stdout.json`
- `pg-current-after-promote.json`
- `pg-list-after-promote.json`

## Runtime Lookup Evidence

Supervisor HTTP seam was run against local `supervisor-api` with `CAMPUS_SHARED_POSTGRES_URL` loaded from the repo `.env` and a temporary local `SUPERVISOR_INTERNAL_QUERY_SHARED_SECRET`.

Request:

```json
{
  "subject_query": "静园10号楼女浴室",
  "temporal_query": { "mode": "current" },
  "campus_scope": "haidian"
}
```

Result file:

- `live-355650-facility-trial/supervisor-service-status-lookup.json`

Observed result:

- `outcome`: `resolved_current`
- `resolved_subject`: `静园10号楼负一层女浴室`
- `observed_status`: `limited_service`
- `related_notice_refs`: `notice:muc_internal_portal:355650`

This proves runtime reads the promoted PostgreSQL current typed read model; no raw notice scan, object-store current JSON fallback, or RAG fallback is involved.

## Product Answer Evidence

App API product normalization was verified with the promoted live-shaped tool result.

Result file:

- `live-355650-facility-trial/app-api-public-chat-service-status-smoke.json`

Visible user payload:

- Chinese answer text includes `静园10号楼负一层女浴室：当前状态：有限开放。`
- Open-ended `2099-12-31` sentinel is rendered as `有效时间：4月16日 00:00 起。`
- Source summary is `来源：校内通知`
- Source trace card shows `校内通知 #355650`
- Visible payload hides `notice:muc_internal_portal:355650`, `muc_internal_portal`, release ids and `2099`

## Full App API To Supervisor E2E Evidence

The product path was also verified through the real app-api supervisor client seam:

```text
app-api ChatCommandService
-> SupervisorExecutionClient HTTP /api/v1/answer
-> supervisor-api structured service_status_lookup
-> PostgreSQL current read model
-> app-api visible answer normalization
```

Result files:

- `live-355650-facility-trial/app-api-to-supervisor-public-chat-e2e.json`
- `live-355650-facility-trial/app-api-supervisor-e2e-supervisor.log`

Prompt:

```text
静园10号楼女浴室现在开放吗
```

Observed supervisor summary:

- `selected_tool`: `service_status_lookup`
- `tool_business_outcome`: `resolved_current`
- `resolved_subject`: `静园10号楼负一层女浴室`
- `observed_status`: `limited_service`

Visible answer:

```text
静园10号楼负一层女浴室：当前状态：有限开放。 有效时间：4月16日 00:00 起。 提示：静园10号楼负一层女浴室目前已建成（见图1），将于本周四（4月16日）试运行。（来源：校内通知）
```

Visible source card:

- `校内通知 #355650`

This E2E smoke exposed and fixed three product-path gaps:

- natural bathroom prompt routing must classify `浴室` / `女浴室` as structured service subjects;
- app-api normalization must accept the supervisor direct structured result shape, not only wrapped tool payloads;
- app-api supervisor parsing must preserve structured observability fields such as `selected_tool` and `tool_business_outcome`.

## Verification

Passed:

```bash
uv run --all-packages python -m unittest \
  tests.evals.intent_synthetic_suite \
  tests.ingestion.test_notice_derived_service_status_materialization \
  tests.ingestion.test_build_service_status_projection_worker \
  tests.ingestion.test_structured_projection_postgres \
  tests.agent.test_campus_services_agent
```

Passed:

```bash
go test ./internal/runtimepolicy ./internal/structuredplanning ./internal/structuredquery ./internal/httpapi
```

Run from `apps/supervisor-api`.

Passed:

```bash
pnpm --dir apps/app-api test:node -- chat-command.service.core.structured.suite.ts supervisor-adapter.response.suite.ts
```

Passed:

```bash
pnpm docs:lint \
  .planning/workstreams/authenticated-notice-service-status-consumption \
  .planning/WORKSTREAMS.md
```

Passed after formatting `tests/agent/test_campus_services_agent.py`:

```bash
uv run --all-packages ruff check \
  packages/campus-services-agent/src/campus_services_agent/tool_adapter.py \
  tests/agent/test_campus_services_agent.py \
  packages/ingestion-core/src/campus_ingestion_core/notice_derived_service_status_materialization.py \
  tests/ingestion/test_notice_derived_service_status_materialization.py \
  tests/ingestion/test_build_service_status_projection_worker.py \
  tests/ingestion/test_structured_projection_postgres.py \
  tests/evals/intent_synthetic_suite.py
uv run --all-packages ruff format --check \
  packages/campus-services-agent/src/campus_services_agent/tool_adapter.py \
  tests/agent/test_campus_services_agent.py \
  packages/ingestion-core/src/campus_ingestion_core/notice_derived_service_status_materialization.py \
  tests/ingestion/test_notice_derived_service_status_materialization.py \
  tests/ingestion/test_build_service_status_projection_worker.py \
  tests/ingestion/test_structured_projection_postgres.py \
  tests/evals/intent_synthetic_suite.py
```

Additional targeted sanity passed:

```bash
uv run --all-packages python -m unittest \
  tests.agent.test_campus_services_agent.CampusServicesAgentTest.test_service_status_response_renders_open_ended_effective_window \
  tests.agent.test_campus_services_agent.CampusServicesAgentTest.test_service_status_payload_routes_through_internal_query_service
```

Latest observed output:

- App API node suite: `57 passed`, `324 passed`
- Python service-status/eval suite: `53 tests`, `OK`
- Go runtimepolicy/structuredplanning/structuredquery/httpapi: all packages `ok`
- docs lint: `0 error(s)`
- Ruff: `All checks passed!`, `7 files already formatted`
