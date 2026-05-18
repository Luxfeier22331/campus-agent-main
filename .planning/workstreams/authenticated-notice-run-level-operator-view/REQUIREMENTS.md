---
doc_type: requirements
status: completed
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Requirements: Authenticated Notice Run-Level Operator View

## Goals

- Provide a read-only protected-panel resource for authenticated notice
  collector-run / queue-run processing status.
- Keep run-level truth separate from notice-level processing truth.
- Use `apps/app-api` as the browser-facing owner of sanitized run processing
  projection records.
- Support historical backfill from retained queue records and queue-consumer
  trace evidence without mutating source truth or queue state.
- Preserve redaction: no raw notice body, HTML, OCR payload, attachment bytes,
  object-store locator, local path, credential or stack trace in app-api or panel
  responses.

## Functional Requirements

- Internal ingest accepts run processing snapshots at:
  `POST /api/internal/operator/authenticated-notices/run-processing-snapshots`.
- Operator list/detail APIs are:
  `GET /api/operator/authenticated-notices/run-processing` and
  `GET /api/operator/authenticated-notices/run-processing/:id`.
- Protected panel consumes only same-site proxied app-api endpoints under
  `/api/authenticated-notices/run-processing`.
- List filters include collector run token, run id, replay batch id, lifecycle
  status, latest queue status, source surface, site id, text query and updated
  window.
- Detail includes run identity, queue status counts, job summaries, source-truth
  summary, child-task rollup, downstream summary, freshness and timeline.
- `source_truth_only` collector runs must show import scale from
  `import_result.notice_count`, not zero just because no selected notice ids are
  present.
- Terminal run records are reported as fresh; active records become stale only
  by app-api query-time freshness policy.

## Non-Goals

- No direct panel read of queue/source-handoff/object-store/trace truth.
- No product scheduler, heartbeat dashboard or write/action control plane.
- No per-notice detail behavior change.
- No query-serving, document-site or downstream materialization policy change.

## Success Criteria

- Run token `20260428T181953007Z` can be projected as a run-level record with
  queue status `succeeded`, lifecycle status `succeeded`, imported notice count
  `282`, attachment fetch-status count `305`, and downstream status
  `skipped_source_truth_only`.
- App-api, ingestion-core, ingestion-worker and protected-panel focused tests
  cover the run-processing contract.
- Contract/schema/architecture/runbook docs describe the run-level seam and its
  separation from per-notice processing.
