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
- current phase: `Phase 7 completed`
- current phase name: `Docs-Only Gated Reader Opening Closeout`
- current plan:
  `.planning/workstreams/notice-derived-regulation-consumption-quality-gate/phases/phase-07-docs-only-gated-reader-opening-closeout/PLAN.md`
- total phases: `8`
- progress: `8/8 phases complete`
- last activity: `2026-04-28`
- last activity description: Phase 7 docs-only gated reader opening closeout completed for
  selected notice `354006`; dry-run, formal import, docs read-model import, public-docs build,
  collection fallback, and staging smoke blocker evidence are frozen.

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

## Phase 7 Evidence

- Selected notice:
  - `354006`
  - title:
    `中央民族大学中华民族共同体学院 2026年“英才计划”硕博连读研究生招生实施细则`
  - target scope: `regulations/scoped_rules`
  - delivery mode: `gated_asset`
- Closeout evidence summary:
  `.planning/workstreams/notice-derived-regulation-consumption-quality-gate/evidence/phase-07-docs-only-gated-reader-opening-closeout/closeout-evidence.json`
- Selected dry-run:
  `.tmp/regulation-docs-opening-354006/document-site-dry-run-closeout/dry-run-report.json`
  - `materialized_document_count=1`
  - `regulations/institutional_rules=0`
  - `regulations/scoped_rules=1`
  - `ready_projection_entry_count=1`
  - `reader_document_count=1`
  - `gated_entry_count=1`
  - `query_serving_opened=false`
  - `rag_release_opened=false`
- Formal import:
  `.tmp/regulation-docs-opening-354006/document-site-publish-closeout/publish-report.json`
  - `docs_only_opened=true`
  - `materialized_document_count=1`
  - docs read-model import result:
    `collections=1`, `documents=1`, `readerAssets=1`, `searchUnits=1`
  - `query_serving_opened=false`
  - `rag_release_opened=false`
- Public-docs sync/build:
  - sync manifest:
    `.tmp/regulation-docs-opening-354006/public-docs-sync-closeout.json`
  - sync manifest entries: `117`
  - gated entries: `2`
  - public entries: `115`
  - generated local asset:
    `apps/public-docs/doc_build/_gated-docs/regulations/scoped_rules/中央民族大学中华民族共同体学院-2026年-英才计划-硕博连读研究生招生实施细则/2026-current/reader.json`
  - `build:published-reader-assets` copied:
    `copiedAssetCount=468`, `copiedDocumentCount=117`,
    `copiedGatedDocumentCount=2`, `copiedPublicDocumentCount=115`
- Staging smoke attempt:
  - command:
    `pnpm --dir apps/app-api docs:gated:smoke:staging -- --gated-reader-path /_gated-docs/regulations/scoped_rules/中央民族大学中华民族共同体学院-2026年-英才计划-硕博连读研究生招生实施细则/2026-current/reader.json --gated-collection-navigation-path /api/docs/collections/regulations/scoped_rules/navigation`
  - result: blocked before docs assertions
  - blocker: staging app-api `/readyz` returned `503` because supervisor readiness probe
    returned `503`
  - handoff: resume real staging/browser acceptance after staging supervisor readiness is restored

## Current Slice

Closed. The quality gate and first docs-only gated reader opening can be resumed from the frozen
artifacts above. Product-path RAG/query-serving/public-chat opening, live staging acceptance after
runtime readiness recovery, or future accepted regulation imports must use a new or reopened
workstream under the reopen rule.

## Boundaries To Preserve

- Do not reopen generic `notice-consumption-layer`.
- Do not treat `regulation_candidate` rough route as target admission.
- Do not import partial amendment summaries into `regulations/institutional_rules`.
- Do not delete source-truth notice records during target cleanup.
- Do not use LLM rewrite to create missing regulation body.

## Blockers

- None for repo-owned local closeout.
- External handoff: staging app-api `/readyz` currently fails because supervisor readiness returns
  `503`; this blocks live staging gated docs smoke until staging runtime readiness is restored.

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
- Phase 7 local closeout verification on 2026-04-28:
  - app-api docs gated smoke args red/green completed
  - app-api targeted docs tests: `4 files / 16 tests passed`
  - app-api typecheck: passed
  - selected `354006` dry-run: `materialized_document_count=1`
  - selected `354006` formal import: `docs_only_opened=true`
  - public-docs `build:published-reader-assets`: passed; `copiedDocumentCount=117`
  - staging gated docs smoke: blocked by staging supervisor readiness `503`

## Resume Instructions

This workstream is completed. Reopen only under the bounded reopen rule in `ROADMAP.md`.

If reopened, start with:

```bash
gsd-sdk query workstream.set notice-derived-regulation-consumption-quality-gate \
  --raw --cwd "$PWD"
```

Then read:

```bash
sed -n '1,260p' \
  .planning/workstreams/notice-derived-regulation-consumption-quality-gate/phases/phase-07-docs-only-gated-reader-opening-closeout/PLAN.md
```
