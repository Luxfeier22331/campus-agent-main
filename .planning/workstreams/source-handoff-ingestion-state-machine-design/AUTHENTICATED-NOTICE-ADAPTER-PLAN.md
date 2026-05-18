---
doc_type: design
status: active
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Authenticated-Notice Adapter Implementation Plan

## Goal

Define the authenticated-notice adapter path from the current verified collector run ledger and
run-level ingest queue to the shared source-handoff / ingestion-execution state machine.

This plan does not introduce an app-api control plane for authenticated notice. It keeps
collector/source-channel run ownership separate and only canonicalizes the handoff, verification,
worker execution, step and child-task boundary.

## Current Implementation Shape

Current authenticated-notice execution truth is split across these places:

| Current place | Current responsibility | Target posture |
| --- | --- | --- |
| `ingestion_projection.authenticated_notice_collector_run` | collector-owned run ledger, bundle/manifest refs and verification summary | source-run truth and source handoff input |
| source bucket objects | bundle, manifest, notice/file-release source objects and attachment bytes | canonical object bytes, referenced by `SourceObjectRef` |
| `ingestion_queue.notice_ingest_jobs` | run-level scheduling, lease, retry and terminal queue status | compatibility scheduling input during migration; canonical execution moves to `IngestionExecution` |
| run queue consumer trace files | operator evidence for import, media gate, materialization and cleanup | debug/evidence files; canonical step/child-task state moves to ingestion-control store |
| `authenticated_notice_child_task_state_contract.v1` | typed source-unit/media/target/cleanup task evidence | maps directly into `IngestionChildTask` |
| processor profile helpers | profile selection and retry/resource budgets | canonical `processor_profile` input for execution and child tasks |

Current code entry points:

- `packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_collector_run_ledger.py`
- `packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_run_enqueue.py`
- `packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_run_queue_consumer.py`
- `packages/ingestion-core/src/campus_ingestion_core/collected_notice_ingest_queue.py`
- `packages/ingestion-core/src/campus_ingestion_core/collected_notice_ingest_queue_store.py`
- `packages/ingestion-core/src/campus_ingestion_core/collected_notice_ingest_queue_postgres.py`
- `packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_child_tasks.py`
- `packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_processor_profiles.py`
- `packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_import_sources.py`
- `apps/ingestion-worker/src/campus_ingestion_worker/enqueue_authenticated_notice_collector_run.py`
- `apps/ingestion-worker/src/campus_ingestion_worker/consume_authenticated_notice_ingest_queue.py`

## Adapter Boundary

The authenticated-notice adapter owns this boundary:

```text
verified collector run ledger + source bucket object refs
  -> source_handoff + source_handoff_objects + object_verifications
  -> ingestion_execution + ingestion_steps + ingestion_child_tasks
  -> authenticated-notice queue/operator compatibility projection
```

It must not own:

- portal authentication, token refresh or list/detail crawl frontier
- collector local export paths or SQLite state
- document registry, projection, read model, chunk, index or query-serving opening policy
- product/API scheduling or app-api operator read model unless a later workstream explicitly
  admits that control-plane surface

## SourceRunRef Mapping

Build one `SourceRunRef` for each verified authenticated-notice collector run considered for
worker execution.

| Field | Source |
| --- | --- |
| `source_channel` | constant `authenticated_notice_portal` |
| `source_surface` | ledger / queue `source_surface`, initially `notice` or `file_release` |
| `site_id` | queue payload or future ledger column; target ledger should persist it explicitly |
| `source_run_id` | collector ledger `run_id` |
| `source_run_owner` | constant `authenticated_notice_collector_ledger` |
| `source_run_status` | collector ledger `status` |
| `source_run_terminal_at` | collector ledger `finished_at` when present, otherwise handoff creation time |
| `source_run_ref` | opaque `authenticated_notice_portal:<source_surface>:<run_id>` |

Rules:

- `source_run_ref` is not a local filesystem path and not a bundle object key.
- Only ledger rows with `status=success` and `verification_status=verified` can become verified
  handoffs.
- `status=failed` or non-verified rows can produce rejected handoff evidence, but must not enqueue
  an execution.
- If current ledger resolution lacks `site_id`, the adapter may use the queue/enqueue input as a
  compatibility source, but the target ledger should carry `site_id` before implementation closeout.

## SourceHandoff Mapping

Create one idempotent `SourceHandoff` from each verified collector run ledger row.

| Field | Source |
| --- | --- |
| `handoff_id` | deterministic `an_handoff_<surface>_<run_id_digest>` or store-generated id keyed by idempotency |
| `schema_version` | current shared source-handoff schema version |
| `source_run_ref` | mapped from collector run ledger |
| `handoff_kind` | `authenticated_notice_import` for `notice`; `authenticated_file_release_import` for `file_release` |
| `source_bucket` | collector ledger `source_bucket` |
| `bundle_ref` | ledger bundle object ref |
| `manifest_ref` | ledger manifest object ref |
| `required_objects` | bundle, manifest and required source-byte refs |
| `optional_objects` | metadata-only, quarantine, quality, audit and debug-safe refs |
| `page_or_unit_changes` | source-unit summary from manifest when available |
| `idempotency_key` | `authenticated_notice:<surface>:<run_id>:<bundle_sha>:<manifest_sha>` |
| `status` | `created`, then `verifying`, `verified`, `rejected` or `superseded` |

Required object policy:

- `handoff_bundle` is always required.
- `handoff_manifest` is always required.
- `notice_attachment_source_bytes` is required only when source-truth retention/admission declares
  the attachment bytes required or already admitted as source bytes.
- `file_release_released_source_bytes` is required before `file_release` enters
  `authenticated_documents/file_release_source`.
- `metadata_only`, `skip_unsupported`, `skip_too_large`, `terminal_unavailable` and
  `reference_only` refs are source facts, not missing required bytes.

## SourceObjectRef Mapping

Map current authenticated-notice refs to shared object roles:

| Current source | object role | required |
| --- | --- | --- |
| collector run bundle | `handoff_bundle` | yes |
| collector export manifest | `handoff_manifest` | yes |
| notice attachment bytes with required/admitted state | `notice_attachment_source_bytes` | yes |
| notice attachment bytes in quarantine-only state | `notice_attachment_source_bytes` | no |
| file-release released original bytes | `file_release_released_source_bytes` | yes |
| provider capture / audit artifacts | `provider_capture` or `quality_audit` | no |

Validation:

- Required object refs must carry `bucket`, `object_key`, `content_sha256` and non-negative
  `byte_size`.
- Local export paths, bundle paths, manifest paths and temp directories are forbidden in the
  canonical handoff.
- Raw notice body, raw portal HTML, OCR payload, attachment bytes and token material are forbidden
  in the handoff row.
- Bundle/manifest parsing may discover additional source-unit refs, but discovered raw payloads must
  stay in object storage.

## Object Verification Flow

The current collector ledger already records verification summary. The shared adapter should import
that summary as evidence, but still make verification explicit in `ObjectVerification`.

Flow:

1. Resolve collector run ledger by `run_id` and `source_surface`.
2. Require `status=success` and `verification_status=verified`.
3. Create or get `SourceHandoff` with bundle and manifest refs.
4. Verify bundle and manifest with object-store hash/size checks.
5. Parse the manifest/bundle only enough to discover required source-byte refs.
6. Verify every required source-byte object with live object-store identity checks.
7. Record one `ObjectVerification` per checked object, including skipped optional refs where useful.
8. Mark handoff `verified` only when all required objects match.
9. Mark handoff `rejected` for ledger mismatch, missing required object, checksum mismatch, size
   mismatch or invalid source-surface contract.

Classification:

- missing bundle/manifest may be retryable if object-store read is unavailable, but terminal if the
  ledger/object identity is proven inconsistent.
- checksum or size mismatch is terminal.
- consumer admission missing is manual-review / blocked execution state, not source-object
  verification failure.

## IngestionExecution Mapping

When a handoff is verified, enqueue one `IngestionExecution`.

| Field | Value |
| --- | --- |
| `execution_id` | deterministic `an_exec_<handoff_id>` or store-generated id keyed by idempotency |
| `handoff_id` | verified source handoff id |
| `processor_profile` | selected authenticated-notice processor profile, initially `mixed_notice` for run-level default |
| `requested_result_kind` | `materialize_only` for source-truth-only import; `stage_only` for downstream materialization preview; `promote` only with explicit promotion gate |
| `status` | `queued` |
| `result_kind` | `none` |
| `attempt_count` | `0` |
| `max_attempts` | profile or queue retry policy |
| `idempotency_key` | `authenticated_notice:<surface>:<run_id>:<requested_result_kind>` |

Current queue compatibility mapping:

| Current queue status | Canonical execution projection |
| --- | --- |
| `queued` | `IngestionExecution.status=queued` |
| `leased` | `claimed` before step start, `running` after first step start |
| `succeeded` | `completed` with `result_kind=materialized`, `staged` or `promoted` based on requested result |
| `failed_retryable` | `failed_retryable` with `next_retry_after` |
| `failed_terminal` | `failed_terminal` |
| `dead_letter` | `dead_letter` |
| `manual_review` | terminal/manual-review projection with blocking `IngestionChildTask` |
| `blocked` | terminal/manual-review projection with explicit gate/block reason |
| `cancelled` | `cancelled` |

Migration rule:

- During migration, `ingestion_queue.notice_ingest_jobs` can remain the scheduler-facing queue.
- The target canonical owner of lease/retry/execution state is `ingestion_control.ingestion_executions`.
- Do not let both stores independently decide terminal state. Queue status must become a
  compatibility projection or a scheduling inbox once execution store is enabled.

## IngestionStep Mapping

Authenticated-notice execution should write canonical `IngestionStep` records at these points:

| Step | Existing implementation region |
| --- | --- |
| `verify_objects` | ledger resolver and `_verify_source_objects()` |
| `source_truth_import` | `import_authenticated_notice_export()` |
| `media_gate` | media gate evidence manifest and strict validation |
| `target_admission` | consumer admission manifest and downstream gate |
| `downstream_materialization` | import result projection/read-model materialization evidence |
| `cleanup_guard` | cleanup dry-run / destructive cleanup guard |
| `smoke_assertion` | captured-content and live smoke assertions |

Rules:

- Step output refs must be object-store/report refs or operator-safe artifact refs.
- Local operations directory paths may remain debug evidence but cannot be required for canonical
  status queries.
- Retryable step failure must preserve retry budget and `next_retry_after`.
- Manual-review states must include stable reason codes.

## IngestionChildTask Mapping

Existing `authenticated_notice_child_task_state_contract.v1` maps directly into
`IngestionChildTask`.

Field mapping:

| Current child task field | Target field |
| --- | --- |
| `parent_job_id` | `execution_id` compatibility ref or source queue ref |
| `task_id` | `child_task_id` |
| `task_kind` | `task_kind` |
| `processor_profile_id` | `processor_profile` |
| `state` | `status` |
| `source_unit_id` | `source_unit_id` |
| `reason_code` | `reason_code` |
| `input_refs` | `input_refs` |
| `output_refs` | `output_refs` |
| `attempt_ordinal` | `attempt_count` |

Task kind mapping:

| Current task kind | Target task kind |
| --- | --- |
| `source_unit_import` | `source_unit_import` |
| `media_candidate_evaluation` | `media_candidate_evaluation` |
| `ocr_table_extraction` | `ocr_table_extraction` |
| `multimodal_enrichment` | `multimodal_enrichment` |
| `fact_readiness_evaluation` | `fact_readiness_evaluation` |
| `target_admission` | `target_admission` |
| `downstream_materialization` | `downstream_materialization` |
| `cleanup_evaluation` | `cleanup_guard` compatibility projection |
| `smoke_assertion` | `smoke_assertion` |

Progress events should map to `ingestion_events` with `execution_id`, `child_task_id`,
`event_type`, sanitized payload and `occurred_at`.

## Processor Profile Mapping

Current profiles remain valid initial profiles:

- `text_notice`
- `image_schedule_notice`
- `attachment_owner_text_notice`
- `mixed_notice`

Adapter rules:

- `processor_profile` on `IngestionExecution` stores the run-level/default profile.
- `processor_profile` on `IngestionChildTask` stores the selected task-level profile.
- OCR-first schedule/table semantics remain in child-task/profile logic, not in source handoff.
- Generic multimodal remains explicit escalation only.
- Profile retry/resource budgets feed execution retry and child-task retry projection.

## Notice And File-Release Split

`notice` and `file_release` must stay separate source surfaces.

For `notice`:

- `handoff_kind=authenticated_notice_import`
- source-truth unit remains stable notice resource
- metadata-only attachment refs do not block handoff verification
- downstream consumer admission controls notice read-model, service-status, regulations and other
  materialization families

For `file_release`:

- `handoff_kind=authenticated_file_release_import`
- released original bytes are required before holding import
- `reference_only` rows remain capture evidence and must not enter document holding
- file-release import targets `authenticated_documents/file_release_source`, not
  `campus_notices/internal_notice`

## Historical Repair And Replay

Historical/local-only repair remains explicit operator work.

Allowed path:

```text
local historical artifact
  -> upload to source bucket
  -> create repair/synthetic collector ledger row with provenance
  -> create SourceHandoff from verified object refs
  -> enqueue IngestionExecution
```

Forbidden path:

- pushing local `bundle_path` / `manifest_path` into source handoff
- auto-enqueuing every local historical bundle by default
- treating collector local export directory as system truth
- skipping source-object verification because the bundle was already imported once

## Operator Projection Compatibility

Until a dedicated authenticated-notice control plane exists, operator visibility should come from
ingestion-control summaries and existing queue summaries.

Compatibility projection should expose:

- source channel, source surface, run id and source run ref
- handoff status and required object verification summary
- execution status, result kind, attempt count and retry posture
- child task summary by kind/status/profile
- blocked child task id and reason code
- manual-review, blocked, dead-letter and terminal reason counts
- sanitized output refs for import, media gate, downstream materialization, cleanup and smoke

It must not expose:

- raw portal HTML
- full notice body dumps
- attachment bytes
- OCR raw payload unless sanitized as an admitted artifact ref
- credentials, cookies, tokens or SSO material
- local filesystem paths as required operator truth

## Implementation Order

### Step 1: Contract package prerequisite

Implement Phase 1 shared modules first:

- `source_handoff_state_machine.py`
- `source_handoff_store.py`
- `source_handoff_postgres.py`
- `source_handoff_projection.py`

Acceptance:

- source handoff validators reject forbidden payload fields and local paths.
- store supports handoff verification, execution claim/heartbeat/retry and child-task writes.

### Step 2: Authenticated-notice projection helpers

Add helpers under `source_handoff_projection.py`:

- `authenticated_notice_source_run_ref_from_ledger(...)`
- `authenticated_notice_source_handoff_from_ledger(...)`
- `authenticated_notice_object_refs_from_run_refs(...)`
- `authenticated_notice_object_refs_from_manifest(...)`
- `authenticated_notice_execution_from_verified_handoff(...)`
- `authenticated_notice_queue_status_to_execution_projection(...)`
- `authenticated_notice_child_task_to_ingestion_child_task(...)`

Acceptance:

- helpers are pure and deterministic.
- helpers accept current Python model/dict shapes without importing collector runtime code.
- helpers preserve blocked/manual-review reason codes.

### Step 3: Ledger-to-handoff adapter

Refactor enqueue path so verified collector run refs create canonical source handoff before queue
compatibility job creation.

Acceptance:

- `run_id` lookup still requires `status=success` and `verification_status=verified`.
- duplicate run refs resolve idempotently to the same handoff.
- ledger mismatch rejects handoff instead of creating a queue job.
- queue payload does not carry raw content, local paths or downstream projection rows.

### Step 4: Required object verification adapter

Move bundle/manifest and required source-byte verification into canonical object verification.

Acceptance:

- bundle and manifest hash/size checks produce `ObjectVerification` rows.
- required notice/file-release source bytes are checked and recorded.
- metadata-only / terminal-unavailable / reference-only refs are not treated as missing required
  bytes.
- checksum and size mismatch become terminal verification failures.

### Step 5: Execution adapter

Refactor run queue consumer so canonical execution state owns claim, heartbeat, completion, retry,
manual-review and terminal transitions.

Acceptance:

- dry-run releases compatibility queue leases without creating terminal execution state.
- execute mode writes canonical execution transitions before compatibility queue projection.
- retryable failures preserve retry budget and `next_retry_after`.
- `dead_letter` is driven by execution retry budget, not hot-loop queue attempts.

### Step 6: Step and child-task projection

Write `IngestionStep`, `IngestionChildTask` and `ingestion_events` from current consumer trace and
child-task evidence.

Acceptance:

- source-truth import, media gate, downstream materialization and cleanup are visible as steps.
- child task status and reason code survive projection.
- operator summary can identify the blocked child task without reading raw artifacts.

### Step 7: File-release adapter

Add `file_release` source-surface mapping.

Acceptance:

- object-backed released bytes can become verified `file_release_released_source_bytes`.
- `reference_only` file-release rows remain capture evidence.
- file-release imports do not write `campus_notices/internal_notice`.

### Step 8: No-serving smoke seam

Run a no-serving smoke path:

```text
verified collector run ledger
  -> source handoff
  -> object verification
  -> materialize-only execution
  -> source-truth import evidence
  -> child task summary
  -> queue/operator compatibility projection
```

Acceptance:

- no new query-serving surface is opened.
- downstream materialization requires explicit consumer admission manifest.
- local historical replay remains operator-triggered.

## Test Plan

Python unit tests:

- `tests/ingestion/test_source_handoff_projection_authenticated_notice.py`
- `tests/ingestion/test_authenticated_notice_source_handoff_adapter.py`
- `tests/ingestion/test_authenticated_notice_run_queue_source_handoff.py`
- `tests/ingestion/test_authenticated_notice_child_task_projection.py`
- `tests/ingestion/test_authenticated_notice_file_release_source_handoff.py`

Regression extensions:

- extend `tests/ingestion/test_authenticated_notice_run_queue_consumer.py`
- extend `tests/ingestion/test_authenticated_notice_run_enqueue.py`
- extend `tests/ingestion/test_authenticated_notice_child_tasks.py`
- extend `tests/ingestion/test_authenticated_notice_processor_profiles.py`
- extend `tests/ingestion/test_smoke_authenticated_notice_ingest_queue_e2e_worker.py`

Focused verification after implementation:

```bash
uv run --all-packages python -m unittest \
  tests.ingestion.test_source_handoff_projection_authenticated_notice \
  tests.ingestion.test_authenticated_notice_source_handoff_adapter \
  tests.ingestion.test_authenticated_notice_run_queue_source_handoff \
  tests.ingestion.test_authenticated_notice_child_task_projection \
  tests.ingestion.test_authenticated_notice_file_release_source_handoff \
  tests.ingestion.test_authenticated_notice_run_queue_consumer \
  tests.ingestion.test_authenticated_notice_run_enqueue \
  tests.ingestion.test_authenticated_notice_child_tasks \
  tests.ingestion.test_authenticated_notice_processor_profiles \
  tests.ingestion.test_smoke_authenticated_notice_ingest_queue_e2e_worker
```

```bash
uv run --all-packages ruff check \
  packages/ingestion-core/src/campus_ingestion_core/source_handoff_state_machine.py \
  packages/ingestion-core/src/campus_ingestion_core/source_handoff_store.py \
  packages/ingestion-core/src/campus_ingestion_core/source_handoff_postgres.py \
  packages/ingestion-core/src/campus_ingestion_core/source_handoff_projection.py \
  packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_run_enqueue.py \
  packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_run_queue_consumer.py \
  packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_child_tasks.py \
  packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_processor_profiles.py \
  tests/ingestion/test_source_handoff_projection_authenticated_notice.py \
  tests/ingestion/test_authenticated_notice_source_handoff_adapter.py \
  tests/ingestion/test_authenticated_notice_run_queue_source_handoff.py \
  tests/ingestion/test_authenticated_notice_child_task_projection.py \
  tests/ingestion/test_authenticated_notice_file_release_source_handoff.py
```

```bash
uv run --all-packages ruff format --check \
  packages/ingestion-core/src/campus_ingestion_core/source_handoff_state_machine.py \
  packages/ingestion-core/src/campus_ingestion_core/source_handoff_store.py \
  packages/ingestion-core/src/campus_ingestion_core/source_handoff_postgres.py \
  packages/ingestion-core/src/campus_ingestion_core/source_handoff_projection.py \
  packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_run_enqueue.py \
  packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_run_queue_consumer.py \
  packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_child_tasks.py \
  packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_processor_profiles.py \
  tests/ingestion/test_source_handoff_projection_authenticated_notice.py \
  tests/ingestion/test_authenticated_notice_source_handoff_adapter.py \
  tests/ingestion/test_authenticated_notice_run_queue_source_handoff.py \
  tests/ingestion/test_authenticated_notice_child_task_projection.py \
  tests/ingestion/test_authenticated_notice_file_release_source_handoff.py
```

## Migration Notes

- Additive migration only: do not delete `ingestion_queue.notice_ingest_jobs` while existing worker
  commands still consume it.
- Queue and child-task evidence should project into shared execution state before the old queue is
  demoted.
- Existing succeeded queue rows can be backfilled into read-only execution summaries if useful, but
  they must not be replayed automatically.
- Local evidence directories remain debug artifacts and should not become required operator truth.
- Synthetic historical repair ledger rows require explicit operator action and provenance.

## Phase 3 Acceptance

Phase 3 is complete when:

- this adapter plan names exact current authenticated-notice code boundaries and target
  responsibilities.
- verified ledger, queue, object verification, processor profile and child-task mappings are
  explicit.
- local historical repair remains explicit operator work.
- `notice` and `file_release` source surfaces remain separated.
- Phase 4 can plan the shared worker execution and operator projection without reopening
  authenticated-notice ownership questions.
