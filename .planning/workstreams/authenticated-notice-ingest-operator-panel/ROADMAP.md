---
doc_type: roadmap
status: active
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Roadmap: Authenticated Notice Ingest Operator Panel

## Phase Status

- [x] **Phase 1: Operator Projection Contract Freeze** — define the app-api owned, operator-safe processing projection, status taxonomy, timeline model, and redaction contract.
- [x] **Phase 2: App API Projection Store And Query Endpoints** — add durable app-api storage, list/detail query services, operator routes, and contract tests.
- [x] **Phase 3: Ingestion Projection Emitter** — emit sanitized processing snapshots from queue consumer/downstream materialization or a repo-owned worker command into app-api.
- [ ] **Phase 4: Historical Backfill And Reconciliation** — backfill existing processed notices such as `355867`, reconcile current release/read-model state, and detect stale or conflicting attempts.
- [x] **Phase 5: Protected Panel List And Detail UI** — add panel resources/pages for authenticated notice processing status with lifecycle timeline and downstream readiness cards.
- [ ] **Phase 6: End-To-End Acceptance And Real Notice Smoke** — verify `355867` and at least one non-schedule notice through app-api and panel-visible projection.
- [ ] **Phase 7: Operational Hardening And Closeout** — add freshness checks, runbook, observability metrics, docs, and final verification.

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

Current status: not implemented. Existing historical content remains manually
replayable/queueable as planned; automatic historical projection reconstruction
requires a later command and real environment validation.

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

Current status: not completed. Requires a configured app-api DB/object-store and
selected real notice snapshot ingestion through the same path used by the panel.

## Phase 7: Operational Hardening And Closeout

Goal: make the operator view maintainable after first release.

Deliverables:

- Freshness/staleness policy and status labels.
- Metrics or audit events for projection ingest failures.
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
