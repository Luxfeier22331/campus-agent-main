---
doc_type: contract
truth_scope: ops
owner_boundary: apps/app-api
status: active
created: 2026-03-29
updated: 2026-07-05
---
# App API Official Web Contract

## Boundary

This document freezes the `apps/app-api` HTTP seam for `official_web` operator
and projection surfaces. Collector run lifecycle commands are owned by
`apps/ingestion-control`; app-api must not expose collector write endpoints.

Related owner docs:

- Control-plane architecture: `docs/architecture/domains/official-web/architecture.md`
- Logical schema: `docs/data/app-api/official-web.md`
- Browser/product HTTP index: `docs/contracts/app-api/README.md`

This document does not freeze object storage upload signing, collector image /
deploy YAML, Operator Console route mounting, ingestion execution internals or
the rollout posture of `fresh_news` and historical-news/archive surfaces.

## Shared Rules

- JSON body uses `camelCase`.
- Timestamps use ISO 8601 UTC strings.
- Enum/code values use lowercase semantic values such as `running`,
  `completed_with_errors` and `ingestion_failed`.
- All error responses use `docs/contracts/app-api/error.md`.
- The contract freezes forward HTTP seams. Current implemented subsets are
  verified against code, `docs/architecture/current.md` and the official-web
  architecture doc.

## Authentication

Operator query endpoints:

- Reuse shared `app-api` operator principal admission.
- Are consumed through Operator Console / `operator-console-web`.

Internal projection ingest:

- Requires internal shared-secret admission.
- Is producer-facing, not browser-facing.

## Endpoint Summary

Internal projection ingest endpoint:

- `POST /api/internal/operator/official-web/release-task-snapshots`

Operator query endpoints:

- `GET /api/operator/official-web/sites`
- `GET /api/operator/official-web/sites/:siteId`
- `GET /api/operator/official-web/runs`
- `GET /api/operator/official-web/runs/:runId`
- `GET /api/operator/official-web/target-inventory`
- `GET /api/operator/official-web/target-inventory/:inventoryId`
- `POST /api/operator/official-web/target-inventory/:inventoryId/release-gates`
- `GET /api/operator/official-web/target-release-gates/:releaseId`
- `GET /api/operator/official-web/release-tasks`
- `GET /api/operator/official-web/release-tasks/:id`

Removed ingestion executor surfaces must return `404`:

- `GET /api/internal/official-web/target-release-gates/:releaseId`
- `POST /api/internal/official-web/target-release-gates/:releaseId/execution-status`
- `POST /api/internal/official-web/target-inventory/:inventoryId/selected-write-admissions:evaluate`
- `GET /api/operator/official-web/target-selected-write-admissions/:selectedWriteId`
- `POST /api/operator/official-web/target-selected-write-admissions/:selectedWriteId/interventions`
- `GET /api/internal/official-web/target-selected-write-tasks/:selectedWriteId`
- `POST /api/internal/official-web/target-selected-write-tasks/:selectedWriteId/execution-status`
- `POST /api/official-web/runs`
- `POST /api/official-web/plans:resolve`
- `POST /api/official-web/runs/:runId/heartbeats`
- `POST /api/official-web/runs/:runId/finalize`

Release task claim / retry / executor progress / publish status belongs to
`apps/ingestion-control` plus TS `packages/ingest-core`. App-api only exposes
already-ingested official-web projections and the operator command ledger needed
to record stable-reference approve/reject decisions.

## Crawl Run Lifecycle Boundary

The long-term lifecycle is:

1. Collector start admission.
1. `ingestion-control` writes the durable crawl-run accepted fact.
1. Collector uploads object-storage artifacts and sends heartbeats.
1. Collector finalizes; `ingestion-control` writes terminal state and artifact
   refs.
1. `ingestion-control` admits `source_truth_materialize` from the run-level
   `source_truth_bundle` artifact ref.
1. `apps/ingestion-control` claims the admitted task and starts offline
   execution.
1. Operator reads site/run/detail state through app-owned projections.

Fixed lifecycle rules:

- Crawl run truth enters the ingestion-control official-web ledger before
  ingestion task admission.
- Object storage artifacts and the app-owned run ledger jointly form
  control-plane truth.
- Ingestion task admission can happen only after terminal finalize.
- Operator surfaces must not recover run status by scanning object storage or
  logs.
- Crawl status and ingestion status are separate facts.
- `completed` / `completed_with_errors` only describe crawl finalize, not
  chunking, indexing or publish completion.

Allowed `official_web.crawl_runs.status` values:

| Status | Meaning |
| --- | --- |
| `accepted` | Start request was durably accepted and `runId` was assigned |
| `running` | Collector is active and heartbeat is within the accepted window |
| `completed` | Crawl finalized with no run-level failures |
| `completed_with_errors` | Crawl finalized with URL / host / parser failures |
| `failed` | Crawl could not complete or finalized as failure |
| `abandoned` | App-api marked the run inactive after heartbeat timeout |

Ingestion execution may use `pending -> running -> staged -> promoted/failed`.
`staged` means replay / validator / chunk audit is done, but registry current
truth has not been explicitly promoted.

### Idempotency And Failure Boundary

Start idempotency scope is `siteId + schedulerRunKey + runIntent`.

- Matching payload fingerprint returns the existing `runId`.
- Conflicting payload fingerprint returns `409 idempotency_conflict`.

Finalize idempotency:

- Same terminal payload returns existing terminal state.
- Conflicting terminal payload returns `409 run_already_finalized`.

Heartbeat ordering:

- `sequence` must monotonically increase for each `runId`.
- Older heartbeats may be discarded or rejected.

Failure boundary:

- Pre-accept failure creates no durable run truth.
- Crawl terminal failure has run truth, but ends as `failed`.
- Downstream ingestion failure happens after crawl completion and task
  admission.

`accepted` or `running` runs can be marked `abandoned` after the declared
heartbeat threshold. `abandoned` is ingestion-control control-plane state, does
not require artifact deletion and must not be silently overwritten by a late
finalize.

Collector commands live under:

- `POST /internal/ingestion/official-web/runs`
- `POST /internal/ingestion/official-web/plans:resolve`
- `POST /internal/ingestion/official-web/runs/:runId/heartbeats`
- `POST /internal/ingestion/official-web/runs/:runId/finalize`

Those endpoints require `Authorization: Bearer
<INGESTION_CONTROL_OFFICIAL_WEB_COLLECTOR_TOKEN>` and are documented in
`docs/architecture/domains/official-web/architecture.md` and
`docs/runbooks/ingestion-control-clean-target.md`.

## Internal Projection Ingest

### `POST /api/internal/operator/official-web/release-task-snapshots`

Accepts redacted release task projection snapshots from
`apps/ingestion-control` and upserts:

- `operator.official_web_release_task_projection`
- `operator.official_web_release_task_event_projection`

Snapshot fields include:

- `schemaVersion`
- `taskId`
- `taskType`
- `sourceChannel`
- `inventoryId`
- `jobId`
- `runId`
- `selectedWriteTarget`
- `lifecycleStatus`
- `latestStage`
- `attemptCount`
- `maxAttempts`
- `inputSummary`
- `outputSummary`
- `timeline`
- `lastErrorCode`
- `lastErrorMessage`
- `createdAt`
- `updatedAt`
- `projectedAt`
- `producerVersion`
- `redactionVersion`

Rules:

- This endpoint is not a release task executor callback and does not mutate task
  truth.
- `taskId` is the snapshot idempotency key.
- Timeline events use `eventId` or deterministic event identity for idempotent
  writes.
- Payload must not contain object bucket/key, raw HTML, raw body, credentials,
  stack traces or local paths.
- App-api stores redacted summary and timeline only, not release task
  input/output truth.
- Selected-write `outputSummary` uses two-track summary semantics:
  `recordCount` / `taskScopeDisplayNames` describe task-scope writes, while
  `fullRecordCount` / `fullImpactDisplayNames` describe current full impact
  after projection merge.
- Panel displays ingestion-projected summaries and does not infer task-scope or
  full-impact semantics itself.

## Operator Queries

### `GET /api/operator/official-web/sites`

Returns site summaries for the Official Web / Sites view.

Each site summary includes:

- `siteId`
- `displayName`
- `latestRunId`
- `latestRunStatus`
- `lastSuccessAt`
- `lastFailureAt`
- `latestConfigVersion`
- `latestSourceAdapterVersion`
- `latestIngestionDispatchStatus`

### `GET /api/operator/official-web/sites/:siteId`

Returns a single-site summary, freshness backlog, freshness summary, recent runs
and recent page changes.

The response shape is:

- `site`
- `freshnessBacklog`
- `freshnessSummary`
- `recentRuns`
- `recentPageChanges`

Backlog groups include due pages, hot pages, failed fetch pages and deleted
pages.

### `GET /api/operator/official-web/runs`

Returns crawl run summaries.

Supported first-version filters:

- `siteId`
- `runIntent`
- `status`
- `ingestionDispatchStatus`
- `startedAfter`
- `startedBefore`
- `limit`
- `cursor`

Each run includes at least `runIntent`, `status`, `ingestionDispatchStatus`,
`failureCount`, `summary` and `artifacts`.

### `GET /api/operator/official-web/runs/:runId`

Returns run detail as `run + pageChangeSummary + pageChanges`.

Rules:

- Panel does not need to stitch multiple read surfaces for run detail.
- `pageChanges` shows `new / changed / deleted / fetch_failed`.
- `not_modified` stays in summary and freshness truth, not recent change lists.

### `POST /api/operator/official-web/target-inventory/:inventoryId/release-gates`

Records approve/reject release gate commands for
`official_web/stable_reference` previewed target inventory rows.

Minimum request fields:

- `decision`: `approved` or `rejected`
- `publishAlias`
- `notes`

Rules:

- Operator principal only.
- `approved` requires complete preview lineage, `staged` ingestion status, empty
  current truth import and all required fields present.
- `publishAlias` defaults to `false`.
- Approval returns the deterministic `releaseId` consumed by ingestion-control
  release tasks.

### `GET /api/operator/official-web/release-tasks`

Returns operator projections for selected-write / stable-reference release task
progress.

Supported first-version filters:

- `taskType`
- `status`
- `selectedWriteTarget`
- `inventoryId`
- `jobId`
- `runId`
- `q`
- `updatedAfter`
- `updatedBefore`
- `limit`
- `cursor`

Each task includes:

- `taskId`
- `taskType`
- `sourceChannel`
- `inventoryId`
- `jobId`
- `runId`
- `selectedWriteTarget`
- `lifecycleStatus`
- `latestStage`
- `attemptCount`
- `maxAttempts`
- `inputSummary`
- `outputSummary`
- `timeline`
- `freshnessStatus`

For selected-write tasks, `outputSummary` may include `releaseId`, `corpus`,
`collection`, `recordCount`, `fullRecordCount`, `taskScopeDisplayNames` and
`fullImpactDisplayNames`.

### `GET /api/operator/official-web/release-tasks/:id`

Returns a single release task projection detail.

Rules:

- Operator principal only.
- `:id` is `taskId`.
- Detail returns redacted summary, timeline, error summary and freshness summary.
- `404 official_web_release_task_not_found` means app-api has not received the
  projection.

## Non-Goals

- No object storage browser or proxy/download API.
- No collector artifact upload signing protocol.
- No collector-side cancel / resume API in the first version.
- No general operator write API. Stable-reference release gates are the explicit
  controlled exception.
- No selected-write admission/task/intervention routes in app-api.
- No ingestion-control reverse ownership of crawl-run lifecycle truth.
