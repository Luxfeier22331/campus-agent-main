---
workstream: authenticated-notice-ingest-queue-e2e-automation
created: 2026-05-01
updated: 2026-05-01
---

# Project State

<!-- markdownlint-disable MD013 -->

## Current Position

**Status:** Active
**Current Phase:** Phase 6 next
**Last Activity:** 2026-05-01
**Last Activity Description:** Completed Phase 5 consumer-owned media gate evidence manifest and strict audit gate integration.

## Progress

**Phases Complete:** 5
**Current Plan:** `ROADMAP.md`

## Baseline Code Facts

- `notice_ingest` queue contract and Postgres/in-memory stores already exist for collected notice replay.
- `authenticated_notice_ingest_job.v1` now exists as the run-level authenticated notice queue payload.
- Existing queue lifecycle supports queued, leased, succeeded, retryable failure, terminal failure, dead-letter, manual review, blocked, and cancelled.
- Queue lifecycle now includes explicit lease release so dry-run consumers do not leave work stuck in `leased`.
- Retryable failure now uses `failed_retryable` plus `next_retry_after` instead of immediate hot-loop requeue.
- Historical enqueue can project source-truth candidates to notice ingest jobs.
- Run-level authenticated notice queue consumer can lease `authenticated_notice_ingest` jobs, filter by `run_id`, verify collector run ledger object refs, verify source object hash/size, call object-native authenticated notice import, and map success/retryable/terminal/manual-review outcomes back to queue state.
- Consumer-owned media gate evidence manifest now validates candidate inventory, attempt ledger, closeout inventory, target admission manifest, cleanup dry-run, object verification report, and strict audit hashes under one operations directory.
- On-demand closeout can build media gate evidence after strict audit and before promotion.
- Legacy collected-notice queue consumer can lease jobs and project them into source-truth/searchable evidence.
- Authenticated notice `run_id` ledger resolver already requires `status=success` and `verification_status=verified`.
- On-demand closeout runner can chain closeout worker, optional media source-object verification, strict media audit, and promotion when artifact paths are provided.
- Strict media audit and destructive cleanup guards were recently hardened, but they are not yet consumer-owned automatic lifecycle stages.

## Current Gaps

- Local-only collected content still needs repair/synthetic ledger upload before enqueue.
- Downstream materialization/read-model rebuild is not automatically triggered after promotion.
- Cleanup lifecycle is guarded but not integrated as an automatic stage.
- No unattended captured-content E2E smoke proves queue-to-downstream behavior with zero manual artifact stitching.

## Next Slice

Start Phase 6 by making downstream materialization/read-model results explicit in queue consume trace and blocking silent success when downstream materialization was requested but produced no admitted projection/read-model evidence.

## Session Continuity

**Stopped At:** Phase 5 complete; Phase 6 downstream materialization/read-model result tracing is next. Local-only repair/synthetic ledger upload remains part of the broader Phase 2/Phase 8 smoke path if no verified ledger row exists.
**Resume File:** None
