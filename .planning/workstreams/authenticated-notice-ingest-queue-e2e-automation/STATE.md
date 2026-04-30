---
workstream: authenticated-notice-ingest-queue-e2e-automation
created: 2026-05-01
updated: 2026-05-01
---

# Project State

<!-- markdownlint-disable MD013 -->

## Current Position

**Status:** Active
**Current Phase:** Phase 2 next
**Last Activity:** 2026-05-01
**Last Activity Description:** Completed Phase 1 queue contract and lifecycle freeze.

## Progress

**Phases Complete:** 1
**Current Plan:** `ROADMAP.md`

## Baseline Code Facts

- `notice_ingest` queue contract and Postgres/in-memory stores already exist for collected notice replay.
- `authenticated_notice_ingest_job.v1` now exists as the run-level authenticated notice queue payload.
- Existing queue lifecycle supports queued, leased, succeeded, retryable failure, terminal failure, dead-letter, manual review, blocked, and cancelled.
- Retryable failure now uses `failed_retryable` plus `next_retry_after` instead of immediate hot-loop requeue.
- Historical enqueue can project source-truth candidates to notice ingest jobs.
- Queue consumer can lease jobs and project them into source-truth/searchable evidence.
- Authenticated notice `run_id` ledger resolver already requires `status=success` and `verification_status=verified`.
- On-demand closeout runner can chain closeout worker, optional media source-object verification, strict media audit, and promotion when artifact paths are provided.
- Strict media audit and destructive cleanup guards were recently hardened, but they are not yet consumer-owned automatic lifecycle stages.

## Current Gaps

- Collector does not auto-enqueue after verified run ledger write.
- Historical/local-only collected content lacks one repair/synthetic ledger entrypoint before enqueue.
- Queue consumer does not execute the complete `run_id -> import -> media gate -> promotion -> downstream -> smoke` chain.
- Media gate artifacts are still manually threaded into on-demand closeout/promotion paths.
- Downstream materialization/read-model rebuild is not automatically triggered after promotion.
- Cleanup lifecycle is guarded but not integrated as an automatic stage.
- No unattended captured-content E2E smoke proves queue-to-downstream behavior with zero manual artifact stitching.

## Next Slice

Start Phase 2 by adding a manual historical enqueue / repair ledger entrypoint. The first implementation should accept an existing verified run ledger `run_id` and project it into `authenticated_notice_ingest_job.v1`; local-only artifacts must first be uploaded to source bucket and represented by a repair/synthetic ledger row before enqueue.

## Session Continuity

**Stopped At:** Phase 1 complete; Phase 2 manual historical enqueue / repair ledger is next.
**Resume File:** None
