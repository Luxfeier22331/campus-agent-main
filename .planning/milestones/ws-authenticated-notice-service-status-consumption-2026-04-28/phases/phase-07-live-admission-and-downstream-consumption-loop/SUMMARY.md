---
doc_type: summary
status: completed
created: 2026-04-28
updated: 2026-04-28
---
# Phase 7 Summary: Live Admission And Downstream Consumption Loop

<!-- markdownlint-disable MD013 -->

## Completed

- Proved live notice `355650` traverses authenticated notice source truth,
  `notice_consumption_projection`, service-status typed projection, PostgreSQL
  release/current read model, supervisor `service_status_lookup`, app-api
  `ChatCommandService` and public-chat visible answer normalization.
- Captured boundary evidence that `355867` remains schedule/transport-owned and
  is rejected from service-status materialization.
- Captured full app-api -> supervisor HTTP E2E evidence for prompt
  `静园10号楼女浴室现在开放吗`.
- Recorded that this workstream remains active pending review/commit and
  explicit archive decision; it is not silently archived.

## Evidence

- `../../evidence/phase-07-live-admission-loop/README.md`
- `../../evidence/phase-07-live-admission-loop/live-355650-facility-trial/app-api-to-supervisor-public-chat-e2e.json`
- `../../evidence/phase-07-live-admission-loop/live-355650-facility-trial/supervisor-service-status-lookup.json`
- `../../evidence/phase-07-live-admission-loop/live-355650-facility-trial/app-api-public-chat-service-status-smoke.json`

## Verification

```bash
uv run --all-packages python -m unittest \
  tests.evals.intent_synthetic_suite \
  tests.agent.test_campus_services_agent \
  tests.ingestion.test_notice_derived_service_status_materialization \
  tests.ingestion.test_build_service_status_projection_worker \
  tests.ingestion.test_structured_projection_postgres
```

Result: `53` tests passed.

```bash
go test ./internal/runtimepolicy ./internal/structuredplanning ./internal/structuredquery ./internal/httpapi
```

Run from `apps/supervisor-api`; all listed packages passed.

```bash
pnpm --dir apps/app-api test:node -- chat-command.service.core.structured.suite.ts supervisor-adapter.response.suite.ts
```

Result: `57` test files and `324` tests passed.

```bash
pnpm docs:lint \
  .planning/workstreams/authenticated-notice-service-status-consumption \
  .planning/WORKSTREAMS.md
```

Result: `0 error(s)`.

## Next Active Scope

- Future expansion is service-status only: IT platform, library,
  service-counter or facility status live notices.
- Do not merge regulation, schedule, service guide, contact-directory or generic
  notice-query work into this workstream.
