---
doc_type: state
status: completed
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# State: Source Handoff Ingestion State Machine Design

## Current Status

- status: `completed`
- current slice: Phase 10 closeout complete
- owner: unassigned
- active implementation: shared contract/store plus official-web/authenticated-notice adapters and
  worker/operator projection foundation implemented
- latest completed phase: Phase 10 `Closeout Gate And Migration Readiness`
- next phase: none; production runtime adoption is dormant seed
  `.planning/seeds/SEED-003-source-handoff-runtime-store-adoption.md`

## Captured Context

User asked to open a new workstream for the full state machine design after confirming the repo has
two collectors and one ingestion worker:

- `apps/official-web-collector`
- `apps/authenticated-notice-collector`
- `apps/ingestion-worker`

Current repo facts captured in the design:

- `official_web` already has app-api-owned run lifecycle, artifact refs, outbox and operator
  projection.
- `authenticated_notice_portal` already has object-native run ledger, source-object verification,
  run-level queue, child task state and processor profiles.
- Both source channels ultimately hand object-backed work to `apps/ingestion-worker`.
- Current state shape is fragmented across app-api columns, worker local JSON handoff records,
  authenticated notice queue rows, child task evidence and source-specific reports.

Accepted design direction:

- Keep collector-specific source run ownership separate.
- Introduce one canonical shared state model for source handoff, object verification and ingestion
  execution.
- Model execution status separately from result kind so `staged`, `promoted` and `succeeded` do not
  remain overloaded lifecycle states.
- Treat local worker JSON as compatibility evidence, not system truth.
- Do not open query-serving surfaces as part of this workstream.

## Completed In Phase 0

- Created native workstream directory.
- Added `README.md`, `REQUIREMENTS.md`, `ROADMAP.md` and `STATE-MACHINE-DESIGN.md`.
- Registered the workstream in `.planning/WORKSTREAMS.md`.
- Defined canonical entities:
  - `SourceRunRef`
  - `SourceHandoff`
  - `SourceObjectRef`
  - `ObjectVerification`
  - `IngestionExecution`
  - `IngestionStep`
  - `ChildTask`
- Defined source handoff, execution, step and child-task transitions.
- Defined source-specific adapter responsibilities for official-web and authenticated-notice.
- Defined migration and verification matrix.

## Completed In Phase 1

- Added `CONTRACT-STORE-PLAN.md`.
- Identified implementation module paths:
  - `packages/ingestion-core/src/campus_ingestion_core/source_handoff_state_machine.py`
  - `packages/ingestion-core/src/campus_ingestion_core/source_handoff_store.py`
  - `packages/ingestion-core/src/campus_ingestion_core/source_handoff_postgres.py`
  - `packages/ingestion-core/src/campus_ingestion_core/source_handoff_projection.py`
- Defined Python-owned `ingestion_control` logical schema and tables:
  - `source_handoffs`
  - `source_handoff_objects`
  - `source_object_verifications`
  - `ingestion_executions`
  - `ingestion_steps`
  - `ingestion_child_tasks`
  - `ingestion_events`
- Defined official-web compatibility projection from current app-api dispatch/execution fields.
- Defined authenticated-notice compatibility projection from current queue and child-task states.
- Defined implementation order and focused test files.
- Added Phase 1 plan and summary under
  `phases/phase-01-contract-package-and-store-plan/`.

## Completed In Phase 2

- Added `OFFICIAL-WEB-ADAPTER-PLAN.md`.
- Confirmed `apps/app-api` remains official-web crawl-run control-plane owner.
- Mapped current official-web facts into shared models:
  - app-api terminal event and crawl run to `SourceRunRef`
  - terminal outbox and artifacts to `SourceHandoff`
  - artifact and bundle page refs to `SourceObjectRef`
  - object-store checks to `ObjectVerification`
  - verified handoff to `IngestionExecution`
- Defined required object policy for `source_truth_bundle`, page manifests and content blocks.
- Defined step mapping for replay input materialization, source-truth replay, projection
  validation, chunk audit, target admission, downstream materialization and promotion.
- Defined how worker local JSON `processingStatus` becomes debug/evidence instead of canonical
  queue or execution truth.
- Defined app-api compatibility projection rules for existing operator surfaces.
- Added Phase 2 plan and summary under
  `phases/phase-02-official-web-adapter-implementation-plan/`.

## Completed In Phase 3

- Added `AUTHENTICATED-NOTICE-ADAPTER-PLAN.md`.
- Confirmed authenticated notice does not require app-api control-plane ownership for this adapter.
- Mapped current authenticated-notice facts into shared models:
  - verified collector run ledger to `SourceRunRef`
  - verified run refs and bundle/manifest refs to `SourceHandoff`
  - bundle, manifest, notice attachment and file-release refs to `SourceObjectRef`
  - ledger verification and live object-store checks to `ObjectVerification`
  - current run-level queue lifecycle to `IngestionExecution`
  - existing child task contract to `IngestionChildTask`
- Defined `notice` and `file_release` source-surface split and handoff-kind mapping.
- Defined how `ingestion_queue.notice_ingest_jobs` remains scheduler/compatibility input during
  migration while `ingestion_control.ingestion_executions` becomes canonical execution truth.
- Defined historical repair path as explicit operator upload + repair/synthetic ledger + handoff,
  not automatic local replay.
- Added Phase 3 plan and summary under
  `phases/phase-03-authenticated-notice-adapter-implementation-plan/`.

## Completed In Phase 4

- Added `WORKER-EXECUTION-OPERATOR-PROJECTION-PLAN.md`.
- Confirmed `ingestion_control.ingestion_executions` is the canonical execution truth.
- Defined shared claim, lease, heartbeat, retry, terminal and dead-letter semantics.
- Defined shared runner and processor adapter responsibilities for:
  - `official_web_source_truth_replay`
  - `authenticated_notice_import`
  - `authenticated_file_release_import`
- Defined canonical `IngestionStep`, `IngestionChildTask` and `ingestion_events` write points.
- Defined official-web app-api compatibility projection rules.
- Defined authenticated-notice queue/operator compatibility projection rules.
- Defined operator-safe summary shape and forbidden fields.
- Defined app-api / protected-panel / telemetry boundaries.
- Defined no-serving-opening gates.
- Added Phase 4 plan and summary under
  `phases/phase-04-worker-execution-and-operator-projection-plan/`.

## Completed In Phase 5

- Added `IMPLEMENTATION-READINESS-REVIEW.md`.
- Confirmed no unresolved design blocker across source ownership, canonical execution ownership,
  migration posture, operator projection and no-serving-opening gates.
- Confirmed implementation should start with shared contract/store in `packages/ingestion-core`.
- Reconfirmed official-web app-api run ownership and authenticated-notice collector/source-ledger
  run ownership stay separate.
- Reconfirmed `ingestion_control.ingestion_executions` is canonical execution truth.
- Reconfirmed official-web app-api execution fields and authenticated-notice queue rows remain
  compatibility projections or scheduling inputs during migration.
- Reconfirmed protected-panel-web reads app-api APIs only.
- Added Phase 5 plan and summary under
  `phases/phase-05-implementation-readiness-review/`.

## Completed In Phase 6

- Added `packages/ingestion-core/src/campus_ingestion_core/source_handoff_state_machine.py`.
- Added `packages/ingestion-core/src/campus_ingestion_core/source_handoff_store.py`.
- Added `packages/ingestion-core/src/campus_ingestion_core/source_handoff_postgres.py`.
- Added `packages/ingestion-core/src/campus_ingestion_core/source_handoff_projection.py`.
- Added focused tests:
  - `tests/ingestion/test_source_handoff_state_machine.py`
  - `tests/ingestion/test_source_handoff_store.py`
  - `tests/ingestion/test_source_handoff_postgres.py`
  - `tests/ingestion/test_source_handoff_projection.py`
- Implemented canonical models for source run refs, handoffs, object refs, verification,
  executions, steps, child tasks and events.
- Implemented forbidden payload validation for local paths, raw body/html/media/OCR fields and
  credential fields.
- Implemented in-memory store for handoff idempotency, verification, execution claim/heartbeat,
  completion, retry/dead-letter, step, child-task and event writes.
- Implemented additive Postgres bootstrap SQL for `ingestion_control`.
- Implemented first official-web and authenticated-notice projection helper foundation.
- Added Phase 6 plan and summary under
  `phases/phase-06-shared-contract-and-store-implementation/`.

## Completed In Phase 7

- Added `apps/ingestion-worker/src/campus_ingestion_worker/official_web_source_handoff_adapter.py`.
- Added `tests/ingestion/test_official_web_source_handoff_adapter.py`.
- Updated `apps/ingestion-worker/src/campus_ingestion_worker/official_web_handoff_consumer_runtime.py`
  to accept optional `source_handoff_store`.
- Updated `source_handoff_projection.py` to accept app-api camel-case official-web artifact fields.
- Updated `source_handoff_store.py` operator summary to include step status counts.
- Implemented official-web mapping from terminal payload/artifacts to source handoff, object
  verification and stage-only execution.
- Implemented checksum/byte-size verification for declared `source_truth_bundle`.
- Implemented bundle page manifest/content-block object expansion and verification.
- Preserved local JSON status writes as compatibility/debug evidence.
- Preserved app-api execution callback shape while allowing canonical execution id as
  `executionRef`.
- Added Phase 7 plan and summary under
  `phases/phase-07-official-web-adapter-implementation/`.

## Completed In Phase 8

- Added
  `packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_source_handoff_adapter.py`.
- Added `tests/ingestion/test_authenticated_notice_source_handoff_adapter.py`.
- Updated `authenticated_notice_run_queue_consumer.py` to accept optional
  `source_handoff_store`.
- Implemented authenticated-notice mapping from verified collector run refs to source handoff,
  object verification and materialize-only execution.
- Implemented checksum/byte-size verification for bundle and manifest refs through object storage.
- Implemented rejected handoff evidence for failed source object verification.
- Preserved run queue lifecycle as scheduling inbox / compatibility projection.
- Projected existing authenticated-notice child task rows into canonical child task rows.
- Recorded `verify_objects`, `source_truth_import`, `media_gate` and `cleanup_guard` steps for
  source-truth-only success.
- Added Phase 8 plan and summary under
  `phases/phase-08-authenticated-notice-adapter-implementation/`.

## Completed In Phase 9

- Added `packages/ingestion-core/src/campus_ingestion_core/source_handoff_operator_projection.py`.
- Added `packages/ingestion-core/src/campus_ingestion_core/source_handoff_execution.py`.
- Added `packages/ingestion-core/src/campus_ingestion_core/source_handoff_no_serving_gate.py`.
- Added `apps/ingestion-worker/src/campus_ingestion_worker/show_source_handoff_executions.py`.
- Added `apps/ingestion-worker/src/campus_ingestion_worker/consume_source_handoff_executions.py`.
- Added focused tests:
  - `tests/ingestion/test_source_handoff_operator_projection.py`
  - `tests/ingestion/test_source_handoff_execution_runner.py`
  - `tests/ingestion/test_source_handoff_worker_cli.py`
  - `tests/ingestion/test_source_handoff_no_serving_gate.py`
- Updated `source_handoff_store.py` with canonical operator records and
  `mark_execution_running`.
- Updated `apps/ingestion-worker/pyproject.toml` with consume/show console scripts.
- Implemented operator-safe projection for handoff, object verification, execution, step and
  child-task state.
- Implemented shared canonical execution runner helper.
- Implemented no-serving-opening gate for query-enabled, serving alias and implicit promotion drift.
- Added Phase 9 plan and summary under
  `phases/phase-09-worker-execution-and-operator-projection-implementation/`.

## Completed In Phase 10

- Added `CLOSEOUT.md`.
- Added `.planning/seeds/SEED-003-source-handoff-runtime-store-adoption.md`.
- Added Phase 10 plan and summary under
  `phases/phase-10-closeout-gate-and-migration-readiness/`.
- Closed this workstream as completed.
- Recorded production runtime adoption gaps as follow-up:
  - `PostgresSourceHandoffStore`
  - production worker store wiring
  - optional app-api operator read projection admission
  - optional historical compatibility backfill
- Moved repo registry entry from Active to Completed.

## Blockers

- No design blocker.
- No active implementation remains in this workstream.
- Reopen only under the rule in `CLOSEOUT.md`.

## Verification Plan

Design-scope verification:

```bash
pnpm exec markdownlint-cli2 --config .markdownlint-cli2.jsonc \
  .planning/WORKSTREAMS.md \
  .planning/workstreams/source-handoff-ingestion-state-machine-design/README.md \
  .planning/workstreams/source-handoff-ingestion-state-machine-design/REQUIREMENTS.md \
  .planning/workstreams/source-handoff-ingestion-state-machine-design/ROADMAP.md \
  .planning/workstreams/source-handoff-ingestion-state-machine-design/STATE.md \
  .planning/workstreams/source-handoff-ingestion-state-machine-design/STATE-MACHINE-DESIGN.md \
  .planning/workstreams/source-handoff-ingestion-state-machine-design/CONTRACT-STORE-PLAN.md \
  .planning/workstreams/source-handoff-ingestion-state-machine-design/OFFICIAL-WEB-ADAPTER-PLAN.md \
  .planning/workstreams/source-handoff-ingestion-state-machine-design/AUTHENTICATED-NOTICE-ADAPTER-PLAN.md \
  .planning/workstreams/source-handoff-ingestion-state-machine-design/WORKER-EXECUTION-OPERATOR-PROJECTION-PLAN.md \
  .planning/workstreams/source-handoff-ingestion-state-machine-design/IMPLEMENTATION-READINESS-REVIEW.md \
  .planning/workstreams/source-handoff-ingestion-state-machine-design/CLOSEOUT.md \
  .planning/workstreams/source-handoff-ingestion-state-machine-design/phases/phase-01-contract-package-and-store-plan/PLAN.md \
  .planning/workstreams/source-handoff-ingestion-state-machine-design/phases/phase-01-contract-package-and-store-plan/SUMMARY.md \
  .planning/workstreams/source-handoff-ingestion-state-machine-design/phases/phase-02-official-web-adapter-implementation-plan/PLAN.md \
  .planning/workstreams/source-handoff-ingestion-state-machine-design/phases/phase-02-official-web-adapter-implementation-plan/SUMMARY.md \
  .planning/workstreams/source-handoff-ingestion-state-machine-design/phases/phase-03-authenticated-notice-adapter-implementation-plan/PLAN.md \
  .planning/workstreams/source-handoff-ingestion-state-machine-design/phases/phase-03-authenticated-notice-adapter-implementation-plan/SUMMARY.md \
  .planning/workstreams/source-handoff-ingestion-state-machine-design/phases/phase-04-worker-execution-and-operator-projection-plan/PLAN.md \
  .planning/workstreams/source-handoff-ingestion-state-machine-design/phases/phase-04-worker-execution-and-operator-projection-plan/SUMMARY.md \
  .planning/workstreams/source-handoff-ingestion-state-machine-design/phases/phase-05-implementation-readiness-review/PLAN.md \
  .planning/workstreams/source-handoff-ingestion-state-machine-design/phases/phase-05-implementation-readiness-review/SUMMARY.md \
  .planning/workstreams/source-handoff-ingestion-state-machine-design/phases/phase-06-shared-contract-and-store-implementation/PLAN.md \
  .planning/workstreams/source-handoff-ingestion-state-machine-design/phases/phase-06-shared-contract-and-store-implementation/SUMMARY.md \
  .planning/workstreams/source-handoff-ingestion-state-machine-design/phases/phase-07-official-web-adapter-implementation/PLAN.md \
  .planning/workstreams/source-handoff-ingestion-state-machine-design/phases/phase-07-official-web-adapter-implementation/SUMMARY.md \
  .planning/workstreams/source-handoff-ingestion-state-machine-design/phases/phase-08-authenticated-notice-adapter-implementation/PLAN.md \
  .planning/workstreams/source-handoff-ingestion-state-machine-design/phases/phase-08-authenticated-notice-adapter-implementation/SUMMARY.md \
  .planning/workstreams/source-handoff-ingestion-state-machine-design/phases/phase-09-worker-execution-and-operator-projection-implementation/PLAN.md \
  .planning/workstreams/source-handoff-ingestion-state-machine-design/phases/phase-09-worker-execution-and-operator-projection-implementation/SUMMARY.md \
  .planning/workstreams/source-handoff-ingestion-state-machine-design/phases/phase-10-closeout-gate-and-migration-readiness/PLAN.md \
  .planning/workstreams/source-handoff-ingestion-state-machine-design/phases/phase-10-closeout-gate-and-migration-readiness/SUMMARY.md
```

```bash
git diff --check -- \
  .planning/WORKSTREAMS.md \
  .planning/workstreams/source-handoff-ingestion-state-machine-design
```

Implementation-scope verification is defined in `CONTRACT-STORE-PLAN.md`,
`OFFICIAL-WEB-ADAPTER-PLAN.md`, `AUTHENTICATED-NOTICE-ADAPTER-PLAN.md`,
`WORKER-EXECUTION-OPERATOR-PROJECTION-PLAN.md` and `IMPLEMENTATION-READINESS-REVIEW.md`.

Phase 6 focused verification:

```bash
uv run --all-packages python -m unittest \
  tests.ingestion.test_source_handoff_state_machine \
  tests.ingestion.test_source_handoff_store \
  tests.ingestion.test_source_handoff_postgres \
  tests.ingestion.test_source_handoff_projection
```

```bash
uv run --all-packages ruff check \
  packages/ingestion-core/src/campus_ingestion_core/source_handoff_state_machine.py \
  packages/ingestion-core/src/campus_ingestion_core/source_handoff_store.py \
  packages/ingestion-core/src/campus_ingestion_core/source_handoff_postgres.py \
  packages/ingestion-core/src/campus_ingestion_core/source_handoff_projection.py \
  tests/ingestion/test_source_handoff_state_machine.py \
  tests/ingestion/test_source_handoff_store.py \
  tests/ingestion/test_source_handoff_postgres.py \
  tests/ingestion/test_source_handoff_projection.py
```

```bash
uv run --all-packages ruff format --check \
  packages/ingestion-core/src/campus_ingestion_core/source_handoff_state_machine.py \
  packages/ingestion-core/src/campus_ingestion_core/source_handoff_store.py \
  packages/ingestion-core/src/campus_ingestion_core/source_handoff_postgres.py \
  packages/ingestion-core/src/campus_ingestion_core/source_handoff_projection.py \
  tests/ingestion/test_source_handoff_state_machine.py \
  tests/ingestion/test_source_handoff_store.py \
  tests/ingestion/test_source_handoff_postgres.py \
  tests/ingestion/test_source_handoff_projection.py
```

Phase 7 focused verification:

```bash
uv run --all-packages python -m unittest \
  tests.ingestion.test_official_web_source_handoff_adapter \
  tests.ingestion.official_web_handoff_consumer_staging_suite \
  tests.ingestion.official_web_handoff_consumer_promotion_gate_suite \
  tests.ingestion.official_web_handoff_consumer_failure_suite \
  tests.ingestion.test_source_handoff_state_machine \
  tests.ingestion.test_source_handoff_store \
  tests.ingestion.test_source_handoff_postgres \
  tests.ingestion.test_source_handoff_projection
```

Phase 8 focused verification:

```bash
uv run --all-packages python -m unittest \
  tests.ingestion.test_authenticated_notice_source_handoff_adapter \
  tests.ingestion.test_authenticated_notice_run_queue_consumer \
  tests.ingestion.test_authenticated_notice_run_enqueue \
  tests.ingestion.test_source_handoff_state_machine \
  tests.ingestion.test_source_handoff_store \
  tests.ingestion.test_source_handoff_postgres \
  tests.ingestion.test_source_handoff_projection
```

Phase 9 focused verification:

```bash
uv run --all-packages python -m unittest \
  tests.ingestion.test_source_handoff_operator_projection \
  tests.ingestion.test_source_handoff_execution_runner \
  tests.ingestion.test_source_handoff_worker_cli \
  tests.ingestion.test_source_handoff_no_serving_gate \
  tests.ingestion.test_source_handoff_state_machine \
  tests.ingestion.test_source_handoff_store \
  tests.ingestion.test_source_handoff_postgres \
  tests.ingestion.test_source_handoff_projection \
  tests.ingestion.test_official_web_source_handoff_adapter \
  tests.ingestion.test_authenticated_notice_source_handoff_adapter \
  tests.ingestion.test_authenticated_notice_run_queue_consumer \
  tests.ingestion.test_authenticated_notice_run_enqueue
```

## Session Continuity

**Stopped At:** Phase 10 closeout complete.

**Resume File:** `CLOSEOUT.md`
