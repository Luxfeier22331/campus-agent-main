---
doc_type: contract
status: active
created: 2026-04-29
updated: 2026-04-29
---

<!-- markdownlint-disable MD013 -->

# Notice Ingest Queue Contract

## Purpose

`notice_ingest` is the shared queue contract between captured source truth and
ingestion consumption.

It is used by:

- historical captured inventory backfill
- future live collector discovery
- manual replay

All three paths must enqueue the same job shape so ongoing collection and
historical replay do not diverge.

## Pipeline Boundary

Fixed path:

`collector discovery / historical inventory -> captured source objects + run ledger -> notice_ingest job -> ingestion worker -> source-truth / holding / searchable`

The job is not a downstream admission record. Regulation, transport schedule,
service status, OCR execution, and current promotion remain separate phases.

## Job Schema

Schema version: `notice_ingest_job.v1`

Required fields:

- `schema_version`
- `job_id`
- `job_kind`
- `source_channel`
- `source_surface`
- `source_identity`
- `capture_id`
- `capture_manifest_object_ref`
- `source_object_refs`
- `content_hash`
- `run_id`
- `enqueue_source`
- `replay_batch_id`
- `priority`
- `idempotency_key`

Fixed values:

- `job_kind=notice_ingest`
- `enqueue_source` is one of:
  - `historical_backfill`
  - `live_discovery`
  - `manual_replay`

## Object Reference Rule

Jobs carry object references, not large content.

Allowed:

- object bucket
- object key
- object role
- content sha256
- byte size

Forbidden in job payload:

- `body_text`
- `raw_html`
- `html`
- `attachments`
- `attachment_bytes`
- `ocr_payload`
- `content_blocks`

The consumer must dereference object storage and validate source-truth assets
inside the worker.

## Identity And Idempotency

Internal notice source identity:

`{site_id}:{source_notice_id}`

File release source identity:

`file_release:{file_release_id}`

Idempotency key:

`notice_ingest:{sha256(source_channel + source_surface + source_identity + content_hash)}`

The same source identity and content hash must produce the same idempotency key
across historical backfill, live discovery, and manual replay. A content hash
change represents a new content version and therefore a different ingest job.

## Queue State Machine

The queue store introduced in Phase 4.6 must use these states:

- `queued`
- `leased`
- `succeeded`
- `failed_retryable`
- `failed_terminal`
- `dead_letter`

Retrying a job does not change `idempotency_key`. Manual replay creates a new
`replay_batch_id`, but the content-version idempotency key remains stable.

## Fixtures

Fixture payloads:

- `fixtures/historical-backfill.notice-ingest-job.json`
- `fixtures/live-discovery.notice-ingest-job.json`
- `fixtures/manual-replay.notice-ingest-job.json`

Each fixture validates against
`campus_ingestion_core.collected_notice_ingest_queue.validate_notice_ingest_job_payload`.
