---
doc_type: phase_plan
phase: "9"
phase_name: "First-Batch Regulation Promotion Write Gate"
status: planned
created: 2026-04-30
updated: 2026-04-30
---

# Phase 9 Plan

## Objective

Promote the first eight collected-notice regulation candidates from no-write
offline preparation into selected target materialization for
`regulations/institutional_rules` and `regulations/scoped_rules`, while keeping
query serving and RAG release closed.

## Why This Phase Exists

Collected-notice Phase 6R proved that eight regulation candidates are ready for
downstream target consumption, but the closeout intentionally stopped at
`write_enabled=false`. This phase creates the missing write gate between proven
dry-run evidence and real target canonical artifacts.

Without this phase, the repo has quality evidence but no controlled promotion
boundary for the admitted cohort. With this phase, the repo can safely materialize
the first batch without reopening broad replay or leaking unfinished candidates.

## Locked Inputs

- selected source ids:
  - institutional: `594`
  - scoped: `483`, `485`, `487`, `493`, `509`, `564`, `620`
- upstream evidence:
  - Phase 6R.1 candidate audit
  - Phase 6R.3 normalized dry-run materialization
  - Phase 6R.3 consistency report
  - Phase 7 acceptance summary
- existing target state:
  - previous closeout target split: `institutional_rules=2`, `scoped_rules=9`
- non-selected rows:
  - `32` `needs_multimodal`
  - `2` `manual_review`

## Implementation Tasks

### 1. Freeze First-Batch Admission Artifact

Create a Phase 9 selected admission artifact from Phase 6R evidence.

Requirements:

- Include the eight selected source ids, target collection, target document id,
  owner-text status, source object refs, and evidence refs.
- Assert each selected row is `downstream_admitted`.
- Assert every selected row has `owner_text_status=ready`.
- Assert the Phase 6R.3 consistency report has `verdict=passed`.
- Assert no selected id comes from `needs_multimodal` or `manual_review`.

Deliverables:

- `evidence/phase-09-first-batch-regulation-promotion-write-gate/first-batch-selection.json`
- `evidence/phase-09-first-batch-regulation-promotion-write-gate/admission-preflight-report.json`

### 2. Add Selected Promotion Write Guard

Implement or adapt a worker/core path that can promote only the selected eight
documents.

Requirements:

- Default mode remains dry-run.
- Execute mode requires an explicit flag.
- Execute mode refuses to run unless:
  - selected ids exactly match the preflight artifact or an explicit selection
    file,
  - dry-run evidence proves `query_serving_opened=false` and
    `rag_release_opened=false`,
  - selected target ids do not collide unexpectedly with existing target
    registry rows,
  - object-store source refs are readable.
- Whole-scope replace is forbidden for this phase.
- Existing target rows outside the selected target ids must be preserved.

Likely write areas:

- `packages/ingestion-core/src/campus_ingestion_core/collected_notice_regulation_materialization_preview.py`
- `packages/ingestion-core/src/campus_ingestion_core/internal_notice_target_materialization_refresh.py`
- new or existing ingestion-worker CLI under `apps/ingestion-worker/src/campus_ingestion_worker/`
- focused tests under `tests/ingestion/`

### 3. Execute Selected Target Materialization

Run the selected write path against the eight admitted candidates.

Requirements:

- Write canonical target documents and related object-store artifacts only for
  the selected identities.
- Preserve existing institutional/scoped target rows from the previous closeout.
- Produce a before/after registry snapshot.
- Record created/updated document ids by target collection.
- Keep `query_serving_opened=false`.
- Keep `rag_release_opened=false`.

Deliverables:

- `materialization-preflight.snapshot.json`
- `materialization.execute.json`
- `materialization-postflight.snapshot.json`
- `source-to-target-provenance-trace.json`

### 4. Run Target-Side Acceptance For The New Cohort

Run chunk-prep / validation acceptance for the eight selected target documents.

Requirements:

- Institutional lane covers `594`.
- Scoped lane covers the seven scoped ids.
- Fail-close counters for wrapper leakage, identity/provenance, title/version,
  and contextualization must be zero or explicitly bounded.
- Existing prior target rows must not be invalidated by the selected import.

Deliverables:

- `acceptance/institutional_rules/chunk-prep-manifest.json`
- `acceptance/institutional_rules/validation-summary.json`
- `acceptance/institutional_rules/document-reports.jsonl`
- `acceptance/scoped_rules/chunk-prep-manifest.json`
- `acceptance/scoped_rules/validation-summary.json`
- `acceptance/scoped_rules/document-reports.jsonl`

### 5. Publish Offline Reader Artifacts Without Opening Query Serving

If document-reader artifact generation is required for this target layer, publish
offline/gated reader assets only.

Requirements:

- Document-reader assets may be generated for offline/gated review.
- Docs read-model import may be run only if it is scoped to the selected target
  snapshot and remains gated.
- Public query-serving, public-chat citation, RAG release, Qdrant alias, and
  runtime capability opening remain closed.

Deliverables:

- `reader-assets-report.json` or explicit `reader-assets-skipped-report.json`
- `serving-closed-assertion.json`

### 6. Closeout And Reopen Rule Update

Update planning truth after successful execution.

Requirements:

- Record the new first-batch target counts and selected ids.
- Record remaining blocked counts: `32 needs_multimodal`, `2 manual_review`.
- Keep workstream stop point explicit: target materialization / offline reader
  preparation only, no query serving.
- Define reopen rule for the next regulation batch.

Deliverables:

- `SUMMARY.md`
- updated `README.md`
- updated `ROADMAP.md`
- updated `STATE.md`
- updated `.planning/WORKSTREAMS.md`

## Verification Matrix

Run focused verification before claiming completion:

- selection/preflight tests:
  - new tests for exact selected-id matching, rejected unadmitted ids, rejected
    stale dry-run evidence, and collision handling.
- materialization tests:
  - selected write preserves unselected target registry rows.
  - selected write records source provenance and target identity.
  - whole-scope replacement cannot be triggered by Phase 9 worker.
- acceptance tests:
  - `uv run --all-packages python -m unittest tests.ingestion.test_internal_notice_institutional_regulation_chunk_prep`
  - `uv run --all-packages python -m unittest tests.ingestion.test_internal_notice_scoped_rule_chunk_prep`
  - `uv run --all-packages python -m unittest tests.ingestion.test_prepare_institutional_regulation_chunks_worker`
  - `uv run --all-packages python -m unittest tests.ingestion.test_prepare_scoped_rule_chunks_worker`
- docs/planning:
  - `pnpm docs:lint`
  - `git diff --check`

If Python source changes are made:

- `uv run --all-packages ruff check <changed paths>`
- `uv run --all-packages ruff format <changed paths> --check`

## Exit Rule

Phase 9 is complete only when:

- the eight selected regulation candidates have either been materialized or
  explicitly failed with bounded, actionable reasons;
- existing prior target documents are preserved;
- target-side acceptance passes for the selected cohort;
- source-to-target provenance is traceable from selected source ids to target
  document ids and object-store artifacts;
- all non-selected regulation candidates remain blocked/deferred;
- `query_serving_opened=false` and `rag_release_opened=false` remain proven.
