---
doc_type: design
status: active
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Source Handoff Ingestion State Machine Design

## Design Conclusion

The repo should standardize one shared state machine at the boundary where source collectors hand
object-backed work to `apps/ingestion-worker`.

The two collectors remain separate:

- `official-web-collector` continues to run URL / page crawl workflows under `app-api`
  `official_web` control-plane admission.
- `authenticated-notice-collector` continues to run authenticated portal notice / file-release
  workflows under its source-channel run ledger and object-native handoff contract.

The shared state starts after source-specific collector run facts exist and before
ingestion-worker mutates downstream source-truth, registry, projection, read model or release state.

## Layer Model

```text
source collector run
  source-specific owner:
    official_web: app-api crawl_runs / artifacts / page_freshness
    authenticated_notice_portal: collector run ledger / verified object refs

shared source handoff
  canonical owner:
    ingestion-control model in ingestion-core, persisted by worker/app adapter store

shared ingestion execution
  canonical owner:
    ingestion-worker execution store and append-only step / child-task evidence

source-specific downstream adoption
  owner:
    official_web projection/import/release rules
    authenticated_notice source-truth, notice/media/admission/materialization rules
```

## Ownership Matrix

| Concept | Canonical Owner | Notes |
| --- | --- | --- |
| Collector frontier / crawl queue | Collector | Not exposed as shared handoff state. |
| Source run admission | Source-specific owner | `official_web` uses app-api; authenticated notice uses collector/source ledger. |
| Source object bytes | S3-compatible source bucket | Local paths are dev/debug only. |
| Source object refs/hash/size | Source-specific run ledger plus shared handoff | Handoff stores normalized refs for worker consumption. |
| Handoff verification | Shared ingestion-control state | HEAD/hash/size verification must be durable and queryable. |
| Worker lease / retry | Shared ingestion execution state | Leases are not collector-owned. |
| Step and child-task evidence | Ingestion worker | Stored as operator-safe structured state and artifact refs. |
| Official-web operator projection | app-api | Projects from canonical execution state where needed. |
| Authenticated notice operator status | ingestion/app projection | Must not require reading local export paths. |
| Telemetry | Runtime adapter / OTel bridge | Telemetry is evidence, not canonical state. |

## Canonical Entities

### `SourceRunRef`

Identifies the source-specific collector run without absorbing the source run ledger.

Fields:

- `source_channel`
- `source_surface`
- `site_id`
- `source_run_id`
- `source_run_owner`
- `source_run_status`
- `source_run_terminal_at`
- `source_run_ref`

Allowed source channels for the first design:

- `official_web`
- `authenticated_notice_portal`

### `SourceHandoff`

The durable contract between source run truth and ingestion-worker execution.

Fields:

- `handoff_id`
- `schema_version`
- `source_run_ref`
- `handoff_kind`
- `source_bucket`
- `bundle_ref`
- `manifest_ref`
- `required_objects`
- `optional_objects`
- `page_or_unit_changes`
- `idempotency_key`
- `created_at`
- `verified_at`
- `superseded_by`
- `status`
- `failure_reason`

`handoff_kind` values:

- `official_web_source_truth_replay`
- `authenticated_notice_import`
- `authenticated_file_release_import`
- `source_repair`

### `SourceObjectRef`

Every source object consumed by worker must be represented as a role-bearing object ref.

Fields:

- `object_role`
- `bucket`
- `object_key`
- `content_sha256`
- `byte_size`
- `content_type`
- `required`
- `source_unit_id`
- `declared_at`

Initial object roles:

- `handoff_bundle`
- `handoff_manifest`
- `official_web_page_manifest`
- `official_web_content_blocks`
- `notice_attachment_source_bytes`
- `file_release_released_source_bytes`
- `provider_capture`
- `quality_audit`

### `ObjectVerification`

Object verification is explicit state, not an implicit side effect of downloading bytes.

Fields:

- `handoff_id`
- `object_role`
- `bucket`
- `object_key`
- `status`
- `expected_sha256`
- `observed_sha256`
- `expected_byte_size`
- `observed_byte_size`
- `checked_at`
- `failure_reason`

### `IngestionExecution`

Represents one worker attempt group over a verified handoff.

Fields:

- `execution_id`
- `handoff_id`
- `processor_profile`
- `requested_result_kind`
- `status`
- `result_kind`
- `lease_owner`
- `lease_expires_at`
- `attempt_count`
- `max_attempts`
- `next_retry_after`
- `started_at`
- `updated_at`
- `finished_at`
- `failure_reason`

`requested_result_kind` values:

- `stage_only`
- `promote`
- `materialize_only`
- `validate_only`

`result_kind` values:

- `none`
- `noop`
- `staged`
- `promoted`
- `materialized`
- `failed`
- `cancelled`

### `IngestionStep`

Represents a bounded worker stage with operator-safe inputs/outputs.

Fields:

- `execution_id`
- `step_id`
- `step_name`
- `status`
- `attempt_count`
- `input_refs`
- `output_refs`
- `started_at`
- `finished_at`
- `failure_reason`
- `retry_after`

Initial step names:

- `verify_objects`
- `materialize_replay_input`
- `source_truth_import`
- `projection_build`
- `projection_validation`
- `chunk_audit`
- `media_gate`
- `target_admission`
- `downstream_materialization`
- `promotion`
- `cleanup_guard`
- `smoke_assertion`

### `ChildTask`

Child tasks are used when one execution contains many source units, media candidates or target
admission branches.

Fields:

- `execution_id`
- `child_task_id`
- `source_unit_id`
- `task_kind`
- `processor_profile`
- `status`
- `reason_code`
- `input_refs`
- `output_refs`
- `attempt_count`
- `started_at`
- `finished_at`

Initial task kinds:

- `source_unit_import`
- `media_candidate_evaluation`
- `ocr_table_extraction`
- `multimodal_enrichment`
- `fact_readiness_evaluation`
- `target_admission`
- `target_materialization`
- `cleanup_evaluation`

## State Machines

### Source Handoff Status

```text
created
  -> verifying
  -> verified
  -> rejected
  -> superseded
  -> cancelled
```

Allowed transitions:

- `created -> verifying`: verifier starts object checks.
- `verifying -> verified`: all required objects are present and hash/size matched.
- `verifying -> rejected`: required object missing, hash mismatch, size mismatch or contract
  violation.
- `created|verified -> superseded`: a newer source run replaces the handoff before execution.
- `created|verified -> cancelled`: operator cancels before worker claim.

Rules:

- Only `verified` handoffs may be claimed for ingestion execution.
- `rejected` handoffs are terminal until repaired by a new handoff.
- Optional object misses do not reject the handoff; they become verification warnings and may affect
  source-specific gates.

### Ingestion Execution Status

```text
queued
  -> claimed
  -> running
  -> completed
  -> failed_retryable
  -> failed_terminal
  -> dead_letter
  -> cancelled
```

Rules:

- `queued -> claimed` requires a lease.
- `claimed -> running` starts worker execution.
- `running -> completed` requires all required steps to pass or be explicitly skipped by profile.
- `running -> failed_retryable` requires transient failure classification and remaining attempts.
- `failed_retryable -> queued` is allowed only after `next_retry_after`.
- `failed_retryable -> dead_letter` occurs when retry budget is exhausted.
- `running -> failed_terminal` is used for contract violations, invalid source refs or unsafe
  promotion requests.
- `queued|claimed|failed_retryable -> cancelled` is operator controlled.
- `completed` always carries a separate `result_kind`.

Compatibility projections:

- official-web current `staged` maps to `status=completed,result_kind=staged`.
- official-web current `promoted` maps to `status=completed,result_kind=promoted`.
- authenticated notice current `succeeded` maps to `status=completed,result_kind` according to the
  requested profile result.

### Step Status

```text
pending
  -> running
  -> passed
  -> skipped
  -> failed_retryable
  -> failed_terminal
  -> cancelled
```

Rules:

- Step failure classification must be explicit.
- `skipped` requires a processor profile reason code.
- Step output refs must not contain raw body, raw OCR text, auth tokens or local-only production
  paths.
- Parent execution completion is derived from required step outcomes.

### Child Task Status

```text
pending
  -> running
  -> completed
  -> skipped
  -> failed_retryable
  -> failed_terminal
  -> manual_review
  -> cancelled
```

Rules:

- `manual_review` is allowed for source-unit or media/fact readiness ambiguity.
- Parent execution success cannot ignore required child tasks unless processor profile explicitly
  marks them non-blocking.
- Child task evidence is operator-safe and links to artifacts by object refs or report refs.

## Source-Specific Adapters

### Official Web Adapter

Inputs:

- `official_web.crawl_runs`
- `official_web.run_artifacts`
- terminal outbox event payload
- source bucket artifacts

Adapter responsibilities:

- Convert terminal app-api run event into `SourceRunRef`.
- Normalize app-api artifact refs into `SourceObjectRef`.
- Create `SourceHandoff` with `handoff_kind=official_web_source_truth_replay`.
- Preserve page changes as `page_or_unit_changes`.
- Project canonical execution back into app-api operator fields during migration.

Adapter must not:

- Move official-web source run ownership out of app-api.
- Treat local handoff JSON files as canonical state.
- Promote registry truth unless requested result kind is `promote` and gates pass.

### Authenticated Notice Adapter

Inputs:

- authenticated notice collector run ledger
- handoff bundle / manifest refs
- attachment and file-release source object refs
- run-level queue request

Adapter responsibilities:

- Convert verified collector run ledger into `SourceRunRef`.
- Normalize bundle / manifest / required source objects into `SourceObjectRef`.
- Create `SourceHandoff` with the correct notice/file-release handoff kind.
- Preserve existing child-task and processor-profile semantics by projecting them into the shared
  `ChildTask` model.

Adapter must not:

- Require app-api control plane in the first implementation slice.
- Reopen portal authentication strategy.
- Treat historical local exports as production handoff truth.

## Store Shape

Recommended logical store family:

- `ingestion_control.source_handoffs`
- `ingestion_control.source_handoff_objects`
- `ingestion_control.source_object_verifications`
- `ingestion_control.ingestion_executions`
- `ingestion_control.ingestion_steps`
- `ingestion_control.ingestion_child_tasks`
- `ingestion_control.ingestion_events`

Ownership:

- Schema / model lives in `packages/ingestion-core`.
- Worker command/runtime writes execution, step and child-task state.
- Source-specific adapters write or project handoff state.
- app-api may expose official-web operator projections, but it should not own shared worker step
  internals.

## Idempotency

Handoff idempotency key:

```text
source_channel
source_surface
site_id
source_run_id
handoff_kind
bundle_sha256
manifest_sha256
```

Execution idempotency key:

```text
handoff_id
processor_profile
requested_result_kind
target_surface_set_hash
```

Rules:

- Duplicate handoff creation with identical refs returns the existing handoff.
- Duplicate handoff creation with same source run but different hashes is a conflict.
- Duplicate execution request with same idempotency key returns existing execution.
- Retrying a failed execution increments attempts; it does not create a new source handoff.

## Failure Classification

Retryable examples:

- object store temporary unavailable
- app-api execution callback temporary unavailable
- transient network failure
- worker process interrupted before terminal state
- lock/lease conflict

Terminal examples:

- missing required object after verification
- hash or size mismatch
- invalid bundle / manifest schema
- source channel mismatch
- unsafe promotion request
- projection validation failed due contract error

Manual-review examples:

- media/fact readiness ambiguity
- target admission not yet decided
- optional source artifact missing but source-specific policy requires operator decision
- cleanup destructive action requested without matching fresh gate evidence

## Operator Queries

The state machine must support these questions without reading local worker files:

- Which source handoffs are waiting for verification?
- Which required object role failed verification?
- Which executions are running and who holds the lease?
- Which retryable failures are due now?
- Which execution is dead-lettered and why?
- Which step blocked promotion?
- Which child task requires manual review?
- Did the execution only stage, or did it promote current truth?
- Which source run and object refs produced a downstream projection/release?

## Migration Plan

1. Add shared models and validators in `packages/ingestion-core`.
2. Add in-memory and Postgres stores for the shared state family.
3. Add official-web adapter that reads app-api terminal run/artifact payload and creates canonical
   handoff records while continuing to project status back to app-api.
4. Add authenticated-notice adapter that projects verified run ledger and current queue jobs into
   canonical handoff/execution rows.
5. Move official-web worker local JSON `processingStatus` to compatibility evidence only; canonical
   state comes from execution store.
6. Keep current authenticated-notice queue API as compatibility shell until shared execution store
   becomes the single worker claim path.
7. Add operator-safe read model projection for panel/app-api after both source adapters pass focused
   tests.
8. Add no-promotion live smoke for official-web and captured-content smoke for authenticated notice.

## Verification Matrix

| Area | Required Evidence |
| --- | --- |
| Contract | model validators reject local paths, raw body, raw OCR, missing hashes and invalid state transitions |
| Store | idempotency, lease, retry-after, dead-letter, cancellation and conflict tests |
| Official-web adapter | terminal app-api run -> verified handoff -> stage-only execution projection |
| Authenticated notice adapter | verified run ledger -> handoff -> child-task projection |
| Worker | claim verified handoff, run steps, update execution/step/child-task states |
| Object verification | missing object, checksum mismatch and optional object warning cases |
| Operator projection | status summaries without local file access |
| Smoke | no serving surface opens, no registry promotion unless explicitly requested |

## Deferred Decisions

The design intentionally defers runtime substrate choices:

- whether shared store physically lives in app-api Postgres schema, ingestion-control schema or a
  later dedicated database
- whether a future external workflow engine is adopted
- whether authenticated notice later receives app-api operator control plane

Those decisions must not change the canonical model above.
