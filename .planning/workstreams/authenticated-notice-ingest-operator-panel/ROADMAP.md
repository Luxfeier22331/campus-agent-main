---
doc_type: roadmap
status: completed
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Roadmap: Authenticated Notice Ingest Operator Panel

## Phase Status

- [x] **Phase 1: Operator Projection Contract Freeze** — define the app-api owned, operator-safe processing projection, status taxonomy, timeline model, and redaction contract.
- [x] **Phase 2: App API Projection Store And Query Endpoints** — add durable app-api storage, list/detail query services, operator routes, and contract tests.
- [x] **Phase 3: Ingestion Projection Emitter** — emit sanitized processing snapshots from queue consumer/downstream materialization or a repo-owned worker command into app-api.
- [x] **Phase 4: Historical Backfill And Reconciliation** — backfill existing processed notices such as `355867`, reconcile current release/read-model state, and detect stale or conflicting attempts.
- [x] **Phase 5: Protected Panel List And Detail UI** — add panel resources/pages for authenticated notice processing status with lifecycle timeline and downstream readiness cards.
- [x] **Phase 6: End-To-End Acceptance And Real Notice Smoke** — verify `355867` and at least one non-schedule notice through app-api and panel-visible projection.
- [x] **Phase 7: Operational Hardening And Closeout** — add freshness checks, runbook, observability metrics, docs, and final verification.

## Phase 1: Operator Projection Contract Freeze

Goal: freeze the product and data contract before implementation so panel does
not grow into a raw ingestion console.

Deliverables:

- Projection record shape for authenticated notice processing.
- Status taxonomy for source collected, enqueued, leased/running, imported,
  media/ocr processed, target admitted, downstream materialized, current
  promoted, tool ready, manual review, failed, cancelled, and stale.
- Timeline event model with sanitized stage transitions.
- Downstream summary model for `transport_schedule`, `service_status`, and
  future admitted targets.
- Forbidden-field redaction contract.
- API contract draft for:
  `GET /api/operator/authenticated-notices/processing`
  and
  `GET /api/operator/authenticated-notices/processing/:noticeId`.
- Panel display contract for list/detail views.

Verification:

```bash
pnpm docs:lint
git diff --check
```

Current status: implemented in current worktree via
`docs/contracts/app-api-authenticated-notice-processing-http.md` and supporting
architecture/schema docs.

## Phase 2: App API Projection Store And Query Endpoints

Goal: make `apps/app-api` the durable read boundary consumed by protected panel.

Deliverables:

- DB schema/migration for authenticated notice processing projection.
- Store methods for idempotent upsert, list, detail, timeline, and status
  aggregation.
- Query service with operator principal checks.
- Routes under `/api/operator/authenticated-notices/...`.
- Contract normalization and error-envelope behavior aligned with existing
  app-api operator routes.
- Tests for filters, pagination, detail lookup, missing records, authorization,
  and redaction.

Verification:

```bash
pnpm web:typecheck
pnpm web:test -- --runInBand
```

Current status: implemented in current worktree with targeted app-api
route/store tests. The canonical table definitions are
`operator.authenticated_notice_processing_projection` and
`operator.authenticated_notice_processing_event_projection`.

## Phase 3: Ingestion Projection Emitter

Goal: publish sanitized processing snapshots from ingestion into app-api without
letting panel depend on ingestion internals.

Deliverables:

- Projection builder that consumes queue record, consume trace, child task
  summary, typed materialization report, and structured projection metadata.
- Internal app-api ingest endpoint or repo-owned drain command for projection
  snapshots.
- Idempotency key design for events/snapshots.
- Producer version and source timestamps.
- Redaction guard tests proving raw notice/OCR/object/local-path fields are
  rejected or stripped.
- Integration seam from authenticated notice queue consumer after terminal
  transition.

Verification:

```bash
uv run --all-packages python -m unittest tests.ingestion.<new_projection_emitter_tests>
pnpm web:test
git diff --check
```

Current status: implemented in current worktree through the ingestion-core
projection builder and ingestion-worker HTTP reporter. Historical backfill is
not included in this phase.

## Phase 4: Historical Backfill And Reconciliation

Goal: make existing already-processed notices visible without rerunning ingestion
or mutating source truth.

Deliverables:

- Backfill command that reads existing queue/source-handoff/downstream/release
  evidence and writes app-api projection snapshots.
- Reconciliation logic for multiple attempts:
  current successful attempt wins for effective status, historical failed or
  manual-review attempts remain visible in timeline.
- Current release/read-model reconciliation for `transport_schedule`.
- Real-data backfill proof for notice `355867`.
- Stale/conflict findings when queue status, current pointer, and read-model
  counts disagree.

Verification:

```bash
uv run --all-packages python -m unittest tests.ingestion.<new_backfill_tests>
pnpm web:test
```

Current status: implemented in current worktree via
`campus_ingestion_core.authenticated_notice_processing_projection_backfill` and
`campus_ingestion_worker.backfill_authenticated_notice_processing_projection`.
The command reconstructs app-api projection snapshots from retained queue record
payloads and consume traces without mutating queue/source truth. Real
environment execution remains part of Phase 6 acceptance.

## Phase 5: Protected Panel List And Detail UI

Goal: give operators a useful read-only view in protected panel.

Deliverables:

- New protected panel resource or route for authenticated notice processing.
- List page with filters for notice id/title, status, target surface,
  candidate kind, queue status, run id, replay batch id, and updated window.
- Detail page with:
  notice identity, latest status, queue card, child task summary, timeline,
  downstream materialization card, schedule readiness card, and historical
  attempts.
- Chinese operator copy and safe status labels.
- Data-provider methods and tests.
- Responsive layout for desktop and narrow viewport.

Verification:

```bash
pnpm web:lint
pnpm web:typecheck
pnpm web:test
```

Current status: implemented in current worktree with protected-panel resource,
proxy/data-provider, list/detail pages and UI regression coverage.

## Phase 6: End-To-End Acceptance And Real Notice Smoke

Goal: prove the feature answers the original operator question end to end.

Deliverables:

- App-api endpoint smoke showing `355867` status:
  downstream `transport_schedule`, current release, `scheduled_departures=49`,
  `rejected_sources=0`, and tool readiness true.
- Panel data-provider smoke for the same notice.
- Browser/manual or automated panel smoke showing the detail page renders the
  lifecycle without raw content leakage.
- At least one non-schedule authenticated notice sample to prove the UI is not
  hard-coded around `transport_schedule`.

Verification:

```bash
pnpm web:test:integration
pnpm web:build
```

Current status: completed. Selected real notice `355867` passed in the local
real Postgres/object-store path:

- queue job status: `succeeded`
- downstream materialization: `completed`
- app-api processing projection report: `reported`
- app-api operator detail: `lifecycleStatus=tool_ready`,
  `candidateKind=transport_schedule`, `targetSurface=campus_services`,
  `toolReady=true`, `scheduledDepartures=49`, `rejectedSources=0`,
  `freshnessStatus=fresh`

Evidence:

- `.planning/workstreams/authenticated-notice-ingest-operator-panel/evidence/phase-06-real-env-355867-20260501T060046Z/authenticated-notice-ingest-queue-e2e-smoke.json`
- `.planning/workstreams/authenticated-notice-ingest-operator-panel/evidence/phase-06-real-env-355867-20260501T060046Z/app-api-processing-355867.json`
- `.planning/workstreams/authenticated-notice-ingest-operator-panel/evidence/phase-06-real-env-355867-20260501T060046Z/consumer-admission-manifest.cli.json`

Non-schedule service-status notice `355650`
(`关于静园10号楼负一层女浴室试运行的通知`) also passed app-api internal
processing snapshot ingest and operator list/detail readback:

- `lifecycleStatus=tool_ready`
- `queueStatus=succeeded`
- `candidateKind=service_status`
- `targetSurface=campus_services`
- `toolReady=true`
- `serviceStatusRecords=1`
- `rejectedSources=0`

Evidence:

- `.planning/workstreams/authenticated-notice-ingest-operator-panel/evidence/phase-06-real-env-non-schedule-355650-20260501T235000Z/acceptance-summary.json`
- `.planning/workstreams/authenticated-notice-ingest-operator-panel/evidence/phase-06-real-env-non-schedule-355650-20260501T235000Z/app-api-processing-355650.json`
- `.planning/workstreams/authenticated-notice-ingest-operator-panel/evidence/phase-06-real-env-non-schedule-355650-20260501T235000Z/app-api-processing-list-service-status.json`

## Phase 7: Operational Hardening And Closeout

Goal: make the operator view maintainable after first release.

Deliverables:

- Freshness/staleness policy and status labels.
- Smoke findings for projection ingest failures, including blocked callback
  configuration.
- Runbook for backfill/reconcile, failure diagnosis, and known limitations.
- Documentation update for panel surface and app-api contract.
- Final verification evidence and workstream closeout.

Verification:

```bash
pnpm web:lint
pnpm web:typecheck
pnpm web:test
pnpm docs:lint
uv run --all-packages ruff check .
git diff --check
```

Current status: implemented in current worktree. Freshness is computed by
app-api query store and displayed by protected panel; runbook is
`docs/runbooks/authenticated-notice-processing-operator-panel-runbook.md`.
Repository-wide lint/commit remain intentionally outside this closeout.
