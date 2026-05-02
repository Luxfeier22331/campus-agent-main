---
doc_type: phase_plan
phase: "13"
phase_name: "Historical Regulation Canonical Backfill"
status: implemented
created: 2026-05-02
updated: 2026-05-02
---

# Phase 13 Plan

## Objective

Re-materialize already captured historical collected-notice regulation targets
through the current canonical cleaner before any downstream RAG release consumes
them.

The phase is intentionally upstream of chunking and RAG release:

- Phase 9 selected first-batch notices are rebuilt from admission/source owner
  text, not from old dry-run materialization JSON.
- Phase 11 resolved manual-review notices are rebuilt from explicit resolution
  plus owner-text execution report.
- The output is canonical markdown/document-units with current cleaning
  provenance.
- Query serving, RAG release, alias publish and public-chat citation stay closed.

## Locked Inputs

- first-batch candidate audit:
  `.planning/workstreams/collected-notice-consumption-replay-closeout/evidence/phase-06-r1-regulation-candidate-audit-and-admission/regulation-candidate-audit.json`
- first-batch admission manifest:
  `.planning/workstreams/collected-notice-consumption-replay-closeout/evidence/phase-06-r1-regulation-candidate-audit-and-admission/regulation-consumer-admission-manifest.json`
- owner-text execution report:
  `.planning/workstreams/collected-notice-consumption-replay-closeout/evidence/phase-06-r1b-regulation-owner-text-recovery-execution/regulation-owner-text-execution-report.json`
- manual-review resolutions:
  - `481`: `scoped_rules`
  - `619`: `institutional_rules`

## Selected Cohort

- `594` -> `regulations/institutional_rules`
- `483`, `485`, `487`, `493`, `509`, `564`, `620` ->
  `regulations/scoped_rules`
- `481` -> `regulations/scoped_rules`
- `619` -> `regulations/institutional_rules`

## Implementation Tasks

1. Add a reusable canonical backfill builder in `packages/ingestion-core`.
2. Filter first-batch admission manifest by selected notice ids and rebuild
   materialization preview from owner text.
3. Reuse manual-review resolution admission for Phase 11 rows and rebuild
   materialization preview from owner text.
4. Reuse selected materialization write gates so execute mode rejects non-passed
   normalization quality.
5. Expose an ingestion-worker CLI for dry-run and explicit `--execute`.
6. Write Phase 13 evidence under the workstream evidence directory.
7. Keep `query_serving_opened=false` and `rag_release_opened=false`.

## Exit Rule

Phase 13 is complete when:

- selected historical regulation targets have been rebuilt through
  `collected_notice_regulation_canonical_cleaning_v9`;
- document-units carry `normalizer_version`, `cleaning_policy_version`,
  `document_units_schema_version` and `normalization_quality=passed`;
- no selected target is admitted to RAG release from stale canonical artifacts;
- RAG release lane can safely consume only candidates that pass current cleaning
  provenance checks.
