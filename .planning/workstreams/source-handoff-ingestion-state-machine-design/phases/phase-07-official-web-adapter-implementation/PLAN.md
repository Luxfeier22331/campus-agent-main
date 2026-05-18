---
doc_type: plan
status: completed
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 7 Plan: Official-Web Adapter Implementation

## Goal

Wire the current official-web terminal handoff consumer into the canonical source-handoff /
ingestion-execution store while preserving existing local JSON compatibility and app-api execution
status callbacks.

## Files Read

- `.planning/workstreams/source-handoff-ingestion-state-machine-design/OFFICIAL-WEB-ADAPTER-PLAN.md`
- `.planning/workstreams/source-handoff-ingestion-state-machine-design/WORKER-EXECUTION-OPERATOR-PROJECTION-PLAN.md`
- `.planning/workstreams/source-handoff-ingestion-state-machine-design/phases/phase-06-shared-contract-and-store-implementation/SUMMARY.md`
- `apps/ingestion-worker/src/campus_ingestion_worker/official_web_handoff_receiver.py`
- `apps/ingestion-worker/src/campus_ingestion_worker/official_web_handoff_consumer.py`
- `apps/ingestion-worker/src/campus_ingestion_worker/official_web_handoff_consumer_runtime.py`
- `apps/ingestion-worker/src/campus_ingestion_worker/official_web_handoff_consumer_models.py`
- `tests/ingestion/official_web_handoff_consumer_test_support.py`
- `tests/ingestion/official_web_handoff_consumer_staging_suite.py`
- `apps/app-api/src/modules/official-web-execution/service.ts`

## Deliverables

- `apps/ingestion-worker/src/campus_ingestion_worker/official_web_source_handoff_adapter.py`
- `tests/ingestion/test_official_web_source_handoff_adapter.py`
- updates to `apps/ingestion-worker/src/campus_ingestion_worker/official_web_handoff_consumer_runtime.py`
- focused fixes to shared projection/store helpers from Phase 6

## Work Items

1. Add failing test for stage-only official-web consumer path with canonical store enabled.
2. Add official-web adapter that maps payload/artifacts to `SourceRunRef`, `SourceHandoff`,
   `SourceObjectRef`, `ObjectVerification` and `IngestionExecution`.
3. Verify declared `source_truth_bundle` checksum/size before execution.
4. Expand bundle page refs into required page manifest/content-block source objects.
5. Record matched object verifications and `verify_objects` step.
6. Let `consume_handoff_record` accept an optional `source_handoff_store`.
7. Keep legacy local JSON status writes as compatibility/debug evidence.
8. Use canonical execution id as app-api execution callback `executionRef` when canonical store is
   enabled.
9. Record canonical execution completion before app-api staged/promoted callback.
10. Preserve existing consumer behavior when no canonical store is passed.
11. Verify official-web regression tests, source-handoff tests, ruff and markdownlint.

## Acceptance

- Current app-api official-web operator callback shape remains compatible.
- Stage-only official-web consumption can create verified handoff, matched object verifications,
  completed execution and passed steps.
- Local JSON is not required as canonical execution truth when a canonical store is supplied.
- Existing local JSON-only consumer tests still pass.
- No source-specific crawler frontier is changed.
- No authenticated-notice adapter is wired in this phase.
- No query-serving surface is opened.
