---
doc_type: plan
status: completed
created: 2026-04-29
updated: 2026-04-29
phase: 6R.1b
plan: regulation-owner-text-recovery-execution
type: implementation
wave: 1
depends_on:
  - Phase 5
  - Phase 6R.1
  - Phase 6R.1a
autonomous: true
---

<!-- markdownlint-disable MD013 -->

# Phase 6R.1b Plan: Regulation Owner Text Recovery Execution

## Objective

Execute the selected Phase 6R.1a owner-text recovery attempts against the
configured object store and OCR provider, then write only the normalized refs
declared by the attempt plan.

This phase turns selected `file_release` regulation owner documents from
`needs_multimodal` into provider-backed `owner_text_ready` evidence. It still
does not promote any regulation candidate into downstream materialization.

## Inputs

- Phase 6R.1a `regulation-owner-text-attempt-plan.json`
- Source PDFs / Office files in `campus-rag-source`
- Runtime `OBJECT_STORE_*` configuration
- Runtime OCR configuration, preferring `mineru_api` when configured

## Non-Goals

- No direct DB writes.
- No `regulations/*` materialization.
- No query-serving release or alias update.
- No fabricated OCR / owner-text output.
- No rewriting Phase 6R.1 admission without rerunning that phase explicitly.
- No processing outside the Phase 6R.1a selected mini-batch.

## Execution Contract

- Default worker mode is no-write dry-run.
- `--execute` is required before provider calls or object-store writes are
  enabled.
- Each attempt reads the declared `source_object_ref`.
- Each successful attempt writes exactly these declared normalized refs:
  - `provider_response`
  - `plain_text`
  - `layout_elements`
  - `searchable_merge_input`
- Failed attempts are reported without writing success outputs.
- The execution report must keep `db_writes_enabled=false`.

## Deliverables

- `regulation-owner-text-execution-report.json`
- `dry-run/regulation-owner-text-execution-report.json`
- Provider-backed owner text objects in `campus-rag-source`
- Provider-backed layout element objects in `campus-rag-source`
- Searchable merge input objects in `campus-rag-source`

## Code Scope

- `packages/ingestion-core/src/campus_ingestion_core/collected_notice_regulation_owner_text_recovery_constants.py`
- `packages/ingestion-core/src/campus_ingestion_core/collected_notice_regulation_owner_text_execution.py`
- `apps/ingestion-worker/src/campus_ingestion_worker/execute_collected_notice_regulation_owner_text.py`
- `tests/ingestion/test_collected_notice_regulation_owner_text_execution.py`
- `tests/ingestion/test_execute_collected_notice_regulation_owner_text_worker.py`

## Verification

```bash
uv run --all-packages python -m unittest tests.ingestion.test_collected_notice_regulation_owner_text_execution tests.ingestion.test_execute_collected_notice_regulation_owner_text_worker
uv run --all-packages ruff check packages/ingestion-core/src/campus_ingestion_core/collected_notice_regulation_owner_text_execution.py packages/ingestion-core/src/campus_ingestion_core/collected_notice_regulation_owner_text_recovery_constants.py apps/ingestion-worker/src/campus_ingestion_worker/execute_collected_notice_regulation_owner_text.py tests/ingestion/test_collected_notice_regulation_owner_text_execution.py tests/ingestion/test_execute_collected_notice_regulation_owner_text_worker.py
uv run --all-packages ruff format --check packages/ingestion-core/src/campus_ingestion_core/collected_notice_regulation_owner_text_execution.py packages/ingestion-core/src/campus_ingestion_core/collected_notice_regulation_owner_text_recovery_constants.py apps/ingestion-worker/src/campus_ingestion_worker/execute_collected_notice_regulation_owner_text.py tests/ingestion/test_collected_notice_regulation_owner_text_execution.py tests/ingestion/test_execute_collected_notice_regulation_owner_text_worker.py
uv run --all-packages python -m campus_ingestion_worker.execute_collected_notice_regulation_owner_text --output-dir .planning/workstreams/collected-notice-consumption-replay-closeout/evidence/phase-06-r1b-regulation-owner-text-recovery-execution/dry-run
uv run --all-packages python -m campus_ingestion_worker.execute_collected_notice_regulation_owner_text --execute
find .planning/workstreams/collected-notice-consumption-replay-closeout/evidence/phase-06-r1b-regulation-owner-text-recovery-execution -name '*.json' -print0 | xargs -0 -n1 jq empty
pnpm exec markdownlint-cli2 ".planning/workstreams/collected-notice-consumption-replay-closeout/phases/phase-06-r1b-regulation-owner-text-recovery-execution/*.md"
git diff --check
```

## Success Criteria

- Dry-run report has `provider_calls_enabled=false`,
  `object_store_writes_enabled=false`, and `planned_count=10`.
- Execute report has `provider_calls_enabled=true`,
  `object_store_writes_enabled=true`, and `db_writes_enabled=false`.
- Each selected attempt either has truthful failure evidence or ready owner text.
- Successful attempts write provider response, owner text, layout elements, and
  searchable merge input to the declared object refs.
- Phase 6R.2 remains a separate rerun/materialization step.
