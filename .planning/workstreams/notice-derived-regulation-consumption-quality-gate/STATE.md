---
doc_type: state
status: active
created: 2026-04-28
updated: 2026-04-28
workstream: notice-derived-regulation-consumption-quality-gate
---
# State: Notice-Derived Regulation Consumption Quality Gate

<!-- markdownlint-disable MD013 -->

## Current Position

- status: `active`
- current phase: `Phase 4`
- current phase name: `Docs And RAG Consumption Contract`
- current plan:
  `.planning/workstreams/notice-derived-regulation-consumption-quality-gate/phases/phase-04-docs-and-rag-consumption-contract/PLAN.md`
- total phases: `7`
- progress: `4/7 phases complete`
- last activity: `2026-04-28`
- last activity description: Phase 3 target materialization contract completed; selected zero-candidate
  materialization now removes stale `regulations/*` target rows derived from held notices while
  preserving unrelated target rows.

## Phase 0 Evidence

- `187233` source truth remains in `campus_notices/internal_notice`
- PG projection now has only:
  `notice_level_query|retained_for_notice_query`
- PG counts after cleanup:
  - `regulations/institutional_rules` registry refs: `0`
  - docs document refs: `0`
  - docs reader asset refs: `0`
  - docs search unit refs: `0`
- MinIO refs after cleanup:
  - `campus-rag-derived/regulations/documents/institutional_rules/*采购工作管理办法*`: `0`
  - `campus-rag-derived/_gated-docs/regulations/institutional_rules/*采购工作管理办法*`: `0`
- selected dry-run output:
  `.tmp/historical-intake/run14-policy-regulation-expanded/document-site-dry-run-187233-rejected-20260428/dry-run-report.json`
- dry-run verdict:
  - `materialized_document_count=0`
  - `reader_document_count=0`
  - `ready_projection_entry_count=0`
  - `query_serving_opened=false`
  - `rag_release_opened=false`

## Phase 1 Evidence

- Amendment-summary parent notices with `第一条` / `第二条` references are held in
  `campus_notices/internal_notice`.
- Stable rejection reason:
  `parent_notice_body_not_full_regulation_text`.
- Full embedded regulation bodies, attachment-backed regulation bodies, annual-cycle rules, and
  time-bound scoped rules remain promotable.
- Selected rebuild for an amendment-summary notice removes stale
  `regulations/institutional_rules` ready rows.
- Verification:
  - promotion phase suite: `21 tests OK`
  - promotion + consumption projection aggregate suite: `52 tests OK`
  - targeted `ruff check`: `All checks passed`

## Phase 2 Evidence

- Added projection-backed selected cohort audit module and worker CLI.
- Real selected regulation cohort audit artifact:
  `.planning/workstreams/notice-derived-regulation-consumption-quality-gate/phases/phase-02-selected-cohort-audit/evidence/selected-cohort-audit-20260428.json`
- Selected request size: `16`.
- Current projection audit:
  - `row_count=1`
  - `classification_counts={"amendment_summary_only": 1}`
  - `selected_import_notice_ids=[]`
  - `held_notice_ids=["187233"]`
  - remaining `15` selected ids are explicit `missing_projection_notice_ids`
- `187233` reason:
  `parent_notice_body_not_full_regulation_text`.

## Phase 3 Evidence

- `institutional_rules` and `scoped_rules` materializers read existing
  `notice_consumption_projection` ready truth only.
- Held selected notices no longer leave stale target rows in `regulations/institutional_rules`
  or `regulations/scoped_rules`.
- Selected zero-candidate cleanup uses target `document-units` provenance metadata:
  `source_notice_ids`, `source_document_ids`, source notice document ids, parent document ids,
  attachment document ids, and semantic owner document ids.
- Unrelated target scope rows are preserved during selected cleanup.
- Verification:
  - `uv run --all-packages python -m unittest tests.ingestion.test_internal_notice_regulation_materialization tests.ingestion.test_internal_notice_scoped_rule_materialization -v`
  - result: `19 tests OK`

## Current Slice

Phase 4 must define the docs/RAG consumption contract: only target canonical regulation documents
feed document-site/docs read-model/RAG preparation; partial or held notices remain notice-level
query/card material.

## Boundaries To Preserve

- Do not reopen generic `notice-consumption-layer`.
- Do not treat `regulation_candidate` rough route as target admission.
- Do not import partial amendment summaries into `regulations/institutional_rules`.
- Do not delete source-truth notice records during target cleanup.
- Do not use LLM rewrite to create missing regulation body.

## Blockers

- None for Phase 1.
- None for Phase 3 planning.

## Verification Status

- Regression tests for negative `187233`-style amendment summary are green.
- `187233` selected dry-run confirms no target document is materialized.
- PG and bucket cleanup verified locally on 2026-04-28.
- Phase 1 regression and aggregate tests passed locally on 2026-04-28.
- Phase 2 selected cohort audit tests and real PG-backed audit passed locally on 2026-04-28.
- Phase 3 target materialization regression tests passed locally on 2026-04-28.

## Resume Instructions

Start with Phase 4:

```bash
uv run --all-packages python -m scripts.workstream_harness codex shell \
  notice-derived-regulation-consumption-quality-gate
```

Then read:

```bash
sed -n '1,260p' \
  .planning/workstreams/notice-derived-regulation-consumption-quality-gate/phases/phase-04-docs-and-rag-consumption-contract/PLAN.md
```
