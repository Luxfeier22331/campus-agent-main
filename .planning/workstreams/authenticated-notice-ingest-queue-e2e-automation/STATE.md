---
workstream: authenticated-notice-ingest-queue-e2e-automation
created: 2026-05-01
updated: 2026-05-01
---

# Project State

<!-- markdownlint-disable MD013 -->

## Current Position

**Status:** Active
**Current Phase:** Verification
**Last Activity:** 2026-05-01
**Last Activity Description:** Completed Phase 8 harness and tightened remaining consumer-owned lifecycle gates.

## Progress

**Phases Complete:** 8
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
- Run-level consumer records downstream projection/read-model materialization evidence and prevents queue success when downstream materialization was requested but no projection/read-model evidence was returned.
- Run-level consumer now requires consumer admission manifest before downstream materialization instead of silently calling importer without target admission evidence.
- Run-level consumer records cleanup dry-run posture and blocks destructive cleanup unless fresh passed media gate evidence is present.
- Run-level consumer now resolves consumer-owned operations directories by `run_id/job_id/attempt` and persists media gate manifest/verdict there when strict gate evidence passes.
- Queue status reporting now exposes operator summary including retry-due count, expired leases, oldest pending age, manual-review reasons, blocked reasons, and dead-letter reasons.
- Captured-content smoke harness can dry-run verified ledger to queue plan and execute the same queue consumer path with optional media/downstream/cleanup gates.
- Legacy collected-notice queue consumer can lease jobs and project them into source-truth/searchable evidence.
- Authenticated notice `run_id` ledger resolver already requires `status=success` and `verification_status=verified`.
- On-demand closeout runner can chain closeout worker, optional media source-object verification, strict media audit, and promotion when artifact paths are provided.
- Strict media audit and destructive cleanup guards were recently hardened, but they are not yet consumer-owned automatic lifecycle stages.

## Current Gaps

- None in the current repair scope after operator decision.

## Deferred By Operator Decision

- Local-only collected content repair/synthetic ledger upload is not automated in this workstream; historical collected content will be manually enqueued later.
- Full live execute smoke still depends on real Postgres/object-store credentials and verified captured run rows and will be accepted later.

## Next Slice

Run verification for the consumer-owned lifecycle implementation and fix any medium-or-higher findings before closing the workstream.

## Session Continuity

**Stopped At:** Consumer-owned lifecycle hardening implemented; verification loop is next. Local-only historical enqueue and live infra acceptance are explicit deferred operator tasks.
**Resume File:** None
