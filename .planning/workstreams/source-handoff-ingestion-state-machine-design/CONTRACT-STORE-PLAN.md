---
doc_type: design
status: active
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Contract Package And Store Plan

## Goal

Turn `STATE-MACHINE-DESIGN.md` into a code-ready implementation plan for a shared
source-handoff / ingestion-execution contract and store.

This plan is intentionally below collector internals:

- no crawler frontier changes
- no portal authentication changes
- no product serving opening
- no panel-owned state machine

## Package Layout

Phase 2 implementation should start with `packages/ingestion-core` because the shared state belongs
to the data-plane / ingestion boundary, not to either collector.

Add these modules:

| File | Responsibility |
| --- | --- |
| `packages/ingestion-core/src/campus_ingestion_core/source_handoff_state_machine.py` | Canonical dataclasses, constants, transition validation, forbidden-field validation and payload serialization. |
| `packages/ingestion-core/src/campus_ingestion_core/source_handoff_store.py` | Store protocol, in-memory implementation, claim/retry/idempotency logic and operator summary helpers. |
| `packages/ingestion-core/src/campus_ingestion_core/source_handoff_postgres.py` | Postgres implementation and schema bootstrap for the shared `ingestion_control` logical schema. |
| `packages/ingestion-core/src/campus_ingestion_core/source_handoff_projection.py` | Compatibility projection helpers for official-web and authenticated-notice current states. |

Do not add dependencies to:

- `packages/contracts`
- `packages/retrieval-core`
- `packages/rag-agent`
- frontend / panel packages

## Canonical Models

`source_handoff_state_machine.py` should expose the following value objects.

### `SourceRunRef`

Required fields:

- `source_channel`
- `source_surface`
- `site_id`
- `source_run_id`
- `source_run_owner`
- `source_run_status`
- `source_run_terminal_at`
- `source_run_ref`

Validation:

- `source_channel` initially allows `official_web` and `authenticated_notice_portal`.
- `source_run_owner` initially allows `app_api_official_web` and
  `authenticated_notice_collector_ledger`.
- `source_run_ref` must be an opaque reference, not a local path.

### `SourceObjectRef`

Required fields:

- `object_role`
- `bucket`
- `object_key`
- `content_sha256`
- `byte_size`
- `required`

Optional fields:

- `content_type`
- `source_unit_id`
- `declared_at`

Validation:

- required object refs must carry `content_sha256` and non-negative `byte_size`.
- `bucket/object_key` must be object-store identity, not a local path.
- object roles are allowlisted.

Initial object roles:

- `handoff_bundle`
- `handoff_manifest`
- `official_web_page_manifest`
- `official_web_content_blocks`
- `notice_attachment_source_bytes`
- `file_release_released_source_bytes`
- `provider_capture`
- `quality_audit`

### `SourceHandoff`

Required fields:

- `handoff_id`
- `schema_version`
- `source_run_ref`
- `handoff_kind`
- `source_bucket`
- `required_objects`
- `optional_objects`
- `idempotency_key`
- `status`
- `created_at`
- `updated_at`

Optional fields:

- `bundle_ref`
- `manifest_ref`
- `page_or_unit_changes`
- `verified_at`
- `superseded_by`
- `failure_reason`

Status values:

- `created`
- `verifying`
- `verified`
- `rejected`
- `superseded`
- `cancelled`

### `ObjectVerification`

Required fields:

- `verification_id`
- `handoff_id`
- `object_role`
- `bucket`
- `object_key`
- `status`
- `expected_sha256`
- `expected_byte_size`
- `checked_at`

Optional fields:

- `observed_sha256`
- `observed_byte_size`
- `failure_reason`

Status values:

- `pending`
- `checking`
- `matched`
- `missing`
- `checksum_mismatch`
- `size_mismatch`
- `skipped_optional`
- `failed_retryable`

### `IngestionExecution`

Required fields:

- `execution_id`
- `handoff_id`
- `processor_profile`
- `requested_result_kind`
- `status`
- `result_kind`
- `attempt_count`
- `max_attempts`
- `created_at`
- `updated_at`

Optional fields:

- `lease_owner`
- `lease_expires_at`
- `next_retry_after`
- `started_at`
- `finished_at`
- `failure_reason`

Status values:

- `queued`
- `claimed`
- `running`
- `completed`
- `failed_retryable`
- `failed_terminal`
- `dead_letter`
- `cancelled`

Result kind values:

- `none`
- `noop`
- `staged`
- `promoted`
- `materialized`
- `failed`
- `cancelled`

### `IngestionStep`

Required fields:

- `execution_id`
- `step_id`
- `step_name`
- `status`
- `attempt_count`
- `created_at`
- `updated_at`

Optional fields:

- `input_refs`
- `output_refs`
- `started_at`
- `finished_at`
- `failure_reason`
- `retry_after`

Status values:

- `pending`
- `running`
- `passed`
- `skipped`
- `failed_retryable`
- `failed_terminal`
- `cancelled`

### `IngestionChildTask`

Required fields:

- `execution_id`
- `child_task_id`
- `task_kind`
- `processor_profile`
- `status`
- `attempt_count`
- `created_at`
- `updated_at`

Optional fields:

- `source_unit_id`
- `reason_code`
- `input_refs`
- `output_refs`
- `started_at`
- `finished_at`

Status values:

- `pending`
- `running`
- `completed`
- `skipped`
- `failed_retryable`
- `failed_terminal`
- `manual_review`
- `cancelled`

## Forbidden Payload Rules

The model validators must reject:

- local file paths as production refs: `local_path`, `bundle_path`, `manifest_path`,
  `source_file_path`, absolute paths under `/tmp`, `./var` and `.tmp`
- raw body fields: `body_text`, `raw_html`, `html`, `content_blocks`
- raw media / OCR fields: `attachment_bytes`, `ocr_payload`, `ocr_raw_text`, `image_bytes`
- auth material: `cookie`, `jwt`, `token`, `sso_tgc`, `authorization`, `secret`
- downstream serving payloads: chunk body, answer text, raw prompt, raw query

Allowed artifact refs must be object-store refs or operator-safe report refs.

## Store Protocol

`source_handoff_store.py` should define one protocol:

```python
class SourceHandoffStore(Protocol):
    def create_or_get_handoff(self, handoff: SourceHandoff) -> SourceHandoff: ...
    def append_objects(self, handoff_id: str, objects: Sequence[SourceObjectRef]) -> tuple[SourceObjectRef, ...]: ...
    def mark_handoff_verifying(self, handoff_id: str, *, now: datetime | None = None) -> SourceHandoff: ...
    def record_object_verification(self, verification: ObjectVerification) -> ObjectVerification: ...
    def mark_handoff_verified(self, handoff_id: str, *, now: datetime | None = None) -> SourceHandoff: ...
    def reject_handoff(self, handoff_id: str, *, failure_reason: FailureReason, now: datetime | None = None) -> SourceHandoff: ...
    def enqueue_execution(self, execution: IngestionExecution) -> IngestionExecution: ...
    def claim_next_execution(self, *, worker_id: str, lease_seconds: int, now: datetime | None = None) -> IngestionExecution | None: ...
    def heartbeat_execution(self, execution_id: str, *, worker_id: str, lease_seconds: int, now: datetime | None = None) -> IngestionExecution: ...
    def complete_execution(self, execution_id: str, *, worker_id: str, result_kind: str, now: datetime | None = None) -> IngestionExecution: ...
    def fail_execution_retryable(...): ...
    def fail_execution_terminal(...): ...
    def dead_letter_execution(...): ...
    def cancel_execution(...): ...
    def upsert_step(self, step: IngestionStep) -> IngestionStep: ...
    def upsert_child_task(self, child_task: IngestionChildTask) -> IngestionChildTask: ...
    def append_event(self, event: IngestionEvent) -> IngestionEvent: ...
    def operator_summary(self, *, now: datetime | None = None) -> dict[str, object]: ...
```

The in-memory store should be complete enough for all state transition and adapter tests.

## Postgres Logical Schema

Use a Python-owned logical schema by default:

- schema: `ingestion_control`
- package owner: `packages/ingestion-core`
- runtime writer: `apps/ingestion-worker`
- compatibility reader/projector: source-specific adapters

Do not put these canonical worker execution tables under `official_web.*`, `operator.*` or panel
schema. `official_web.*` can keep compatibility columns and read models during migration.

### `ingestion_control.source_handoffs`

Columns:

- `handoff_id text primary key`
- `schema_version text not null`
- `source_channel text not null`
- `source_surface text not null`
- `site_id text not null`
- `source_run_id text not null`
- `source_run_owner text not null`
- `source_run_status text not null`
- `source_run_terminal_at timestamptz`
- `source_run_ref text not null`
- `handoff_kind text not null`
- `source_bucket text not null`
- `status text not null`
- `idempotency_key text not null unique`
- `page_or_unit_changes_json jsonb not null default '[]'::jsonb`
- `failure_reason_json jsonb`
- `superseded_by text`
- `created_at timestamptz not null`
- `updated_at timestamptz not null`
- `verified_at timestamptz`

Indexes:

- `(source_channel, source_surface, site_id, source_run_id)`
- `(status, updated_at)`
- `(handoff_kind, created_at)`

### `ingestion_control.source_handoff_objects`

Columns:

- `handoff_id text not null`
- `object_role text not null`
- `bucket text not null`
- `object_key text not null`
- `content_sha256 text not null`
- `byte_size bigint not null`
- `content_type text`
- `required boolean not null`
- `source_unit_id text`
- `declared_at timestamptz not null`

Constraints / indexes:

- foreign key to `source_handoffs(handoff_id)`
- unique `(handoff_id, object_role, object_key)`
- `(handoff_id, required)`

### `ingestion_control.source_object_verifications`

Columns:

- `verification_id text primary key`
- `handoff_id text not null`
- `object_role text not null`
- `bucket text not null`
- `object_key text not null`
- `status text not null`
- `expected_sha256 text not null`
- `observed_sha256 text`
- `expected_byte_size bigint not null`
- `observed_byte_size bigint`
- `checked_at timestamptz not null`
- `failure_reason_json jsonb`

Indexes:

- `(handoff_id, status)`
- `(object_role, status)`

### `ingestion_control.ingestion_executions`

Columns:

- `execution_id text primary key`
- `handoff_id text not null`
- `processor_profile text not null`
- `requested_result_kind text not null`
- `status text not null`
- `result_kind text not null`
- `idempotency_key text not null unique`
- `lease_owner text`
- `lease_expires_at timestamptz`
- `attempt_count integer not null`
- `max_attempts integer not null`
- `next_retry_after timestamptz`
- `failure_reason_json jsonb`
- `created_at timestamptz not null`
- `updated_at timestamptz not null`
- `started_at timestamptz`
- `finished_at timestamptz`

Indexes:

- `(status, updated_at)`
- `(status, next_retry_after)`
- `(lease_expires_at)`
- `(handoff_id, created_at)`

### `ingestion_control.ingestion_steps`

Columns:

- `execution_id text not null`
- `step_id text not null`
- `step_name text not null`
- `status text not null`
- `attempt_count integer not null`
- `input_refs_json jsonb not null default '[]'::jsonb`
- `output_refs_json jsonb not null default '[]'::jsonb`
- `failure_reason_json jsonb`
- `retry_after timestamptz`
- `created_at timestamptz not null`
- `updated_at timestamptz not null`
- `started_at timestamptz`
- `finished_at timestamptz`

Primary key:

- `(execution_id, step_id)`

Indexes:

- `(execution_id, status)`
- `(step_name, status)`

### `ingestion_control.ingestion_child_tasks`

Columns:

- `execution_id text not null`
- `child_task_id text not null`
- `task_kind text not null`
- `source_unit_id text`
- `processor_profile text not null`
- `status text not null`
- `reason_code text`
- `attempt_count integer not null`
- `input_refs_json jsonb not null default '[]'::jsonb`
- `output_refs_json jsonb not null default '[]'::jsonb`
- `created_at timestamptz not null`
- `updated_at timestamptz not null`
- `started_at timestamptz`
- `finished_at timestamptz`

Primary key:

- `(execution_id, child_task_id)`

Indexes:

- `(execution_id, status)`
- `(task_kind, status)`
- `(reason_code)`

### `ingestion_control.ingestion_events`

Columns:

- `event_id text primary key`
- `handoff_id text`
- `execution_id text`
- `step_id text`
- `child_task_id text`
- `event_type text not null`
- `payload_json jsonb not null`
- `occurred_at timestamptz not null`

Indexes:

- `(handoff_id, occurred_at)`
- `(execution_id, occurred_at)`
- `(event_type, occurred_at)`

## Compatibility Projection Plan

### Official Web

Current fields:

- `crawl_runs.ingestion_dispatch_status`
- `crawl_runs.ingestion_dispatch_ref`
- `crawl_runs.ingestion_execution_status`
- `crawl_runs.ingestion_execution_ref`
- `crawl_runs.ingestion_execution_updated_at`
- `crawl_runs.ingestion_execution_error_code`
- `crawl_runs.ingestion_execution_error_message`

Projection rules:

| Current official-web value | Canonical projection |
| --- | --- |
| `ingestion_dispatch_status=pending` | no verified handoff yet |
| `queued` | `SourceHandoff.status=created` or `verified`, execution not yet claimed |
| `dispatched` | execution exists and is `queued/claimed/running/completed` |
| `ingestion_failed` | handoff rejected, execution terminal, or dispatch retry exhausted |
| `ingestion_execution_status=pending` | no execution result yet |
| `running` | `IngestionExecution.status=running` |
| `staged` | `status=completed,result_kind=staged` |
| `promoted` | `status=completed,result_kind=promoted` |
| `succeeded` | `status=completed,result_kind` from requested profile |
| `failed` | `failed_retryable`, `failed_terminal` or `dead_letter` with failure reason |

Migration rule:

- Keep app-api columns as compatibility projection during the first implementation.
- Stop treating worker local handoff JSON `processingStatus` as canonical once the shared store is
  wired.
- Continue reporting official-web execution status back to app-api until panel/operator APIs read
  the shared projection.

### Authenticated Notice

Current queue states:

- `queued`
- `leased`
- `succeeded`
- `failed_retryable`
- `failed_terminal`
- `dead_letter`
- `manual_review`
- `blocked`
- `cancelled`

Projection rules:

| Current authenticated-notice value | Canonical projection |
| --- | --- |
| `queued` | `IngestionExecution.status=queued` |
| `leased` | `claimed` or `running` depending on worker step evidence |
| `succeeded` | `completed,result_kind` from requested profile |
| `failed_retryable` | `failed_retryable` |
| `failed_terminal` | `failed_terminal` |
| `dead_letter` | `dead_letter` |
| `manual_review` / `blocked` | required child task `manual_review` plus execution terminal/manual-review projection |
| `cancelled` | `cancelled` |

Child-task migration:

- Existing `authenticated_notice_child_task_state_contract.v1` maps directly into
  `IngestionChildTask`.
- Field rename during projection:
  - `parent_job_id` -> `execution_id` compatibility ref
  - `task_id` -> `child_task_id`
  - `processor_profile_id` -> `processor_profile`
  - `state` -> `status`

## Implementation Order

1. Add `source_handoff_state_machine.py` with dataclasses, constants and validators.
2. Add tests for model validation, forbidden payload fields and state transitions.
3. Add `source_handoff_store.py` with protocol and in-memory store.
4. Add tests for idempotency, lease, heartbeat, retry-after, dead-letter, cancellation and operator
   summary.
5. Add `source_handoff_postgres.py` with DDL bootstrap and focused Postgres tests.
6. Add `source_handoff_projection.py` with official-web and authenticated-notice compatibility
   projection helpers.
7. Only after those tests pass, start Phase 2 official-web adapter work.

## Test Plan

Required focused tests:

- `tests/ingestion/test_source_handoff_state_machine.py`
- `tests/ingestion/test_source_handoff_store.py`
- `tests/ingestion/test_source_handoff_postgres.py`
- `tests/ingestion/test_source_handoff_projection.py`

Required assertions:

- required object refs without hash/size are rejected.
- local paths and raw payload fields are rejected.
- source handoff idempotency returns existing identical handoff and rejects conflicting hashes.
- only verified handoffs can enqueue executions.
- expired leases can be reclaimed.
- retryable failure respects `next_retry_after`.
- exhausted retry budget enters `dead_letter`.
- terminal failures cannot be retried by hot loop.
- `completed` execution must carry non-`none` `result_kind`.
- official-web `staged/promoted/failed` projections preserve current app-api semantics.
- authenticated-notice child tasks project without losing blocked reason code.

Focused verification commands after implementation:

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

## Acceptance For Phase 1

Phase 1 is complete when:

- this plan exists and identifies exact module paths, store ownership and migration order.
- `ROADMAP.md` and `STATE.md` point to Phase 2 official-web adapter planning as the next phase.
- the workstream registry reflects Phase 1 completion.
- markdownlint and diff checks pass for planning files.
