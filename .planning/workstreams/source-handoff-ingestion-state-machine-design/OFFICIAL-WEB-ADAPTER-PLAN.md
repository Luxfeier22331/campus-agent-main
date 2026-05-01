---
doc_type: design
status: active
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Official-Web Adapter Implementation Plan

## Goal

Define the official-web adapter path from the current `app-api` crawl-run control plane and
ingestion-worker handoff files to the shared source-handoff / ingestion-execution state machine.

This plan does not move official-web run ownership out of `apps/app-api`. It only replaces the
fragmented cross-runtime execution truth with canonical ingestion-control state.

## Current Implementation Shape

Current official-web execution truth is split across four places:

| Current place | Current responsibility | Target posture |
| --- | --- | --- |
| `official_web.crawl_runs` | crawl-run lifecycle plus dispatch/execution compatibility columns | keep as app-api-owned run truth and operator projection source |
| `official_web.run_artifacts` | object-storage artifact refs declared at finalize | input facts for `SourceObjectRef` |
| `official_web.run_outbox` | terminal event handoff trigger | source event consumed into `SourceHandoff` |
| worker local JSON under `./var/official-web-handoffs` and `./var/official-web-handoff-executions` | receiver inbox, processing status, execution report paths | demote to debug/evidence files; canonical status lives in ingestion-control store |

Current code entry points:

- `apps/app-api/src/db/schema/official-web.ts`
- `apps/app-api/src/modules/official-web-command/store.ts`
- `apps/app-api/src/modules/official-web-projection/service.ts`
- `apps/app-api/src/modules/integration/official-web-handoff.ts`
- `apps/app-api/src/modules/official-web-execution/service.ts`
- `apps/ingestion-worker/src/campus_ingestion_worker/official_web_handoff_receiver.py`
- `apps/ingestion-worker/src/campus_ingestion_worker/official_web_handoff_consumer_runtime.py`
- `apps/ingestion-worker/src/campus_ingestion_worker/official_web_handoff_consumer_models.py`

## Adapter Boundary

The official-web adapter owns only this boundary:

```text
app-api terminal run + run_artifacts + run_outbox event
  -> source_handoff + source_handoff_objects + object_verifications
  -> ingestion_execution + ingestion_steps
  -> app-api official_web compatibility projection
```

It must not own:

- collector frontier, crawl policy or parser internals
- app-api crawl-run admission or heartbeat lifecycle
- document registry, chunking or query-serving opening policy
- protected panel read model semantics beyond existing app-api projections

## SourceRunRef Mapping

Build one `SourceRunRef` for each terminal official-web handoff event.

| Field | Source |
| --- | --- |
| `source_channel` | constant `official_web` |
| `source_surface` | `runIntent` or explicit adapter value `official_web/<runIntent>` |
| `site_id` | `crawl_runs.site_id` |
| `source_run_id` | `crawl_runs.run_id` |
| `source_run_owner` | constant `app_api_official_web` |
| `source_run_status` | `crawl_runs.status` at terminal projection time |
| `source_run_terminal_at` | `crawl_runs.finished_at` or outbox `occurred_at` |
| `source_run_ref` | opaque `official_web:crawl_run:<run_id>` |

Rules:

- `source_run_ref` is not a local path and not an object key.
- `completed`, `completed_with_errors`, `failed` and `abandoned` can all create source-run refs, but only runs with required source-truth artifacts can become verified handoffs.
- `failed` and `abandoned` terminal events should normally create rejected or no-op handoff records, not worker-local failed JSON files.

## SourceHandoff Mapping

Create one idempotent `SourceHandoff` from each terminal outbox event that should be considered for ingestion.

| Field | Source |
| --- | --- |
| `handoff_id` | deterministic `ow_handoff_<event_id>` or store-generated id keyed by idempotency |
| `schema_version` | current shared source-handoff schema version |
| `source_run_ref` | mapped from crawl run |
| `handoff_kind` | `official_web_source_truth_replay` |
| `source_bucket` | runtime object-store source bucket |
| `bundle_ref` | `source_truth_bundle` artifact object ref if present |
| `manifest_ref` | `crawl_run_manifest` or page manifest refs if present |
| `required_objects` | required artifact and page source-truth object refs |
| `optional_objects` | host summary, failures, quality audit and non-required reports |
| `page_or_unit_changes` | normalized `pageChanges` from app-api payload |
| `idempotency_key` | `official_web:<event_id>` |
| `status` | `created`, then `verifying`, `verified`, `rejected` or `superseded` |

Required object policy for the first adapter:

- `source_truth_bundle` is required for executable source-truth replay.
- `crawl_run_manifest` is required when present in finalized artifacts, but it is not a substitute for the bundle.
- Page-level `pageManifestObjectKey` and `contentBlocksObjectKey` inside the source-truth bundle must be expanded into `SourceObjectRef` rows before execution.
- Missing required page-level refs should reject verification before projection replay starts.

## SourceObjectRef Mapping

Map app-api artifact types and bundle page refs to shared object roles:

| official-web artifact or bundle field | object role | required |
| --- | --- | --- |
| `source_truth_bundle` | `handoff_bundle` | yes |
| `crawl_run_manifest` | `handoff_manifest` | yes if declared |
| `quality_audit` | `quality_audit` | no |
| `pageManifestObjectKey` | `official_web_page_manifest` | yes |
| `contentBlocksObjectKey` | `official_web_content_blocks` | yes |
| provider capture artifacts | `provider_capture` | no |

Validation:

- Every required object must have `bucket`, `object_key`, `content_sha256` and non-negative `byte_size`.
- If app-api has no `byteSize` for older artifacts, the adapter must not silently mark them verified. It should run object verification and record observed byte size before `verified`.
- Raw HTML, content blocks, OCR payload and page body text are forbidden in the handoff row. They remain in object storage and are referenced by object key.

## Object Verification Flow

The adapter should verify object existence and identity before queuing execution.

Steps:

1. Create or get `SourceHandoff` from terminal event.
2. Append artifact-level `SourceObjectRef` rows from `run_artifacts`.
3. Download and parse the source-truth bundle only enough to discover page-level object refs.
4. Append page-level `SourceObjectRef` rows.
5. Verify required objects with object-store HEAD/hash/size checks.
6. Record one `ObjectVerification` per object.
7. Mark handoff `verified` only when all required objects are matched or have acceptable observed identity.
8. Mark handoff `rejected` for missing bundle, missing page manifests, checksum mismatch or invalid bundle identity.

The current worker `download_source_truth_bundle()` identity checks become part of verification
evidence, not the first time the system learns the handoff is invalid.

## IngestionExecution Mapping

When a handoff is verified, enqueue one `IngestionExecution`.

| Field | Value |
| --- | --- |
| `execution_id` | deterministic `ow_exec_<handoff_id>` or store-generated id keyed by execution idempotency |
| `handoff_id` | verified source handoff id |
| `processor_profile` | `official_web_source_truth_replay` |
| `requested_result_kind` | `stage_only` by default, `promote` only when explicit promotion gate is enabled |
| `status` | `queued` |
| `result_kind` | `none` |
| `attempt_count` | `0` |
| `max_attempts` | profile-defined value |
| `idempotency_key` | `official_web:<event_id>:<requested_result_kind>` |

Execution status compatibility mapping:

| Canonical execution status/result | app-api compatibility projection |
| --- | --- |
| `queued` | `ingestionExecutionStatus=pending` or unchanged pending |
| `claimed` / `running` | `running` |
| `completed` + `result_kind=staged` | `staged` |
| `completed` + `result_kind=promoted` | `promoted` |
| `failed_retryable` | `running` with retry/degraded detail in operator summary, not terminal failed |
| `failed_terminal` / `dead_letter` | `failed` |
| `cancelled` | `failed` with explicit cancellation error code |

The app-api compatibility columns stay as a read/projection layer. They do not become the canonical execution store.

## Step Projection

The official-web execution should emit canonical `IngestionStep` records at these points:

| Step | Existing worker code region | Output refs |
| --- | --- | --- |
| `verify_objects` | source handoff verification adapter | verification records |
| `materialize_replay_input` | `materialize_replay_input()` | replay input debug/evidence refs |
| `source_truth_import` | `replay_official_web_source_truth_local()` | replay report ref |
| `projection_validation` | `validate_official_web_projection_output()` | validation report ref |
| `chunk_audit` | `audit_official_web_projection_chunking()` | chunk audit report ref |
| `target_admission` | `build_stage_quality_report()` and promotion eligibility | coverage and promotion report refs |
| `downstream_materialization` | `persist_projection_output()` | import report refs |
| `promotion` | registry current-truth promotion path when enabled | promotion/import refs |

Local execution report JSON may still be written for debug, but the worker must write step state to the store before it updates local JSON.

## Replacement Path For Local JSON Truth

The current local handoff record fields map as follows:

| Local JSON field | Target |
| --- | --- |
| `schemaVersion` | debug/evidence only |
| `dispatchRef` | app-api compatibility dispatch ref, optionally linked to `handoff_id` |
| `eventId` | source handoff idempotency key input |
| `processingStatus` | canonical `IngestionExecution.status/result_kind` |
| `processingAttemptCount` | canonical `attempt_count` |
| `processingStartedAt` | canonical `started_at` and step `started_at` |
| `processedAt` | canonical `finished_at` and step `finished_at` |
| `lastError` | canonical `failure_reason` |
| `executionReportPath` | `IngestionStep.output_refs` debug report ref |
| `projectionOutputDir` | debug path only; canonical refs must be object-store/report refs |
| `replayInputDir` | debug path only; canonical refs must be object-store/report refs |
| `payload` | source handoff creation input, not canonical runtime payload |

Forbidden target shape:

- app-api or panel reading `./var/official-web-handoff-executions`
- treating local JSON as retry queue truth
- reconstructing execution status from telemetry/logs

## App-API Projection Compatibility

`apps/app-api` keeps the existing operator query surface, but should learn from canonical execution state.

Implementation path:

1. Keep `OfficialWebHandoffPublisher.publish()` response shape compatible with `{ dispatchRef }`.
2. Add a canonical `handoffId` / `executionId` projection when the store is available, without requiring panel to read new tables directly.
3. Replace worker direct callbacks as the only status update source with an adapter that projects canonical execution state into:
   - `crawl_runs.ingestion_execution_status`
   - `crawl_runs.ingestion_execution_ref`
   - `crawl_runs.ingestion_execution_updated_at`
   - `crawl_runs.ingestion_execution_error_code`
   - `crawl_runs.ingestion_execution_error_message`
4. Keep `OfficialWebExecutionStatusService` as compatibility ingress during migration, but treat it as a projection writer, not a canonical writer.

Projection rule:

- app-api operator surfaces can show canonical execution ids and step summaries, but they must not expose raw local paths, raw object keys that are not already accepted artifact refs, raw HTML, token material or prompt/runtime internals.

## Implementation Order

### Step 1: Contract package prerequisite

Implement Phase 1 modules first:

- `source_handoff_state_machine.py`
- `source_handoff_store.py`
- `source_handoff_postgres.py`
- `source_handoff_projection.py`

Acceptance:

- state model validators reject forbidden payload shapes
- in-memory store covers handoff, verification, execution, step and event transitions
- Postgres bootstrap is optional for local unit tests but schema shape is fixed

### Step 2: Official-web projection helpers

Add official-web helper functions under `source_handoff_projection.py`:

- `official_web_source_run_ref_from_projection(...)`
- `official_web_source_handoff_from_event(...)`
- `official_web_object_refs_from_artifacts(...)`
- `official_web_object_refs_from_bundle(...)`
- `official_web_execution_from_verified_handoff(...)`
- `official_web_execution_to_app_api_projection(...)`

Acceptance:

- helpers are pure, deterministic and unit-tested
- helpers accept app-api shaped inputs without importing app-api TypeScript code
- helpers emit canonical model objects, not dict-only ad hoc payloads

### Step 3: Receiver adapter

Change `official_web_handoff_receiver.py` from "persist local JSON inbox as truth" to "persist source handoff and optional debug copy".

Acceptance:

- duplicate event id returns the same `dispatchRef` / `handoffId` when payload is identical
- payload conflict still returns idempotency conflict
- receiver writes canonical `SourceHandoff` and initial artifact refs
- local JSON write is optional debug evidence and no longer needed for status queries

### Step 4: Verification adapter

Add a worker-side verification step before execution claim.

Acceptance:

- missing `source_truth_bundle` rejects the handoff
- missing page manifest/content blocks rejects the handoff
- checksum or size mismatch records `ObjectVerification` failure
- verified handoff enqueues exactly one execution idempotently

### Step 5: Consumer execution adapter

Refactor `consume_handoff_record()` or its successor to run from claimed `IngestionExecution`.

Acceptance:

- execution claim/heartbeat/complete/fail state transitions are persisted in store
- each major stage writes `IngestionStep`
- local JSON status is written only as compatibility debug evidence
- retryable failure does not become app-api terminal `failed` until max attempts or dead letter

### Step 6: App-api read projection

Project canonical execution state back to app-api operator read models.

Acceptance:

- current panel/operator run detail still works
- dispatched, running, staged, promoted and failed projections are preserved
- canonical `execution_id` is visible to operators where useful
- no direct object-store scan or local worker path scan is introduced

### Step 7: No-promotion live seam

Run a no-promotion live path:

```text
collector finalize
  -> app-api outbox/projector
  -> canonical source handoff
  -> object verification
  -> stage-only execution
  -> app-api operator projection shows staged
```

Acceptance:

- no serving surface is opened
- no registry current truth is promoted unless explicit promotion gate is enabled
- source handoff, object verification, execution and step rows exist for the run

## Test Plan

Python unit tests:

- `tests/ingestion/test_source_handoff_state_machine.py`
- `tests/ingestion/test_source_handoff_store.py`
- `tests/ingestion/test_source_handoff_projection_official_web.py`
- `tests/ingestion/test_official_web_handoff_receiver_source_handoff.py`
- `tests/ingestion/test_official_web_handoff_consumer_source_handoff.py`

App-api tests:

- extend `apps/app-api/test/official-web-projection.service.test.ts`
- extend `apps/app-api/test/official-web-e2e-dispatched-projection.suite.ts`
- extend `apps/app-api/test/official-web-command.service.test.ts` only if payload shape changes

Regression gates:

```bash
uv run --all-packages python -m unittest \
  tests.ingestion.test_source_handoff_state_machine \
  tests.ingestion.test_source_handoff_store \
  tests.ingestion.test_source_handoff_projection_official_web \
  tests.ingestion.test_official_web_handoff_receiver_source_handoff \
  tests.ingestion.test_official_web_handoff_consumer_source_handoff
```

```bash
pnpm --filter @campus-agent/app-api test -- official-web-projection.service.test.ts \
  official-web-e2e-dispatched-projection.suite.ts
```

## Migration Notes

- First migration should be additive. Existing `official_web.*` rows remain valid.
- Existing local JSON records may be replayed into canonical handoff state through an explicit operator repair command, but repair must not be automatic by default.
- Old local inbox files should not be deleted by the adapter. Retention belongs to an operator cleanup policy after canonical state is verified.
- `OfficialWebExecutionStatusService` should remain during transition so deployed worker versions can still report status.
- Once canonical state is stable, app-api should stop treating direct worker status callback as canonical truth.

## Phase 2 Acceptance

Phase 2 is complete when:

- this adapter plan names exact current code boundaries and target responsibilities
- status, idempotency and object-verification mappings are explicit
- the local JSON replacement path is clear
- no source-specific collector frontier change is required
- Phase 3 can focus on authenticated-notice without reopening official-web ownership questions
