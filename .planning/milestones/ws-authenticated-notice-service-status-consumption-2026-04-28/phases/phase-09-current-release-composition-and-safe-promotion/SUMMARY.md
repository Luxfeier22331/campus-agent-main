---
doc_type: summary
status: complete
created: 2026-04-28
updated: 2026-04-28
phase: Phase 9
workstream: authenticated-notice-service-status-consumption
---
# Phase 9 Summary: Current Release Composition And Safe Promotion

<!-- markdownlint-disable MD013 -->

## Outcome

Phase 9 is complete.

Implemented current-release composition for notice-derived service status:

- ready `campus_services/service_status_candidate` entries are filtered to
  `service_status_candidate_kind=service_status`;
- current release keeps only records whose effective window contains
  `generated_at`;
- historical candidates are retained as rejected-source evidence instead of
  silently disappearing;
- `stage` writes versioned artifact/read-model rows without moving current;
- promotion happens only after stage validation, with the same release id,
  current object artifact and PostgreSQL current pointer.

The promoted current release is `service-status-current-20260428T122000`.

## Current Truth

Current service-status records:

- `notice:muc_internal_portal:355650` ->
  `facility:bathroom:jingyuan-10`
- `notice:muc_internal_portal:354845` ->
  `service-counter:campus-hospital`

Historical candidates excluded from current truth:

- `247726`
- `352345`
- `354502`
- `354575`
- `354674`

Transport schedule candidates remain outside this service-status release.

## Code Changes

- Added `--current-release-composition` to
  `apps/ingestion-worker/src/campus_ingestion_worker/build_service_status_projection.py`.
- Added current-effective composition and rejected-source accounting.
- Added regression coverage in
  `tests/ingestion/test_build_service_status_projection_worker.py`.

## Evidence

Evidence root:

```text
.planning/workstreams/authenticated-notice-service-status-consumption/evidence/phase-09-current-release-composition-and-safe-promotion/
```

Key evidence:

- `current-candidate-audit.json`: 27 ready candidates; 7 service-status kind,
  20 transport-schedule kind.
- `service-status-current-stage/build-report.json`: 2 materialized current
  records, 5 rejected historical sources.
- `pg-current-after-stage.json`: current pointer stayed on previous Phase 7
  release after stage.
- `pg-current-after-promote.json`: current pointer moved to
  `service-status-current-20260428T122000`.
- `service-status-current-promote.stdout.json`: promote wrote the current
  object artifact for the same release id.
- `pg-current-read-model-smoke.json`: PG current read model contains both
  current records.
- `supervisor-service-status-multi-current-smoke.json`: supervisor internal
  `service_status_lookup` resolves both current records.
- `app-api-public-chat-multi-current-smoke.json`: app-api product answer path
  resolves both current records and hides internal locators.

## Verification

Passed:

```bash
uv run --all-packages python -m unittest \
  tests.ingestion.test_notice_derived_service_status_materialization \
  tests.ingestion.test_build_service_status_projection_worker \
  tests.ingestion.test_structured_projection_postgres \
  tests.agent.test_campus_services_agent
```

```bash
go test ./internal/runtimepolicy ./internal/structuredplanning ./internal/structuredquery ./internal/httpapi
```

Run from `apps/supervisor-api`.

```bash
pnpm --dir apps/app-api exec vitest run -c vitest.node.config.mts \
  test/chat-command.service.test.ts test/supervisor-adapter.test.ts
```

Also passed:

```bash
uv run --all-packages ruff check \
  apps/ingestion-worker/src/campus_ingestion_worker/build_service_status_projection.py \
  tests/ingestion/test_build_service_status_projection_worker.py
```

```bash
uv run --all-packages ruff format --check \
  apps/ingestion-worker/src/campus_ingestion_worker/build_service_status_projection.py \
  tests/ingestion/test_build_service_status_projection_worker.py
```

The original plan command
`pnpm --dir apps/app-api test:node -- chat-command.service.core.structured.suite.ts supervisor-adapter.response.suite.ts`
was attempted. In the current Vitest config those are suite module filenames,
not included `*.test.ts` files, so the broader node lane ran and failed on an
unrelated `official-web-local-projection-drain.test.ts` timeout.

## Resume Point

The service-status workstream should remain active until the user explicitly
archives it. There is no remaining Phase 9 implementation blocker.
