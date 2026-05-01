---
workstream: authenticated-notice-ingest-queue-e2e-automation
created: 2026-05-01
updated: 2026-05-01
---

# Project State

<!-- markdownlint-disable MD013 -->

## Current Position

**Status:** Completed
**Current Phase:** Final verification complete
**Last Activity:** 2026-05-01
**Last Activity Description:** Completed Phase 1 wrapper execute no-op guard; real wrapper re-run is waiting for a fresh verified run.

## Progress

**Phases Complete:** 9
**Current Plan:** `ROADMAP.md` complete through Phase 9.

## Baseline Code Facts

- `notice_ingest` queue contract and Postgres/in-memory stores already exist for collected notice replay.
- `authenticated_notice_ingest_job.v1` now exists as the run-level authenticated notice queue payload.
- Existing queue lifecycle supports queued, leased, succeeded, retryable failure, terminal failure, dead-letter, manual review, blocked, and cancelled.
- Queue lifecycle now includes explicit lease release so dry-run consumers do not leave work stuck in `leased`.
- Retryable failure now uses `failed_retryable` plus `next_retry_after` instead of immediate hot-loop requeue.
- Historical enqueue can project source-truth candidates to notice ingest jobs.
- Run-level authenticated notice queue consumer can lease `authenticated_notice_ingest` jobs, filter by `run_id`, verify collector run ledger object refs, verify source object hash/size, call object-native authenticated notice import, and map success/retryable/terminal/manual-review outcomes back to queue state.
- Run-level authenticated notice queue consumer now heartbeats leased jobs during long-running imports and records lease heartbeat evidence in trace rows.
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

- No remaining core queue/consumer implementation gaps in this workstream.
- Real Postgres/object-store source-truth-only execute smoke completed against the verified captured run `muc_internal_portal:notice:20260428T181953007Z`.
- Full-run execute lease hardening gap is fixed: consumer heartbeat prevents long imports from losing queue ownership, and the smoke wrapper exposes `--lease-seconds` for live acceptance runs.
- Wrapper execute no-op guard is fixed: an execute smoke that does not lease/import/complete or fail any queue job now emits `queue_consume_no_progress` and fails instead of reporting a false pass.
- Historical local-only content repair/synthetic ledger upload remains operator-triggered, not automated by this workstream.

## Deferred By Operator Decision

- Local-only collected content repair/synthetic ledger upload is not automated in this workstream; historical collected content will be manually enqueued later.
- Full live execute smoke no longer depends on missing credentials for the verified captured run; source-truth-only live acceptance was executed on 2026-05-01. Historical local-only replay remains operator-triggered.

## Phase 1 Wrapper Execute Guard

Completed on 2026-05-01.

Implemented:

- `campus-ingestion-smoke-authenticated-notice-ingest-queue-e2e --execute` now treats zero queue progress as a high-severity finding.
- This prevents re-running the wrapper against an already `succeeded` idempotency job from being reported as a passed live smoke.

Fresh DB check:

- Verified notice run count: `1`.
- Only verified notice run: `muc_internal_portal:notice:20260428T181953007Z`.
- Queue status for that run: `succeeded`.
- Candidate verified runs not already succeeded: `0`.

Real guard check:

```bash
uv run --all-packages campus-ingestion-smoke-authenticated-notice-ingest-queue-e2e --run-id 'muc_internal_portal:notice:20260428T181953007Z' --site-id muc_internal_portal --source-home-url https://my.muc.edu.cn --source-surface notice --sample-id 355867 --execute --lease-seconds 3600 --require-child-task-contract --output-dir .tmp/authenticated-notice-ingest-queue-e2e-live-smoke/phase1_noop_guard_existing_succeeded_run
```

Result:

- Report path: `.tmp/authenticated-notice-ingest-queue-e2e-live-smoke/phase1_noop_guard_existing_succeeded_run/authenticated-notice-ingest-queue-e2e-smoke.json`
- Verdict: `failed`
- Finding: `queue_consume_no_progress`
- Queue consume counts: `leased_count=0`, `imported_count=0`, `completed_count=0`, `failed_count=0`
- Queue write summary showed `existing_count=1`, `inserted_count=0`, and existing queue status `succeeded`.

Remaining Phase 1 acceptance:

- Full wrapper execute success must wait for a fresh verified collector run, or an operator-created independent smoke replay run id. Reusing the current succeeded production run is intentionally blocked as a false-pass path.

## Next Slice

No next core implementation slice. Reopen only if the queue/consumer/media/downstream contract drifts, operator changes the deferred historical enqueue policy, or a fresh verified run becomes available for wrapper execute success acceptance.

## Live Infra Execute Smoke

Completed on 2026-05-01 with real Postgres queue/registry state and real object-store reads/writes.

Verified ledger candidate:

- `run_id`: `muc_internal_portal:notice:20260428T181953007Z`
- `site_id`: `muc_internal_portal`
- `source_surface`: `notice`
- `collection_mode`: `incremental`
- `source_bucket`: `campus-rag-source`
- `bundle_object_key`: `authenticated_notice_portal/runs/muc_internal_portal/20260428T181953.007Z/notices-bundle.json`
- `manifest_object_key`: `authenticated_notice_portal/runs/muc_internal_portal/20260428T181953.007Z/export-manifest.json`
- ledger verification: `required_source_object_count=307`, `verified_source_object_count=307`, `missing_source_object_count=0`, `checksum_mismatch_count=0`, `size_mismatch_count=0`

Execution commands:

```bash
uv run --all-packages campus-ingestion-smoke-authenticated-notice-ingest-queue-e2e --run-id 'muc_internal_portal:notice:20260428T181953007Z' --site-id muc_internal_portal --source-home-url https://my.muc.edu.cn --source-surface notice --sample-id 355867 --execute --require-child-task-contract --output-dir .tmp/authenticated-notice-ingest-queue-e2e-live-smoke/muc_internal_portal_notice_20260428T181953007Z
timeout 3600 uv run --all-packages campus-ingestion-consume-authenticated-notice-ingest-queue --execute --run-id 'muc_internal_portal:notice:20260428T181953007Z' --site-id muc_internal_portal --source-home-url https://my.muc.edu.cn --source-surface notice --limit 1 --lease-seconds 3600 --output-dir .tmp/authenticated-notice-ingest-queue-e2e-live-smoke/muc_internal_portal_notice_20260428T181953007Z_consumer_long_lease
```

Result:

- Queue final state: `succeeded`.
- Consumer evidence: `.tmp/authenticated-notice-ingest-queue-e2e-live-smoke/muc_internal_portal_notice_20260428T181953007Z_consumer_long_lease/authenticated-notice-run-queue-consume.execute.json`
- Trace evidence: `.tmp/authenticated-notice-ingest-queue-e2e-live-smoke/muc_internal_portal_notice_20260428T181953007Z_consumer_long_lease/authenticated-notice-run-queue-consume.trace.json`
- Failed report: `.tmp/authenticated-notice-ingest-queue-e2e-live-smoke/muc_internal_portal_notice_20260428T181953007Z_consumer_long_lease/authenticated-notice-run-queue-consume-failed-report.json`
- Consumer counts: `leased_count=1`, `imported_count=1`, `completed_count=1`, `failed_count=0`, `retryable_count=0`, `terminal_count=0`, `manual_review_count=0`.
- Import result summary: `notice_count=282`, `attachment_fetch_status_record_count=305`, `raw_uploaded_count=207`, `raw_reused_count=75`, `source_truth_only=true`.
- DB terminal counts: `ingestion_queue.notice_ingest_jobs.status=succeeded`, `campus_notices/internal_notice` document registry rows `282`, raw asset registry rows `282`.

Observed hardening note:

- The initial smoke wrapper execution wrote and leased the real queue job, but full-run import exceeded the wrapper's former default-only 300-second lease path. That gap is now fixed by consumer lease heartbeat plus smoke wrapper `--lease-seconds` support.

## Final Verification

Completed on 2026-05-01.

Commands:

```bash
uv run --all-packages python -m unittest tests.ingestion.test_collected_notice_ingest_queue tests.ingestion.test_collected_notice_ingest_queue_store tests.ingestion.test_collected_notice_ingest_queue_postgres tests.ingestion.test_authenticated_notice_run_enqueue tests.ingestion.test_enqueue_authenticated_notice_collector_run_worker tests.ingestion.test_authenticated_notice_run_queue_consumer tests.ingestion.test_consume_authenticated_notice_ingest_queue_worker tests.ingestion.test_authenticated_notice_media_gate_evidence tests.ingestion.test_build_authenticated_notice_media_gate_evidence_worker tests.ingestion.test_authenticated_notice_attachment_key_cleanup tests.ingestion.test_authenticated_notice_child_tasks tests.ingestion.test_authenticated_notice_processor_profiles tests.ingestion.test_smoke_authenticated_notice_ingest_queue_e2e_worker
uv run --all-packages ruff check packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_child_tasks.py packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_processor_profiles.py packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_run_queue_consumer.py apps/ingestion-worker/src/campus_ingestion_worker/smoke_authenticated_notice_ingest_queue_e2e.py tests/ingestion/test_authenticated_notice_child_tasks.py tests/ingestion/test_authenticated_notice_processor_profiles.py tests/ingestion/test_authenticated_notice_run_queue_consumer.py tests/ingestion/test_smoke_authenticated_notice_ingest_queue_e2e_worker.py
uv run --all-packages ruff format packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_child_tasks.py packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_processor_profiles.py packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_run_queue_consumer.py apps/ingestion-worker/src/campus_ingestion_worker/smoke_authenticated_notice_ingest_queue_e2e.py tests/ingestion/test_authenticated_notice_child_tasks.py tests/ingestion/test_authenticated_notice_processor_profiles.py tests/ingestion/test_authenticated_notice_run_queue_consumer.py tests/ingestion/test_smoke_authenticated_notice_ingest_queue_e2e_worker.py --check
pnpm exec markdownlint-cli2 --config .markdownlint-cli2.jsonc apps/ingestion-worker/README.md docs/runbooks/ingestion-worker-on-demand-batch-runbook.md .planning/workstreams/authenticated-notice-ingest-queue-e2e-automation/phases/phase-09-child-task-state-contract-and-processor-profile-consolidation/CHILD-TASK-STATE-CONTRACT.md .planning/workstreams/authenticated-notice-ingest-queue-e2e-automation/phases/phase-09-child-task-state-contract-and-processor-profile-consolidation/PLAN.md .planning/workstreams/authenticated-notice-ingest-queue-e2e-automation/README.md .planning/workstreams/authenticated-notice-ingest-queue-e2e-automation/ROADMAP.md .planning/workstreams/authenticated-notice-ingest-queue-e2e-automation/STATE.md .planning/WORKSTREAMS.md
pnpm docs:lint
git diff --check
```

Results:

- Workstream unittest lane: `59` tests passed.
- Ruff check: passed.
- Ruff format check: passed.
- Scoped markdownlint: passed.
- Repo-wide `pnpm docs:lint`: passed.
- `git diff --check`: passed.

## Session Continuity

**Stopped At:** Workstream final verification and closeout complete. Local-only historical enqueue and live infra acceptance are explicit deferred operator tasks.
**Resume File:** None
