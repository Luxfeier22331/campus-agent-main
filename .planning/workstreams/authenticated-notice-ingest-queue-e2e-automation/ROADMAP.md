---
doc_type: roadmap
status: active
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Roadmap: Authenticated Notice Ingest Queue E2E Automation

## Phase Status

- [x] **Phase 1: Queue Contract And Lifecycle Freeze** — froze authenticated-notice run-level queue payload, lifecycle states, idempotency, retry/manual-review semantics, and docs.
- [x] **Phase 2: Manual Historical Enqueue And Repair Ledger** — enqueue already collected content through verified run ledger or repair/synthetic ledger rows.
- [x] **Phase 3: Collector Verified-Run Auto-Enqueue** — make collector or its scheduler enqueue only after source bucket upload and run ledger verification.
- [x] **Phase 4: Run-Level Queue Consumer** — claim queue jobs by lease and execute source-object verification plus source-truth/import from `run_id`.
- [x] **Phase 5: Consumer-Owned Media Gate And Promotion Evidence** — generate media gate artifacts inside consumer operations truth and block promotion unless strict audit passes.
- [x] **Phase 6: Downstream Materialization And Read-Model Rebuild** — trigger explicitly admitted target materializers/read models after promotion.
- [x] **Phase 7: Cleanup Lifecycle Integration** — turn cleanup dry-run and destructive cleanup eligibility into a guarded lifecycle stage.
- [x] **Phase 8: Unattended Captured-Content E2E Smoke** — prove queue-to-downstream chain over already collected content with no manual artifact stitching.
- [ ] **Phase 9: Child Task State Contract And Processor Profile Consolidation** — formalize parent job to child task/attempt state, OCR-first processor profiles, progress events, retry/resource budgets, and downstream success criteria before final verification.

## Phase 1: Queue Contract And Lifecycle Freeze

Goal: separate the new run-level ingestion queue contract from the existing per-notice replay/searchable projection helper while preserving reusable store mechanics.

Result:

- Added `authenticated_notice_ingest_job.v1` and `authenticated_notice_ingest` run-level job builder.
- Added run-level idempotency from source channel, source surface, site id, run id, bundle hash, and manifest hash.
- Extended forbidden payload fields to reject local paths as well as body/html/OCR/bytes payloads.
- Added `failed_retryable` retry scheduling with `next_retry_after`.
- Added queue states `manual_review`, `blocked`, and `cancelled`.
- Updated in-memory and Postgres queue stores to expose retry-after leasing and operator terminal states.
- Documented queue as scheduling truth in the ingestion worker runbook.

Deliverables:

- `authenticated_notice_ingest_job.v1` or compatible schema extension that is run-level, not per-notice.
- Required fields for `job_id`, `run_id`, `source_channel`, `source_surface`, `site_id`, source bucket, bundle/manifest object keys, hashes, byte sizes, enqueue source, priority, idempotency key, retry policy, status, lease owner, lease expiry, attempt count, `next_retry_after`, failure reason, created/updated timestamps, and provenance.
- Forbidden payload fields for body/html/OCR/attachment bytes/local paths.
- Lifecycle state model including queued, leased/running, succeeded, retryable failure, terminal failure, dead-letter, manual review/blocked, and cancelled.
- Store-level tests for lifecycle transitions and idempotency.
- Architecture/runbook docs clarifying queue as scheduling truth only.

Verification:

```bash
uv run --all-packages python -m unittest \
  tests.ingestion.test_collected_notice_ingest_queue \
  tests.ingestion.test_collected_notice_ingest_queue_store \
  tests.ingestion.test_collected_notice_ingest_queue_postgres -q
pnpm docs:lint
git diff --check
```

## Phase 2: Manual Historical Enqueue And Repair Ledger

Goal: make already collected content enter the same queue contract without preserving a privileged manual path.

Result:

- Added `authenticated_notice_run_enqueue_plan.v1` and execute report.
- Added `campus_ingestion_core.authenticated_notice_run_enqueue`.
- Added worker CLI `campus_ingestion_worker.enqueue_authenticated_notice_collector_run`.
- CLI resolves only successful verified collector run ledger rows before building queue jobs.
- Dry-run writes evidence without constructing a queue store; execute writes idempotently to queue.
- Existing queue status display now includes `manual_review`, `blocked`, and `cancelled`.

Deliverables:

- CLI to enqueue by existing verified run ledger `run_id`.
- CLI or mode to upload local-only bundle/manifest/source objects to source bucket, verify hash/size, and create repair/synthetic run ledger row with provenance.
- Dry-run report that lists accepted jobs, rejected inputs, missing object refs, hash mismatches, duplicate idempotency keys, and repair actions.
- Execution report that records inserted/existing queue rows and ledger repair evidence.
- Tests that prove local paths never enter production queue payload.

Verification:

```bash
uv run --all-packages python -m unittest \
  tests.ingestion.test_collected_notice_historical_enqueue \
  tests.ingestion.test_enqueue_collected_notice_historical_inventory_worker -q
uv run --all-packages ruff check \
  packages/ingestion-core/src/campus_ingestion_core \
  apps/ingestion-worker/src/campus_ingestion_worker
```

## Phase 3: Collector Verified-Run Auto-Enqueue

Goal: connect collector success to ingest queue without letting collector own downstream ingestion.

Result:

- Added collector config flags `AUTHENTICATED_NOTICE_INGEST_QUEUE_ENQUEUE_ON_SUCCESS` and `AUTHENTICATED_NOTICE_INGEST_QUEUE_ENQUEUE_OUTPUT_DIR`.
- Added `ingest-queue-enqueue.ts` to build and run the repo-owned ingestion-worker enqueue command.
- `runBootstrapExport` now calls the enqueue hook only after a successful verified ledger record.
- The collector still does not write queue internals, source-truth, projections, read models, chunks, indexes, or downstream state.
- README documents that auto-enqueue is a verified `run_id` handoff only.

Deliverables:

- collector-side handoff emitter or scheduler-side enqueue command that runs after run ledger verification.
- enqueue retry/report artifact for queue write failures.
- config that can disable enqueue for local/debug runs while preserving production default.
- tests proving enqueue is skipped for failed/unverified runs and idempotent for repeated verified runs.
- docs update for live path and selected/backfill behavior.

Verification:

```bash
pnpm --dir apps/authenticated-notice-collector test
pnpm --dir apps/authenticated-notice-collector typecheck
uv run --all-packages python -m unittest \
  tests.ingestion.test_collected_notice_ingest_queue -q
```

## Phase 4: Run-Level Queue Consumer

Goal: make ingestion worker consume a run-level job and execute source-truth/import through object-native `run_id` handoff.

Result:

- Added run-level consumer `campus_ingestion_core.authenticated_notice_run_queue_consumer`.
- Added worker CLI `campus_ingestion_worker.consume_authenticated_notice_ingest_queue`.
- Consumer leases only `authenticated_notice_ingest_job.v1` jobs and supports store-level `--run-id` filtering.
- Consumer re-resolves verified collector run ledger refs, checks queue payload refs match ledger refs, verifies source object hash/size, and calls `import_authenticated_notice_export` with object refs only.
- Queue result transitions now cover success, retryable source-object/object-store failures with `next_retry_after`, terminal contract failures, and manual-review gate failures.
- Added lease release so dry-run consumers do not leave queue rows stuck in `leased`.

Deliverables:

- worker command to claim queue jobs with lease and optional `--run-id` / `--limit` filters.
- resolver that reads run ledger object refs and verifies source bucket existence/hash/size before import.
- orchestration that calls existing authenticated notice importer with object-native refs and no local path fallback.
- queue result transitions for success, retryable object-store failures, terminal contract failures, manual-review failures, and dead-letter.
- trace artifact under deterministic operations prefix.

Verification:

```bash
uv run --all-packages python -m unittest \
  tests.ingestion.test_collected_notice_queue_consumer \
  tests.ingestion.test_consume_collected_notice_ingest_queue_worker \
  tests.ingestion.test_authenticated_notice_closeout_worker -q
```

## Phase 5: Consumer-Owned Media Gate And Promotion Evidence

Goal: remove manual artifact stitching between import/closeout and media gate promotion.

Result:

- Added `authenticated_notice_media_gate_evidence_manifest.v1`.
- Added manifest builder/validator that records deterministic operations-dir artifact refs and verifies strict audit input hashes against current file bytes.
- Added worker CLI `campus_ingestion_worker.build_authenticated_notice_media_gate_evidence`.
- On-demand authenticated notice closeout now inserts a `build_media_gate_evidence` step after strict audit and before promotion.
- Run-level queue consumer can require media gate evidence before queue completion and maps missing/stale/failed gate evidence to `manual_review`.

Deliverables:

- consumer-generated candidate inventory, attempt ledger, closeout inventory, target admission manifest, cleanup dry-run, live source-object verification report, and strict audit report.
- operations prefix convention for all generated media gate evidence.
- promotion command receives only same-run strict audit artifact.
- gate failure maps to terminal/manual-review queue state with reason codes.
- tests proving promotion is blocked without passed strict audit and matching candidate inventory hash.

Verification:

```bash
uv run --all-packages python -m unittest \
  tests.ingestion.test_collected_notice_media_closeout_state_machine_audit \
  tests.ingestion.test_collected_notice_media_extraction_closeout \
  tests.ingestion.test_authenticated_notice_closeout_async_verification_and_promotion_suite \
  tests.ingestion.test_on_demand_batch_runner -q
```

## Phase 6: Downstream Materialization And Read-Model Rebuild

Goal: make promoted results automatically enter admitted downstream materializers and read models.

Result:

- Run-level consumer now records downstream materialization summary in trace rows.
- `--materialize-downstream` / `source_truth_only=False` no longer silently succeeds without importer-reported projection/read-model evidence.
- Missing downstream materialization evidence maps to queue `manual_review` instead of `succeeded`.
- Successful downstream materialization trace captures projection/read-model counts and consumer admission gate reports from the importer result.

Deliverables:

- target admission dispatcher for regulation, transport schedule, service status, and notice-level query surfaces that are already explicitly admitted.
- read-model rebuild or refresh step after promotion.
- result artifact linking queue job, promotion id, downstream materialization ids, and read-model counts.
- fail-closed handling for missing required fact groups and unresolved target-blocking media.
- tests for downstream rows produced only from admitted target manifests.

Verification:

```bash
uv run --all-packages python -m unittest \
  tests.ingestion.test_collected_notice_regulation_admission \
  tests.ingestion.test_official_transport_baseline_preview \
  tests.ingestion.test_authenticated_notice_state_machine_audit \
  tests.ingestion.test_registry_scope_release -q
```

## Phase 7: Cleanup Lifecycle Integration

Goal: turn quarantine cleanup into a guarded automatic lifecycle stage without making deletion the default proof path.

Result:

- Run-level consumer can record cleanup dry-run posture in queue consume trace.
- Destructive cleanup is explicit opt-in and is blocked unless fresh passed media gate evidence is present.
- Missing destructive cleanup gate maps to queue `manual_review` rather than allowing silent success.
- Worker CLI exposes cleanup report and destructive cleanup gate flags.

Deliverables:

- cleanup dry-run generated for each consumer run.
- policy switch for destructive cleanup, default off for local/dev.
- destructive cleanup guard that requires fresh passed strict audit and matching candidate inventory hash.
- deletion evidence artifact with object refs, reasons, retention class, and audit hash.
- tests proving target-blocking pending/manual-review candidates protect quarantine bytes.

Verification:

```bash
uv run --all-packages python -m unittest \
  tests.ingestion.test_authenticated_notice_attachment_key_cleanup \
  tests.ingestion.test_collected_notice_media_closeout_state_machine_audit -q
```

## Phase 8: Unattended Captured-Content E2E Smoke

Goal: prove the production-like path over already collected authenticated notice content without requiring live portal auth.

Result:

- Added worker CLI `campus_ingestion_worker.smoke_authenticated_notice_ingest_queue_e2e`.
- Dry-run mode proves verified collector run ledger resolution and run-level enqueue plan without mutating queue state.
- Execute mode reuses the same enqueue and run-level queue consumer path with optional media gate, downstream materialization, and cleanup guard flags.
- Smoke report includes planned path, enqueue plan, consume summary, findings, medium-or-higher finding count, and verdict.

Deliverables:

- smoke command that seeds or selects queue rows from verified/repair ledger entries.
- deterministic captured-content sample including notice `355867` where schedule facts are image-carried.
- assertions for source object verification, import counts, media gate verdict, promotion result, downstream materialization/read-model counts, cleanup posture, and queue final states.
- medium-or-higher finding taxonomy and report.
- CI/local acceptance documentation.

Verification:

```bash
uv run --all-packages python -m campus_ingestion_worker.smoke_authenticated_notice_ingest_queue_e2e \
  --captured-content \
  --sample-id 355867
uv run --all-packages python -m unittest discover -s tests -t .
pnpm docs:lint
git diff --check
```

## Phase 9: Child Task State Contract And Processor Profile Consolidation

Goal: turn the run-level authenticated notice queue consumer into a typed unattended task chain with explicit child task states, OCR-first processor profiles, progress events, retry/resource budgets, and downstream materialization success criteria.

Deliverables:

- `authenticated_notice_child_task_state_contract.v1` covering parent linkage, task identity, task kind, processor profile, lifecycle state, reason code, retry posture, input refs, output refs, and progress event refs.
- `authenticated_notice_processor_profile.v1` covering `text_notice`, `image_schedule_notice`, `attachment_owner_text_notice`, and `mixed_notice`.
- OCR-first routing for schedule/table image facts, including notice `355867`, with generic multimodal limited to explicit escalation reasons.
- Append-only progress event stream for parent jobs and child tasks.
- Consumer trace summary by child task kind/state/profile and highest severity.
- Captured-content smoke assertions for zero medium-or-higher child-task contract findings.

Verification:

```bash
uv run --all-packages python -m unittest \
  tests.ingestion.test_authenticated_notice_child_tasks \
  tests.ingestion.test_authenticated_notice_processor_profiles \
  tests.ingestion.test_authenticated_notice_run_queue_consumer \
  tests.ingestion.test_smoke_authenticated_notice_ingest_queue_e2e
uv run --all-packages python -m campus_ingestion_worker.smoke_authenticated_notice_ingest_queue_e2e \
  --captured-content \
  --sample-id 355867 \
  --require-child-task-contract
pnpm docs:lint
git diff --check
```
