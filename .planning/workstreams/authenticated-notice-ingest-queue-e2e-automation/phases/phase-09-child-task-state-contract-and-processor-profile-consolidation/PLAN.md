---
doc_type: phase_plan
workstream: authenticated-notice-ingest-queue-e2e-automation
phase: 9
status: ready
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 9 Plan: Child Task State Contract And Processor Profile Consolidation

## Goal

Turn the authenticated notice queue path from a run-level success/failure shell into a
typed unattended task chain:

`parent ingest job -> source-unit tasks -> media/fact processor tasks -> target admission -> downstream materialization -> cleanup/smoke`

The phase must preserve the existing source-truth boundary while making child task
state, processor profile selection, progress events, retry posture, and downstream
success criteria explicit and testable.

## Why This Phase Exists

Phase 1-8 established the run-level queue, verified collector handoff, object-native
consumer, media gate, downstream materialization guard, cleanup guard, and captured
content smoke harness.

The remaining design gap is that several lifecycle concepts are still distributed
across scripts and evidence artifacts:

- queue job state says whether the run-level job progressed, but not which source unit,
  media candidate, OCR attempt, multimodal escalation, target admission, or downstream
  materialization subtask is responsible for the final posture;
- schedule-image notices such as `355867` require OCR/table extraction first, while
  generic multimodal should only be an escalation lane;
- operator-readable progress exists as reports, but not as a stable per-job/per-task
  event stream;
- retry/resource budgets exist in individual command arguments, but not as a unified
  processor profile contract;
- downstream success is guarded, but the child-task evidence behind that decision is
  not yet the canonical phase contract.

## Canonical References

- `docs/architecture/domains/authenticated-notice/architecture.md`
- `docs/data/authenticated-notice-source-truth-schema.md`
- `docs/architecture/system/data-plane-architecture.md`
- `.planning/workstreams/authenticated-notice-ingest-queue-e2e-automation/README.md`
- `.planning/workstreams/authenticated-notice-ingest-queue-e2e-automation/ROADMAP.md`
- `.planning/workstreams/notice-ingest-fact-state-machine/README.md`
- `.planning/workstreams/authenticated-notice-fetch-admission-operator-wiring/STATE.md`
- RAGFlow ingest reference only as external process design input, not runtime dependency

## Design Decisions To Freeze

1. Parent queue job remains run-level scheduling truth.

   The existing `authenticated_notice_ingest_job.v1` stays the queue payload. It must
   not carry body text, OCR payloads, attachment bytes, local paths, projection rows, or
   read-model data.

2. Child tasks become typed processing truth inside the consumer operations scope.

   Child task identity must be deterministic from parent job id, run id, source unit id,
   media ref id or target id, processor profile, and attempt number.

3. OCR is the default first processor for schedule/table image facts.

   `image_schedule_notice` and `transport_schedule` media candidates route to
   schedule-image OCR/table extraction first. Generic multimodal is allowed only when
   OCR output is absent, low-confidence, semantically insufficient, or the media role is
   not OCR/table-shaped.

4. Progress is an append-only event stream, not only a terminal report.

   Each parent job and child task must emit normalized events for phase start, input
   validation, processor selection, attempt start, attempt completion, retry scheduling,
   manual-review transition, target admission, materialization, cleanup decision, and
   final queue transition.

5. Retry and resource budgets are profile-level configuration.

   Object-store verification, OCR/table extraction, multimodal enrichment, source-truth
   import, downstream materialization, and cleanup each receive explicit retry,
   timeout, concurrency, and terminal/manual-review reason semantics.

6. Queue success means requested downstream work completed or was explicitly not
   requested.

   If downstream materialization is requested, the parent job can only succeed after
   child task evidence proves target admission, materialization evidence, and read-model
   evidence are present and consistent.

7. Cleanup is a child lifecycle stage with destructive action default-off.

   Cleanup dry-run is always representable. Destructive cleanup remains opt-in and
   requires fresh passed strict media gate evidence plus matching candidate inventory
   hash.

## Non-Goals

- No RAGFlow runtime, dataset/kb model, parser engine, or queue implementation adoption.
- No new source channel or official-web work.
- No change to authenticated portal login/session strategy.
- No product/API scheduler or app-api control-plane implementation.
- No automatic historical local-only content enqueue; operator-triggered enqueue remains
  the expected path.
- No new public or restricted query-serving surface.
- No direct collector writes to source-truth, registry, projection, read model, chunk,
  index, or cleanup state.

## Task Breakdown

1. Audit and normalize current lifecycle vocabulary.

   Produce an inventory of existing queue statuses, media lifecycle states, attempt
   result states, target admission states, closeout findings, cleanup states, and smoke
   findings. Mark each as canonical, alias, deprecated, or internal-only.

2. Add a child task state contract.

   Define `authenticated_notice_child_task_state_contract.v1` with deterministic
   identity, parent linkage, task kind, processor profile, state, reason code, retry
   posture, input refs, output refs, and progress event refs.

   Required task kinds:

   - `source_unit_import`
   - `media_candidate_evaluation`
   - `ocr_table_extraction`
   - `multimodal_enrichment`
   - `fact_readiness_evaluation`
   - `target_admission`
   - `downstream_materialization`
   - `cleanup_evaluation`
   - `smoke_assertion`

   Required states:

   - `pending`
   - `running`
   - `completed`
   - `skipped`
   - `failed_retryable`
   - `failed_terminal`
   - `manual_review`
   - `cancelled`

3. Add processor profile contract.

   Define `authenticated_notice_processor_profile.v1` with profile id, admitted source
   surfaces, target families, media role rules, processor order, retry budget, resource
   budget, escalation policy, and terminal/manual-review reason codes.

   Required first profiles:

   - `text_notice`
   - `image_schedule_notice`
   - `attachment_owner_text_notice`
   - `mixed_notice`

4. Add OCR-first routing rules.

   Route schedule/table-like media candidates to OCR/table extraction before multimodal.
   Preserve explicit escalation criteria for low confidence, missing timetable rows,
   ambiguous route/date context, semantic image-only content, or unsupported media.

5. Add progress event schema and writer.

   Emit a stable event stream for parent job and child tasks. Events must include
   generated time, parent job id, run id, child task id, stage, state transition,
   reason code, input hash refs, output refs, and operator-safe message.

6. Wire run-level consumer summaries to child task evidence.

   The consumer trace must summarize child task counts by kind/state/profile and expose
   the highest severity finding. Parent queue transition must be derived from child task
   evidence, not from a single downstream command exit status.

7. Update captured-content smoke.

   Extend the smoke harness to assert the new child task contract over existing
   captured content, including `355867` as an image-carried schedule fact sample.
   Smoke must fail on any medium-or-higher child-task contract finding.

8. Update docs and operator status.

   Update workstream docs, ingestion-worker README/runbook references, and status output
   so an operator can answer which parent job is running, which child task is blocked,
   which processor profile was selected, why OCR or multimodal was used, and whether
   downstream materialization is complete.

## Expected File Scope

- `.planning/workstreams/authenticated-notice-ingest-queue-e2e-automation/phases/phase-09-child-task-state-contract-and-processor-profile-consolidation/PLAN.md`
- `.planning/workstreams/authenticated-notice-ingest-queue-e2e-automation/phases/phase-09-child-task-state-contract-and-processor-profile-consolidation/CHILD-TASK-STATE-CONTRACT.md`
- `packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_child_tasks.py`
- `packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_processor_profiles.py`
- `packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_run_queue_consumer.py`
- `packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_media_gate_evidence.py`
- `apps/ingestion-worker/src/campus_ingestion_worker/consume_authenticated_notice_ingest_queue.py`
- `apps/ingestion-worker/src/campus_ingestion_worker/smoke_authenticated_notice_ingest_queue_e2e.py`
- `apps/ingestion-worker/README.md`
- `docs/runbooks/ingestion-worker-on-demand-batch-runbook.md`
- `tests/ingestion/test_authenticated_notice_child_tasks.py`
- `tests/ingestion/test_authenticated_notice_processor_profiles.py`
- `tests/ingestion/test_authenticated_notice_run_queue_consumer.py`
- `tests/ingestion/test_smoke_authenticated_notice_ingest_queue_e2e.py`

The exact implementation may reuse existing modules if that preserves the same contract
and avoids unnecessary new files.

## Acceptance Criteria

- Parent queue payload remains run-level and does not carry raw content, OCR payloads,
  attachment bytes, local paths, projection rows, or read-model data.
- Every run-level consumer execution can emit a child task summary with counts by task
  kind, processor profile, lifecycle state, and highest severity.
- Notice `355867` selects an OCR/table extraction profile before any generic multimodal
  escalation.
- Generic multimodal is only selected through explicit escalation reasons.
- Retryable child task failures include retry budget, attempt count, and
  `next_retry_after`; terminal/manual-review states include stable reason codes.
- Requested downstream materialization cannot mark the parent job succeeded unless child
  task evidence includes target admission, materialization result, and read-model or
  projection evidence.
- Cleanup dry-run is represented as a child lifecycle stage; destructive cleanup remains
  default-off and evidence-gated.
- Captured-content smoke reports zero medium-or-higher findings under the new child task
  contract.
- Operator status can identify the blocked child task and reason without reading raw
  artifact payloads.

## Verification

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

uv run --all-packages ruff check \
  packages/ingestion-core/src/campus_ingestion_core \
  apps/ingestion-worker/src/campus_ingestion_worker \
  tests/ingestion

uv run --all-packages ruff format \
  packages/ingestion-core/src/campus_ingestion_core \
  apps/ingestion-worker/src/campus_ingestion_worker \
  tests/ingestion \
  --check

pnpm docs:lint
git diff --check
```

## Exit Criteria

Phase 9 is complete when the new child task contract and processor profile contract are
implemented, captured-content smoke validates the full chain with zero medium-or-higher
findings, and the workstream can return to final Verification/closeout without relying
on manual artifact stitching or ambiguous multimodal-first routing.
