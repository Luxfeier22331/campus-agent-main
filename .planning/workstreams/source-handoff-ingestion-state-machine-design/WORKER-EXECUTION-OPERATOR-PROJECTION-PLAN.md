---
doc_type: design
status: active
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Worker Execution And Operator Projection Plan

## Goal

Compose the official-web and authenticated-notice adapter plans into one shared
ingestion-worker execution and operator-safe projection plan.

The goal is not to open a new product surface. It is to make the worker execution lifecycle,
retry/lease semantics, step evidence and operator summaries canonical across both source channels.

## Core Conclusion

Canonical execution state belongs to `ingestion_control`, owned by `packages/ingestion-core` and
written by `apps/ingestion-worker`.

Compatibility surfaces remain source-specific:

- official-web still projects selected execution status back to `apps/app-api` official-web
  operator read models.
- authenticated notice can keep `ingestion_queue.notice_ingest_jobs` as a scheduling inbox during
  migration, but execution terminal truth moves to `ingestion_control.ingestion_executions`.
- worker local JSON, operations directories and trace files remain debug/evidence artifacts, not
  status truth.

## Layer Model

```text
source-specific run truth
  official_web: app-api crawl_runs / artifacts / outbox
  authenticated_notice_portal: collector run ledger / verified object refs

shared ingestion-control truth
  source_handoffs
  source_handoff_objects
  source_object_verifications
  ingestion_executions
  ingestion_steps
  ingestion_child_tasks
  ingestion_events

source-specific compatibility projection
  official_web: app-api official_web / operator projections
  authenticated_notice_portal: queue/operator summary, future app-api surface only if admitted

downstream data plane
  source-truth import
  projection/read-model materialization
  registry/index/release only under explicit admission
```

## Execution Ownership

| Concept | Canonical owner | Compatibility owner |
| --- | --- | --- |
| handoff creation | source-specific adapter through ingestion-control store | official-web outbox / authenticated ledger |
| object verification | ingestion-control store | existing ledger verification summary can be imported as evidence |
| execution lease | ingestion-control store | authenticated queue lease only until compatibility migration ends |
| execution retry/dead-letter | ingestion-control store | queue status and app-api fields project from canonical state |
| step state | ingestion-control store | local reports may mirror for debug |
| child task state | ingestion-control store | authenticated child-task JSON can mirror for debug |
| operator read summary | app-api where a product/operator surface exists; otherwise worker CLI summary | no panel direct DB, sink or local-file read |
| telemetry | OTel/sink evidence | never panel canonical truth |

## Execution Lifecycle

Shared `IngestionExecution.status` remains:

- `queued`
- `claimed`
- `running`
- `completed`
- `failed_retryable`
- `failed_terminal`
- `dead_letter`
- `cancelled`

Shared `result_kind` remains:

- `none`
- `noop`
- `staged`
- `promoted`
- `materialized`
- `failed`
- `cancelled`

Transition rules:

1. Only `SourceHandoff.status=verified` can enqueue an execution.
2. `queued -> claimed` is the only worker claim transition.
3. `claimed -> running` happens when the first step starts.
4. `running -> completed` requires a non-`none` result kind.
5. `failed_retryable` requires `next_retry_after` unless immediately exhausted into
   `dead_letter`.
6. `failed_terminal`, `dead_letter`, `cancelled` and `completed` are terminal.
7. Retrying a terminal execution requires a new execution id with an explicit repair/replay
   provenance, not mutation of the terminal row.

## Claim And Lease Plan

The shared store must expose an execution claim loop that applies to both source channels.

Claim algorithm:

1. Select one due execution where status is `queued` or retryable due.
2. Lock with skip-locked semantics in Postgres.
3. Set status to `claimed`, set `lease_owner`, `lease_expires_at`, increment `attempt_count` only
   when work starts.
4. Worker starts heartbeat before expensive object reads or imports.
5. Heartbeat extends lease only when `lease_owner` matches and the lease is unexpired.
6. Expired `claimed/running` executions can be reclaimed after recording a lease-expired event.

Retry policy:

- retry budget is resolved from `processor_profile` and execution `max_attempts`.
- retryable object-store or projection-store failures use `failed_retryable`.
- integrity mismatch, forbidden payload, source-surface mismatch and contract violation use
  `failed_terminal`.
- repeated retry exhaustion uses `dead_letter`.
- missing consumer admission or strict media gate requirement uses manual-review/blocking
  projection through child task and execution failure reason; it must not hot-loop.

## Runner Plan

Add a shared runner layer below app-specific worker commands.

Planned package/runtime files:

| File | Responsibility |
| --- | --- |
| `packages/ingestion-core/src/campus_ingestion_core/source_handoff_execution.py` | Shared execution runner, processor dispatch protocol, lifecycle transition helpers and failure classification. |
| `packages/ingestion-core/src/campus_ingestion_core/source_handoff_operator_projection.py` | Operator-safe summaries for handoffs, executions, steps, child tasks and source-specific compatibility projection payloads. |
| `apps/ingestion-worker/src/campus_ingestion_worker/consume_source_handoff_executions.py` | Worker CLI to claim and execute canonical `IngestionExecution` rows. |
| `apps/ingestion-worker/src/campus_ingestion_worker/show_source_handoff_executions.py` | Read-only worker CLI for operator-safe shared execution summaries. |

Processor adapters:

- `official_web_source_truth_replay`
  - consumes verified official-web handoff.
  - emits step state for replay input, source-truth import, projection validation, chunk audit,
    target admission, downstream materialization and promotion.
- `authenticated_notice_import`
  - consumes verified authenticated notice handoff.
  - emits step state for object verification, source-truth import, media gate, target admission,
    downstream materialization, cleanup guard and smoke.
- `authenticated_file_release_import`
  - consumes verified file-release handoff.
  - emits step state for released source-byte verification and holding import.

The runner must not import app-api TypeScript code, panel code, supervisor packages or retrieval
runtime packages.

## Step State Plan

Every major worker stage writes one `IngestionStep` before local report mutation.

Required shared step names:

- `verify_objects`
- `materialize_replay_input`
- `source_truth_import`
- `projection_validation`
- `chunk_audit`
- `media_gate`
- `target_admission`
- `downstream_materialization`
- `promotion`
- `cleanup_guard`
- `smoke_assertion`

Step rules:

- step input refs and output refs must be sanitized refs, not raw payloads.
- local paths may appear only as debug refs tagged non-canonical.
- object-store and report refs must carry role, bucket/key where applicable, hash/size where
  known, schema version where applicable.
- step failures must carry stable `failure_reason` with code, message, retryable flag and
  source-channel context.
- step completion must happen before execution completion.

## Child Task Plan

`IngestionChildTask` is optional for official-web in the first implementation and required for
authenticated notice where source units, media candidates and target admission are already typed.

Rules:

- authenticated-notice child tasks project from
  `authenticated_notice_child_task_state_contract.v1`.
- `source_unit_id`, `media_ref_id` and `target_id` remain child-task dimensions, not execution
  dimensions.
- child-task state rolls up to execution summary but does not replace step state.
- blocked/manual-review child task must be visible in operator summary.
- OCR-first and multimodal escalation semantics remain processor-profile semantics, not handoff
  semantics.

## Compatibility Projection Plan

### Official Web

Projection target:

- `official_web.crawl_runs.ingestion_execution_*`
- `operator.official_web_run_projection`
- `operator.official_web_site_projection`

Projection inputs:

- `SourceHandoff.status`
- required-object verification summary
- `IngestionExecution.status/result_kind`
- latest failed/highest-severity `IngestionStep`
- optional execution id / handoff id

Rules:

- app-api keeps official-web operator ownership.
- direct worker callback can remain during migration, but it becomes a projection writer, not
  canonical truth.
- app-api and panel must not read worker local JSON or execution directories.
- retryable execution failure should show degraded/running/retry posture, not terminal failed until
  the execution is terminal or dead-lettered.

### Authenticated Notice

Projection target:

- shared worker CLI `show_source_handoff_executions`
- existing queue status CLI during migration
- future app-api operator read model only if a later workstream admits that surface

Projection inputs:

- collector run ref and source surface
- handoff verification summary
- execution status/result/retry posture
- step summary
- child task summary
- manual-review, blocked and dead-letter reason counts

Rules:

- queue summary may mirror canonical execution state, but must not decide execution terminal truth
  after the shared store is enabled.
- local operations directories may be linked as debug evidence only when explicitly tagged as
  non-canonical.
- no app-api authenticated-notice operator route is opened in this phase.

## Operator Summary Shape

The shared projection should expose a compact operator-safe JSON object:

```json
{
  "schema_version": "source_handoff_operator_summary.v1",
  "source_channel": "official_web",
  "source_surface": "baseline",
  "source_run_id": "run-id",
  "handoff": {
    "handoff_id": "handoff-id",
    "status": "verified",
    "required_object_count": 3,
    "verified_object_count": 3,
    "failed_object_count": 0
  },
  "execution": {
    "execution_id": "execution-id",
    "status": "running",
    "result_kind": "none",
    "attempt_count": 1,
    "max_attempts": 3,
    "next_retry_after": null
  },
  "steps": {
    "by_status": {"passed": 2, "running": 1},
    "highest_severity": "none",
    "blocked_step_name": ""
  },
  "child_tasks": {
    "task_count": 0,
    "by_status": {},
    "blocked_child_task_id": "",
    "blocked_reason_code": ""
  },
  "safe_output_refs": []
}
```

Forbidden fields:

- raw HTML, raw notice body, raw content blocks
- raw OCR payload, image bytes, attachment bytes
- prompts, provider responses, retrieval payloads
- cookies, JWT, SSO, bearer tokens, secrets
- local path as required state
- raw stack trace unless stored as a sanitized debug artifact ref

## App-API And Panel Boundary

Phase 4 does not make panel read `ingestion_control` directly.

Allowed:

- app-api official-web projection consumes canonical execution summaries.
- app-api can later expose a generic ingestion operator projection if a separate product/operator
  workstream admits that route.
- protected-panel-web can continue to consume existing app-api official-web APIs.

Forbidden:

- protected-panel-web reading Postgres, object storage, worker local files or telemetry sinks.
- supervisor-api or ingestion-worker providing browser-facing operator APIs.
- app-api exposing raw execution payloads just because the shared store contains them.

## Telemetry And Audit Boundary

Telemetry and audit events are evidence, not canonical state.

The runner should emit sanitized runtime events:

- `ingestion.handoff.created`
- `ingestion.handoff.verified`
- `ingestion.execution.claimed`
- `ingestion.execution.heartbeat`
- `ingestion.step.started`
- `ingestion.step.completed`
- `ingestion.step.failed`
- `ingestion.execution.completed`
- `ingestion.execution.failed`
- `ingestion.execution.dead_lettered`

Rules:

- telemetry sink failure must not mark execution failed.
- canonical state writes must happen before telemetry emission where ordering matters.
- telemetry payloads must use IDs and summaries, not raw artifacts.
- app-api/panel projection must not query telemetry sinks as truth.

## No-Serving-Opening Gate

Every implementation phase must prove that this work does not open query-serving surfaces.

Required assertions:

- no new serving alias is published.
- no `query_enabled=true` collection is added.
- no public-chat or panel route starts answering from new official-web/authenticated-notice content
  because of this state machine.
- official-web default path remains stage-only unless explicit promotion gate is enabled.
- authenticated notice downstream materialization requires explicit consumer admission manifest.
- historical repair stays operator-triggered and does not enqueue all local artifacts by default.

## Implementation Order

### Step 1: Shared contract/store implementation

Implement Phase 1 modules and Postgres schema first.

Acceptance:

- in-memory and Postgres stores support handoff, verification, execution, step, child task and
  event operations.
- validators reject local paths, raw payload fields and credentials.

### Step 2: Operator projection helpers

Implement `source_handoff_operator_projection.py`.

Acceptance:

- shared summary shape is stable.
- official-web compatibility projection preserves existing statuses.
- authenticated-notice projection preserves child-task reason codes.
- forbidden fields are rejected or omitted.

### Step 3: Shared execution runner

Implement `source_handoff_execution.py`.

Acceptance:

- claim/heartbeat/complete/fail/dead-letter transitions are store-backed.
- expired lease reclaim is deterministic.
- failure classification maps retryable, terminal and manual-review/blocking cases.
- dry-run can exercise projection without terminal writes.

### Step 4: Official-web processor adapter

Wire official-web handoff receiver/consumer through shared store.

Acceptance:

- local JSON inbox is no longer required for status truth.
- app-api official-web operator projection still shows dispatched/running/staged/promoted/failed.
- no-promotion live seam produces verified handoff, execution and step rows.

### Step 5: Authenticated-notice processor adapter

Wire run-level queue consumer through shared execution state.

Acceptance:

- queue remains a scheduling inbox during migration.
- canonical execution state is written before queue compatibility status.
- child tasks and progress events project into `IngestionChildTask` / `ingestion_events`.
- source-truth-only run can complete without downstream materialization.

### Step 6: File-release processor adapter

Wire `authenticated_file_release_import`.

Acceptance:

- object-backed released bytes are required and verified.
- reference-only entries stay capture evidence.
- holding import target remains `authenticated_documents/file_release_source`.

### Step 7: Operator read commands/projection

Add shared read-only worker CLI and official-web app-api projection bridge.

Acceptance:

- worker CLI shows handoff/execution/step/child-task summaries without raw payloads.
- official-web app-api route shape remains compatible.
- no authenticated-notice app-api route is opened by default.

### Step 8: Smoke and eval gates

Add focused smoke/eval gates before implementation closeout.

Acceptance:

- official-web stage-only smoke passes against canonical execution state.
- authenticated-notice source-truth-only smoke passes against canonical execution state.
- negative gates fail on local path payload, raw body payload, missing required object and serving
  opening drift.

## Test Plan

Python tests:

- `tests/ingestion/test_source_handoff_execution_runner.py`
- `tests/ingestion/test_source_handoff_operator_projection.py`
- `tests/ingestion/test_source_handoff_worker_cli.py`
- `tests/ingestion/test_official_web_source_handoff_execution.py`
- `tests/ingestion/test_authenticated_notice_source_handoff_execution.py`
- `tests/ingestion/test_source_handoff_no_serving_gate.py`

App-api tests:

- extend `apps/app-api/test/official-web-projection.service.test.ts`
- extend `apps/app-api/test/official-web-query.route.test.ts`
- extend `apps/app-api/test/official-web-e2e-dispatched-projection.suite.ts`

Focused verification after implementation:

```bash
uv run --all-packages python -m unittest \
  tests.ingestion.test_source_handoff_state_machine \
  tests.ingestion.test_source_handoff_store \
  tests.ingestion.test_source_handoff_postgres \
  tests.ingestion.test_source_handoff_projection \
  tests.ingestion.test_source_handoff_execution_runner \
  tests.ingestion.test_source_handoff_operator_projection \
  tests.ingestion.test_source_handoff_worker_cli \
  tests.ingestion.test_official_web_source_handoff_execution \
  tests.ingestion.test_authenticated_notice_source_handoff_execution \
  tests.ingestion.test_source_handoff_no_serving_gate
```

```bash
pnpm --filter @campus-agent/app-api test -- \
  official-web-projection.service.test.ts \
  official-web-query.route.test.ts \
  official-web-e2e-dispatched-projection.suite.ts
```

```bash
uv run --all-packages ruff check \
  packages/ingestion-core/src/campus_ingestion_core/source_handoff_state_machine.py \
  packages/ingestion-core/src/campus_ingestion_core/source_handoff_store.py \
  packages/ingestion-core/src/campus_ingestion_core/source_handoff_postgres.py \
  packages/ingestion-core/src/campus_ingestion_core/source_handoff_projection.py \
  packages/ingestion-core/src/campus_ingestion_core/source_handoff_execution.py \
  packages/ingestion-core/src/campus_ingestion_core/source_handoff_operator_projection.py \
  apps/ingestion-worker/src/campus_ingestion_worker/consume_source_handoff_executions.py \
  apps/ingestion-worker/src/campus_ingestion_worker/show_source_handoff_executions.py \
  tests/ingestion/test_source_handoff_execution_runner.py \
  tests/ingestion/test_source_handoff_operator_projection.py \
  tests/ingestion/test_source_handoff_worker_cli.py
```

```bash
uv run --all-packages ruff format --check \
  packages/ingestion-core/src/campus_ingestion_core/source_handoff_state_machine.py \
  packages/ingestion-core/src/campus_ingestion_core/source_handoff_store.py \
  packages/ingestion-core/src/campus_ingestion_core/source_handoff_postgres.py \
  packages/ingestion-core/src/campus_ingestion_core/source_handoff_projection.py \
  packages/ingestion-core/src/campus_ingestion_core/source_handoff_execution.py \
  packages/ingestion-core/src/campus_ingestion_core/source_handoff_operator_projection.py \
  apps/ingestion-worker/src/campus_ingestion_worker/consume_source_handoff_executions.py \
  apps/ingestion-worker/src/campus_ingestion_worker/show_source_handoff_executions.py \
  tests/ingestion/test_source_handoff_execution_runner.py \
  tests/ingestion/test_source_handoff_operator_projection.py \
  tests/ingestion/test_source_handoff_worker_cli.py
```

## Migration Notes

- Migration must be additive until both existing source paths project correctly from canonical
  execution state.
- official-web direct worker callbacks stay temporarily but become projection compatibility writers.
- authenticated queue rows stay temporarily but become scheduling inbox / compatibility projection.
- local JSON and operations directories stay for debugging until retention policy removes them.
- existing completed rows may be backfilled into read-only execution summaries, but must not trigger
  re-execution.
- shared operator projection must be in place before panel or app-api adopts any new ingestion
  operator surface.

## Phase 4 Acceptance

Phase 4 is complete when:

- this plan composes official-web and authenticated-notice adapter responsibilities into one shared
  execution model.
- claim, heartbeat, retry, dead-letter and terminal semantics are explicit.
- step and child-task write points are explicit.
- operator-safe projection shape and forbidden fields are explicit.
- app-api/panel boundaries are explicit.
- no-serving-opening gates are explicit.
- Phase 5 can perform implementation readiness review without reopening source ownership or
  projection ownership questions.
