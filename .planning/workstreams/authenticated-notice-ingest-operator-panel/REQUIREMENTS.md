---
doc_type: requirements
status: active
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Requirements: Authenticated Notice Ingest Operator Panel

## Goals

- Provide a protected-panel view for authenticated notice processing status.
- Let an operator answer, by notice id or title, whether the notice was
  collected, enqueued, consumed, admitted to a downstream target, materialized,
  promoted to current, and made available to the relevant tool/read model.
- Use `apps/app-api` as the owned operator-safe projection boundary.
- Preserve existing ingestion architecture: queue/source-handoff/object-store
  evidence remains internal ingestion truth, not panel truth.
- Support historical/current status backfill for already processed notices such
  as `355867`.

## Functional Requirements

- Projection records must be keyed by stable identities:
  `source_channel`, `source_surface`, `site_id`, `notice_id`, `run_id`, and
  optional `job_id`.
- A notice detail view must include:
  lifecycle status, latest stage, latest run id, latest queue job id, enqueue
  source, replay batch id, queue terminal status, attempt count, last error
  code/message, and updated timestamps.
- A notice detail view must include sanitized child task summaries:
  task kind, state, processor profile, severity, reason code, retry posture,
  and counts by state/kind.
- A notice detail view must include downstream status:
  target surface, candidate kind, materialization status, release id, current
  flag, read-model counts, validation status, and tool readiness.
- Schedule notices must expose operator-safe schedule facts:
  release id, current pointer status, snapshot count, route count,
  scheduled departure count, rejected source count, and a boolean indicating
  whether `transport_schedule_lookup` can consume the current read model.
- List views must support filters for notice id/title, status, target surface,
  candidate kind, queue status, run id, replay batch id, and time range.
- Detail views must show a timeline assembled from sanitized projection events,
  not raw logs.
- Internal ingest/update must be idempotent by event/snapshot identity.
- Projection freshness must be visible: last observed at, source update time,
  stale/stalled detection, and producer version.
- The projection must support already-processed historical runs through a
  backfill/reconcile command.
- App API endpoints must require operator access and must follow the existing
  app-api error envelope and same-site panel contract.
- Protected panel UI must use existing data-provider conventions and Chinese
  operator-facing labels.

## Redaction And Safety Requirements

- Do not expose raw notice body text, raw HTML, OCR text, OCR tables,
  attachment bytes, cookies, credentials, local file paths, or object-store
  presigned/internal URLs.
- Do not expose object-store bucket/key details unless explicitly normalized as
  operator-safe artifact identifiers. First release should prefer stable
  release/job ids over object keys.
- Do not expose raw operations directory paths in panel APIs.
- Do not expose raw stack traces. Store and show normalized error code/message
  with a compact reason.
- Do not let app-api/panel mutate ingestion queue state in this workstream.

## Non-Goals

- No retry/cancel/re-enqueue UI.
- No new scheduler.
- No direct panel-to-ingestion database reads.
- No direct panel-to-object-store reads.
- No replacement of existing queue/source-handoff/downstream contracts.
- No expansion of public query-serving surfaces.
- No display of restricted notice content.

## Success Criteria

- An operator can search `355867` and see that it reached
  `transport_schedule` materialization and `transport_schedule_lookup`
  readiness with `scheduled_departures=49` and `rejected_sources=0`.
- The panel can distinguish historical failed/manual-review attempts from the
  current successful processing result.
- App API owns a repeatable projection schema and query service for this domain.
- Ingestion worker or reconciler can upsert projection snapshots without raw
  content leakage.
- Backfill can populate current status for existing processed notices without
  mutating source truth or queue state.
- Tests prove the projection redacts forbidden fields and does not require panel
  access to queue/object-store internals.

## Required Verification Lanes

- App API route/service/store tests for list/detail/filter behavior.
- App API redaction tests for forbidden raw fields.
- Ingestion worker projection emitter/reconciler tests.
- Protected panel data-provider tests for new resources/endpoints.
- Protected panel page/component tests for list/detail/timeline rendering.
- Real-data smoke for notice `355867` proving the panel projection reports
  schedule downstream readiness.
- `pnpm web:lint`
- `pnpm web:typecheck`
- `pnpm web:test`
- Targeted Python tests for ingestion projection emitter/reconciler.
- `pnpm docs:lint`
- `git diff --check`
