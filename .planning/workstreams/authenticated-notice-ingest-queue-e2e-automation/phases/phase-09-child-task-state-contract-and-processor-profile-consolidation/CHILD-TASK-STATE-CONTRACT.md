---
doc_type: contract
workstream: authenticated-notice-ingest-queue-e2e-automation
phase: 9
status: active
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Authenticated Notice Child Task State Contract

## Boundary

`authenticated_notice_child_task_state_contract.v1` describes consumer-owned
processing evidence below a run-level `authenticated_notice_ingest_job.v1`.

The parent queue job remains scheduling truth. Child tasks do not become source truth,
document truth, projection truth, read-model truth, or query-serving truth. They explain
how a verified collector run moved through import, media processing, target admission,
downstream materialization, cleanup, and smoke.

## Required Task Fields

- `schema_version`
- `task_id`
- `parent_job_id`
- `run_id`
- `task_kind`
- `processor_profile_id`
- `state`
- `reason_code`
- `attempt_ordinal`
- `severity`
- `source_unit_id`
- `media_ref_id`
- `target_id`
- `retry_budget`
- `next_retry_after`
- `input_refs`
- `output_refs`
- `progress_event_refs`

`input_refs` and `output_refs` may carry object keys, hashes, byte sizes, schema
versions, and artifact paths. They must not carry raw body text, raw HTML, OCR payload,
attachment bytes, local source paths, projection rows, or read-model rows.

## Task Kinds

- `source_unit_import`
- `media_candidate_evaluation`
- `ocr_table_extraction`
- `multimodal_enrichment`
- `fact_readiness_evaluation`
- `target_admission`
- `downstream_materialization`
- `cleanup_evaluation`
- `smoke_assertion`

## Lifecycle States

- `pending`
- `running`
- `completed`
- `skipped`
- `failed_retryable`
- `failed_terminal`
- `manual_review`
- `cancelled`

Severity mapping:

- `none`: `pending`, `running`, `completed`, `skipped`
- `low`: `cancelled`
- `medium`: `failed_retryable`, `manual_review`
- `high`: `failed_terminal`

## Processor Profiles

`authenticated_notice_processor_profile.v1` controls processor order and retry/resource
budgets.

Initial profiles:

- `text_notice`
- `image_schedule_notice`
- `attachment_owner_text_notice`
- `mixed_notice`

For `image_schedule_notice`, OCR/table extraction is the first processor. Generic
multimodal is only an explicit escalation lane for low-confidence OCR, missing table
rows, missing route/date context, semantic image-only content, or unsupported OCR media.

Notice `355867` is the regression fixture for image-carried shuttle schedule facts and
must select `image_schedule_notice`.

## Progress Events

`authenticated_notice_progress_event.v1` is append-only operator evidence for state
transitions.

Required fields:

- `event_id`
- `generated_at`
- `parent_job_id`
- `run_id`
- `child_task_id`
- `stage`
- `transition`
- `reason_code`
- `message`
- `input_refs`
- `output_refs`

Progress event messages must be operator-safe summaries. They must not expose raw notice
body, raw OCR text, prompt payloads, credentials, or attachment bytes.

## Parent Queue Derivation

A parent queue job may only move to `succeeded` when child task evidence supports the
requested lifecycle:

- source-truth-only consume: import child tasks completed and no medium-or-higher child
  finding remains.
- media-gated consume: media candidate evaluation completed with passed strict gate
  evidence.
- downstream materialization consume: target admission and downstream materialization
  child tasks completed with projection/read-model evidence.
- destructive cleanup: cleanup child task completed with fresh passed media gate evidence
  and matching candidate inventory hash.

Otherwise the parent job must remain retryable, terminal, manual-review, blocked, or
cancelled with an actionable reason code.
