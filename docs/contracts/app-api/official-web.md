---
doc_type: contract
truth_scope: ops
owner_boundary: apps/app-api
status: active
created: 2026-03-29
updated: 2026-06-29
---
# App API Official Web Contract

## Boundary

This document freezes the `apps/app-api` HTTP seam for the `official_web`
control plane. It is the single owner contract for collector commands, crawl
run lifecycle, internal operator projection ingest and operator query APIs.

Related owner docs:

- Control-plane architecture: `docs/architecture/domains/official-web/architecture.md`
- Logical schema: `docs/data/app-api/official-web.md`
- Browser/product HTTP index: `docs/contracts/app-api/README.md`

This document does not freeze object storage upload signing, collector image /
deploy YAML, Operator Console route mounting, ingestion execution internals or
the rollout posture of `fresh_news` / `news_archive`.

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

Collector command endpoints:

- Require machine-to-machine service credentials.
- Accept `Authorization: Bearer <service-token-or-equivalent>`.
- May additionally carry `x-trace-id`.
- Machine ingress protection such as Cloudflare Access, Tunnel or private
  network policy does not replace the app-level bearer credential.

Operator query endpoints:

- Reuse shared `app-api` operator principal admission.
- Are consumed through Operator Console / `operator-console-web`.

Internal projection ingest:

- Requires internal shared-secret admission.
- Is producer-facing, not browser-facing.

## Endpoint Summary

Collector command endpoints:

- `POST /api/official-web/runs`
- `POST /api/official-web/plans:resolve`
- `POST /api/official-web/runs/:runId/heartbeats`
- `POST /api/official-web/runs/:runId/finalize`

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

Release task claim / retry / executor progress / publish status belongs to
`apps/ingestion-control` plus `packages/ingestion-core`. App-api only exposes
already-ingested official-web projections and the operator command ledger needed
to record stable-reference approve/reject decisions.

## Crawl Run Lifecycle

The long-term lifecycle is:

1. Collector start admission.
1. `app-api` writes the durable crawl-run accepted fact.
1. Collector uploads object-storage artifacts and sends heartbeats.
1. Collector finalizes; `app-api` writes terminal state and artifact refs.
1. `app-api` admits an ingestion-control `source_truth_materialize` task from
   the run-level `source_truth_bundle` artifact ref.
1. `apps/ingestion-control` claims the admitted task and starts offline
   execution.
1. Operator reads site/run/detail state through app-owned projections.

Fixed lifecycle rules:

- Crawl run truth enters the `app-api` durable ledger before ingestion task
  admission.
- Object storage artifacts and the app-owned run ledger jointly form
  control-plane truth.
- Ingestion task admission can happen only after terminal finalize.
- Operator surfaces must not recover run status by scanning object storage,
  logs or ingestion-control internals.
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
heartbeat threshold. `abandoned` is app-owned control-plane state, does not
require artifact deletion and must not be silently overwritten by a late
finalize.

## Collector Commands

### `POST /api/official-web/runs`

Creates a canonical `runId` and writes the first durable run fact.

Minimum request fields:

- `siteId`
- `schedulerRunKey`
- `runIntent`
- `triggerType`
- `collectorVersion`
- `configVersion`
- `crawlPolicyVersion`
- `hostSet`
- `seedSet`
- `startedAt`

Success response returns `run.runId`, `siteId`, `status=accepted`,
`startedAt` and `heartbeatIntervalSeconds`.

Rules:

- `app-api` performs service principal admission, `siteId` validation,
  idempotency check and canonical `runId` allocation.
- On failure, app-api returns an HTTP error and does not create crawl-run truth.
- The first commit writes at least `official_web.crawl_runs` and a lifecycle
  outbox/event row.

### `POST /api/official-web/plans:resolve`

Resolves the lane-aware dynamic workset from `official_web.page_freshness`.
Collectors call this after start admission and before materializing a frontier.

Minimum request fields:

- `siteId`
- `runIntent`
- optional `hostFilter`
- optional `maxPagesPerHost`
- optional `maxTotalPages`
- `now`

Rules:

- `baseline` primarily returns due `baseline_static` pages.
- `hot` primarily returns due `listing_hot` and `detail_recent` pages.
- `repair` primarily returns pages whose last fetch disposition was
  `fetch_failed`.
- Deleted pages do not re-enter planner worksets unless rediscovered and
  written back to freshness truth.
- Budget hints do not change `page_freshness` ownership.

### `POST /api/official-web/runs/:runId/heartbeats`

Updates run liveness and process summary.

Minimum request fields:

- `sequence`
- `observedAt`
- `counts.urlsDiscovered`
- `counts.urlsFetched`
- `counts.pagesNormalized`
- `counts.artifactUploads`
- `counts.failures`

Rules:

- Updates `lastHeartbeatAt`.
- May advance `accepted -> running`.
- May write process counters.
- Does not replace terminal finalize.

### `POST /api/official-web/runs/:runId/finalize`

Submits terminal summary, page observations and artifact refs. Ingestion-control
task admission is derived by app-api from terminal outbox processing and the
registered `source_truth_bundle` artifact.

Minimum request fields:

- `terminalStatus`: `completed`, `completed_with_errors` or `failed`
- `finishedAt`
- `pageObservations[]`
- `summary`
- `artifacts[]`

Rules:

- Finalize is terminal. A different terminal payload for the same `runId` is a
  conflict.
- `completed` is allowed only when run-level summary has no failures.
- `completed_with_errors` is allowed when artifacts exist and URL / host /
  parser failures occurred.
- `pageObservations` are part of the finalize commit. App-api advances
  `page_freshness` and `page_observations` truth from them.
- App-api computes `new / changed / deleted / not_modified / fetch_failed`.
- Ingestion task admission uses the run-level `source_truth_bundle`; page
  change status remains app-api freshness/operator truth and does not create a
  separate official-web handoff payload.
- `not_modified` and `fetch_failed` update freshness truth, operator summary and
  repair cadence but do not produce ingestion page-change work.
- `artifacts` register object-storage refs only; they do not inline artifact
  contents.

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
- `latestCollectorVersion`
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
