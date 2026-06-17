---
doc_type: runbook
truth_scope: ops
owner_boundary: docs/runbooks
status: historical
created: 2026-05-01
updated: 2026-06-15
---
# Authenticated Notice Processing Operator Console Runbook

<!-- markdownlint-disable MD013 -->

## Scope

This runbook covers the read-only operator path:

`collector verified run -> ingest queue -> ingestion consumer -> app-api processing projection -> Operator Console`

It does not cover retry/cancel/re-enqueue actions. The Operator Console must only
read `app-api` operator-safe projection records.

## Required Environment

For execute smoke and projection reporting:

- `NOTICE_INGEST_QUEUE_OPERATOR_DATABASE_URL` or shared operator Postgres URL
- authenticated notice object-store endpoint and credentials used by
  `apps/ingestion-worker`
- `INGESTION_WORKER_APP_API_BASE_URL`
- `INGESTION_WORKER_APP_API_INTERNAL_SHARED_SECRET`
- matching `APP_API_INTERNAL_SHARED_SECRET` in `apps/app-api`

If the app-api projection callback variables are missing and the smoke is run
with `--require-processing-projection` or
`--require-run-processing-projection`, the smoke returns `verdict=blocked`
before mutating the ingest queue.

## Selected Notice Smoke

Use this lane for the known transport-schedule notice:

First build the current-schema consumer admission manifest from the verified
collector run. Do not reuse legacy `entries` manifests.

```bash
uv run --all-packages python -m campus_ingestion_worker.build_internal_notice_consumer_admission_manifest \
  --collector-run-id <collector-run-id> \
  --source-surface notice \
  --notice-id 355867 \
  --output-path var/ingestion-evidence/authenticated-notice-ingest-operator-console/355867-smoke/consumer-admission-manifest.json \
  --admission-run-id consumer-admission:<collector-run-id> \
  --selection-source operator_console_phase6_real_env \
  --selection-path <collector-run-id> \
  --site-id muc_internal_portal
```

```bash
uv run --all-packages python -m campus_ingestion_worker.enqueue_authenticated_notice_collector_run \
  --run-id <collector-run-id> \
  --site-id muc_internal_portal \
  --source-surface notice \
  --replay-batch-id authenticated-notice-operator-console:<collector-run-id> \
  --output-dir var/ingestion-evidence/authenticated-notice-ingest-operator-console/355867-smoke/enqueue \
  --execute
```

```bash
uv run --all-packages python -m campus_ingestion_worker.consume_authenticated_notice_ingest_queue \
  --run-id <collector-run-id> \
  --site-id muc_internal_portal \
  --source-home-url https://my.muc.edu.cn \
  --source-surface notice \
  --replay-batch-id authenticated-notice-operator-console:<collector-run-id> \
  --execute \
  --materialize-downstream \
  --consumer-admission-manifest-path var/ingestion-evidence/authenticated-notice-ingest-operator-console/355867-smoke/consumer-admission-manifest.json \
  --output-dir var/ingestion-evidence/authenticated-notice-ingest-operator-console/355867-smoke/consume
```

Passing evidence must show:

- queue job status is `succeeded`
- downstream materialization status is `completed`
- processing projection report status is `reported`
- run-processing projection report status is `reported`
- `consume/authenticated-notice-run-queue-consume.json` contains no failed
  terminal outcome for the selected run

## Historical Backfill

Historical backfill reconstructs app-api projection snapshots from existing
queue records and consume traces. It does not mutate queue rows or source truth.

```bash
uv run --all-packages python -m campus_ingestion_worker.backfill_authenticated_notice_processing_projection \
  --queue-records-path <queue-records.json> \
  --trace-path <authenticated-notice-run-queue-consume.trace.json> \
  --notice-id 355867 \
  --output-path var/ingestion-evidence/authenticated-notice-ingest-operator-console/backfill-355867.json
```

`queue-records.json` may be either a list of persisted
`NoticeIngestQueueRecord.to_persisted_payload()` objects or an object containing
`records` / `queue_records`.

## Run-Level Historical Backfill

Use this lane when the operator question is about a collector run or queue run
as a whole, not about a single notice id.

```bash
uv run --all-packages python -m campus_ingestion_worker.backfill_authenticated_notice_run_processing_projection \
  --queue-records-path <queue-records.json> \
  --trace-path <authenticated-notice-run-queue-consume.trace.json> \
  --collector-run-token 20260428T181953007Z \
  --output-path var/ingestion-evidence/authenticated-notice-run-level-operator-view/run-backfill-20260428T181953007Z.json
```

Expected real sample posture for collector run token `20260428T181953007Z`:

- queue terminal state: `succeeded`
- lifecycle status: `succeeded`
- source-truth-only downstream status: `skipped_source_truth_only`
- imported notice count: `282`
- attachment fetch-status record count: `305`

Run-level backfill must not be used to create or overwrite notice-level
processing records. It writes only the app-api run-processing projection.

## Freshness Policy

Freshness is computed by `apps/app-api`, not by operator-console local time.

- terminal records such as `tool_ready`, `materialized`, `manual_review`,
  `failed_terminal`, `dead_letter`, `cancelled`, or queue `succeeded` are
  returned as `fresh`
- active processing records are `stale` when `lastObservedAt` is older than the
  app-api stale window
- missing `lastObservedAt` is `unknown`

Panel list/detail pages display the returned `freshnessStatus`,
`staleReasonCode`, `observedAgeSeconds`, and `staleAfterSeconds`.

## Diagnosis

If the panel does not show a notice:

- Query app-api directly:

```bash
curl -H "authorization: Bearer <operator-token>" \
  "<app-api>/api/operator/authenticated-notices/processing?noticeId=355867"
```

- If app-api has no record, check the smoke/backfill report for
  `processing_projection_report.status`.
- If the run-level panel has no record, check
  `run_processing_projection_report.status`.
- If the report is `blocked`, configure the app-api projection callback
  variables and rerun.
- If queue consume succeeded but projection reporting failed, retry only the
  backfill command from retained consume trace evidence.
- If queue consume fails with `unexpected keyword argument 'entries'`, the smoke
  used a legacy consumer admission file. Regenerate it with
  `campus_ingestion_worker.build_internal_notice_consumer_admission_manifest`
  using `--collector-run-id` and rerun with a new collector replay run id so the
  queue idempotency key is fresh.

## Redaction Guard

Do not add raw body, HTML, OCR text/tables/payload, attachment bytes, local
paths, object-store bucket/key, presigned URLs, credentials, cookies, or raw
stack traces to the snapshot payload or panel response.
