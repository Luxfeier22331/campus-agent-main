---
doc_type: state
status: completed
created: 2026-04-28
updated: 2026-04-28
workstream: notice-derived-regulation-consumption-quality-gate
---
# State: Notice-Derived Regulation Consumption Quality Gate

<!-- markdownlint-disable MD013 -->

## Current Position

- status: `completed`
- current phase: `Phase 6 completed`
- current phase name: `Acceptance Freeze And Closeout`
- current plan:
  `.planning/workstreams/notice-derived-regulation-consumption-quality-gate/phases/phase-06-acceptance-freeze-and-closeout/PLAN.md`
- total phases: `7`
- progress: `7/7 phases complete`
- last activity: `2026-04-28`
- last activity description: Phase 6 acceptance freeze completed; selected cohort evidence,
  negative `187233` fixture, PG/bucket cleanup references, runbook guardrails, regression
  command set, and bounded reopen rule are frozen.

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

## Phase 4 Evidence

- `document_reader_publisher` rejects unsupported source notice scopes such as
  `campus_notices/internal_notice`.
- `app-api` docs read-model manifest import rejects unsupported source notice scopes with the same
  allowlist.
- Held regulation-like notices remain queryable as internal notice title/url/card rows when their
  target surface is `notice_level_query`.
- `institutional_rules` and `scoped_rules` chunk-prep ignore source notice registry rows and only
  prepare target canonical `regulations/*` records.
- Runbooks now state that document-site/docs read-model/RAG preparation consume target canonical
  records only; held / partial notices stay notice-level query/card material.
- Verification:
  - `uv run --all-packages python -m unittest tests.ingestion.test_internal_notice_read_model tests.ingestion.test_internal_notice_institutional_regulation_chunk_prep tests.ingestion.test_internal_notice_scoped_rule_chunk_prep -v`
  - result: `19 tests OK`
  - `pnpm --filter app-api exec vitest run -c vitest.node.config.mts test/docs.read-model-manifest.test.ts`
  - result: `1 file / 2 tests passed`

## Phase 5 Evidence

- Added `internal_notice_regulation_owner_recovery` report builder.
- Fixed owner lookup order:
  captured attachment -> authenticated file-release -> official-web source -> existing
  `regulations/*` registry.
- Ready rows preserve selected source evidence: source kind, document id, source URI, scope,
  match evidence, and attempted source list.
- Unresolved rows fail closed with `owner_recovery_source_not_found`,
  `source_backed_candidate=false`, `import_eligible=false`, and
  `notice_card_preserved=true`.
- Added worker entry:
  `campus_ingestion_worker.build_internal_notice_regulation_owner_recovery`.
- Runbook now requires owner-recovery before target materialization for held missing-owner cases.
- Verification:
  - `uv run --all-packages python -m unittest tests.ingestion.test_internal_notice_regulation_owner_recovery tests.ingestion.test_build_internal_notice_regulation_owner_recovery_worker -v`
  - result: `5 tests OK`

## Phase 6 Evidence

- Frozen selected cohort artifact:
  `.planning/workstreams/notice-derived-regulation-consumption-quality-gate/phases/phase-02-selected-cohort-audit/evidence/selected-cohort-audit-20260428.json`
- Frozen selected cohort result:
  - requested notice ids: `16`
  - selected projection rows: `1`
  - selected import notice ids: `[]`
  - held notice ids: `["187233"]`
  - missing projection notice ids: `15`
- Frozen negative fixture:
  - `187233`
  - title: `关于修订《中央民族大学采购工作管理办法》的通知`
  - stable reason: `parent_notice_body_not_full_regulation_text`
  - target recommendation: `notice_card_only`
- Frozen cleanup evidence from Phase 0 remains the accepted PG/bucket audit reference for this
  closeout:
  - `regulations/institutional_rules` registry refs: `0`
  - docs document refs: `0`
  - docs reader asset refs: `0`
  - docs search unit refs: `0`
  - matching target bucket refs: `0`
- Frozen dry-run evidence:
  `.tmp/historical-intake/run14-policy-regulation-expanded/document-site-dry-run-187233-rejected-20260428/dry-run-report.json`
- Frozen dry-run verdict:
  - `materialized_document_count=0`
  - `reader_document_count=0`
  - `ready_projection_entry_count=0`
  - `query_serving_opened=false`
  - `rag_release_opened=false`
- No formal regulation import is open for the current selected cohort, because the frozen
  selected cohort contains no import-eligible notice ids.
- Real public/docs/RAG entrance validation is intentionally handed off; this workstream only
  freezes offline-preparation quality gate acceptance.

## Current Slice

Closed. The quality gate can be resumed from the frozen artifacts above. Product-path opening,
real public-chat/docs entry E2E, or future accepted regulation imports must use a new or reopened
workstream under the reopen rule.

## Boundaries To Preserve

- Do not reopen generic `notice-consumption-layer`.
- Do not treat `regulation_candidate` rough route as target admission.
- Do not import partial amendment summaries into `regulations/institutional_rules`.
- Do not delete source-truth notice records during target cleanup.
- Do not use LLM rewrite to create missing regulation body.

## Blockers

- None.

## Verification Status

- Regression tests for negative `187233`-style amendment summary are green.
- `187233` selected dry-run confirms no target document is materialized.
- PG and bucket cleanup verified locally on 2026-04-28.
- Phase 1 regression and aggregate tests passed locally on 2026-04-28.
- Phase 2 selected cohort audit tests and real PG-backed audit passed locally on 2026-04-28.
- Phase 3 target materialization regression tests passed locally on 2026-04-28.
- Phase 4 docs/RAG consumption contract tests passed locally on 2026-04-28.
- Phase 5 owner-recovery tests passed locally on 2026-04-28.
- Phase 6 closeout verification passed locally on 2026-04-28:
  - owner-recovery `ruff check`: `All checks passed!`
  - owner-recovery `ruff format --check`: `4 files already formatted`
  - targeted ingestion unittest set: `30 tests OK`
  - app-api docs read-model manifest test: `1 file / 2 tests passed`
  - `pnpm docs:lint`: `Summary: 0 error(s)`
  - `git diff --check`: passed

## Resume Instructions

This workstream is completed. Reopen only under the bounded reopen rule in `ROADMAP.md`.

If reopened, start with:

```bash
uv run --all-packages python -m scripts.workstream_harness codex shell \
  notice-derived-regulation-consumption-quality-gate
```

Then read:

```bash
sed -n '1,260p' \
  .planning/workstreams/notice-derived-regulation-consumption-quality-gate/phases/phase-06-acceptance-freeze-and-closeout/PLAN.md
```
