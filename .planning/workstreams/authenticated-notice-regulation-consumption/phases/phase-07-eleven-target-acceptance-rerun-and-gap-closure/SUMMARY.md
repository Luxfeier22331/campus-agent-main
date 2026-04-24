---
doc_type: phase_summary
phase: "7"
phase_name: "Eleven-Target Acceptance Rerun And Gap Closure"
status: completed
completed: 2026-04-24
---

# Phase 7 Summary

## Outcome

Completed the full local-only target-side acceptance rerun for the current `11`
admitted authenticated-notice regulation targets.

Final target split:

- `regulations/institutional_rules`: `2`
- `regulations/scoped_rules`: `9`

Final acceptance artifacts:

- snapshot root: `.tmp/authenticated-notice-regulation-phase07/20260424T064013Z`
- institutional validation:
  `.tmp/authenticated-notice-regulation-phase07/20260424T064013Z/acceptance/institutional_rules/validation-summary.json`
- scoped validation:
  `.tmp/authenticated-notice-regulation-phase07/20260424T064013Z/acceptance/scoped_rules/validation-summary.json`

## Fixes Applied

- Restored the source-truth inventory Postgres facade exports required by live
  promotion/materialization runtime.
- Corrected target registry state by rerunning existing materialization workers:
  `2` institution-wide rules remained in `institutional_rules`; `9`
  annual/time-bound rules moved to `scoped_rules`.
- Removed bare `附件：` from target-side high-confidence wrapper leak markers
  because valid regulation bodies can contain their own attachment/form sections.
- Allowed one-character college names such as `药学院` in scoped rule
  `school_unit_name` extraction.

## Acceptance Results

Institutional lane:

- `passed`: `true`
- `prepared_document_count`: `2`
- `total_unit_count`: `58`
- `total_chunk_count`: `26`
- fail-close counters for title/contextualization/identity/lineage/wrapper/front
  matter: all `0`

Scoped lane:

- `passed`: `true`
- `prepared_document_count`: `9`
- `total_unit_count`: `302`
- `total_chunk_count`: `302`
- fail-close counters for title/contextualization/projection metadata/cycle
  year/school unit/wrapper/front matter: all `0`

## Verification

Passed:

- `uv run --all-packages python -m unittest tests.ingestion.test_internal_notice_institutional_regulation_chunk_prep`
- `uv run --all-packages python -m unittest tests.ingestion.test_internal_notice_scoped_rule_chunk_prep`
- `uv run --all-packages python -m unittest tests.ingestion.test_prepare_institutional_regulation_chunks_worker`
- `uv run --all-packages python -m unittest tests.ingestion.test_prepare_scoped_rule_chunks_worker`
- `uv run --all-packages python -m unittest tests.ingestion.test_authenticated_notice_source_truth_inventory`
- `uv run --all-packages python -m unittest tests.ingestion.internal_notice_scoped_rule_materialization_candidate_suite`

Known residual:

- `tests.ingestion.internal_notice_scoped_rule_materialization_materialize_suite`
  still has stale duplicate-provenance expectations from an older scoped-rule
  contract. Current offline inventory keeps duplicate `191177` in source truth
  rather than adding it to the scoped target provenance set.

## Phase 8 Input

Phase 8 can freeze acceptance evidence from the final rerun above. No embedding,
Qdrant write, release, or alias publish was performed.
