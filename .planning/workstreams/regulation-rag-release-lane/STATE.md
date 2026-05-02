---
doc_type: state
status: active
workstream: regulation-rag-release-lane
created: 2026-05-02
updated: 2026-05-02
---

<!-- markdownlint-disable MD013 -->

# Regulation RAG Release Lane State

## Current Position

**Status:** Active
**Current Phase:** Phase 8 release admission hardening
**Last Activity:** 2026-05-02
**Last Activity Description:** Query-enabled regulation release was hardened with
scope-level release admission. The Phase 13 institutional release is now treated
as suspect until a matching `regulation_rag_release_admission.v1` manifest proves
the current canonical, reader, chunk, qrels/eval and authz evidence.

## Progress

**Phases Complete:** 8
**Current Plan:** Phase 8 implementation and containment verification

## Current Slice

Phase 7 Phase 13 backfill release evidence proved:

- Phase 13 materialization report produced 10 RAG release candidates:
  2 `institutional_rules` and 8 `scoped_rules`
- the two current `institutional_rules` candidates shared one collection-scope release,
  but that release is now considered suspect because it reached `serving_published`
  before a scope-level release admission manifest existed
- the eight `scoped_rules` candidates remain `not_query_enabled` because the runtime
  profile is retrieval-ready but not default query-serving
- post-publish audit no longer treats absent Qdrant null payload fields, such as
  `reranker_top_n: null`, as missing required metadata

Phase 8 hardening changes the serving rule:

- query-enabled regulation release requires `regulation_rag_release_admission.v1`
  before chunk preparation, embedding, index release or alias publish
- release executor success must carry admission proof before the candidate processor
  can write `serving_published`
- missing or mismatched admission proof yields `release_admission_blocked`
- suspect release containment must use expected-current alias matching before
  unpublishing or rollback

Phase 6 canary cohort evidence previously proved:

- current `institutional_rules` candidate can proceed through release acceptance and
  serving publish using an attachment-backed owner body canary
- selected `scoped_rules` records represented by the real samples `351907` and
  `186977` are `source-faithful` / non-current and therefore reach
  `held_search_only`
- these historical/search-only scoped-rule candidates stay out of current RAG alias
  without emitting alias cleanup
- source-truth-only negative notice does not create a RAG release candidate
- `187233` is not a current institutional serving canary until the complete
  semantic owner body for `中央民族大学采购工作管理办法` is recovered
- `355282` RAG release/eval identity must use the materialized work-title document
  id `institutional_regulation:muc:中央民族大学关于学生使用人工智能的指导意见:089bcf7907da`

## Decisions Locked

- Document site reader publish and RAG query-serving are independent release lanes.
- Regulation materialization may create `rag_release_candidate`; it must not directly
  change serving alias.
- Materialization only writes candidate store when a store is injected or operator
  candidate-store Postgres env is configured; local fixture replay is not implicitly
  upgraded to production release truth.
- Incremental RAG update requires document identity/hash/profile identity and explicit
  stale cleanup semantics.
- Operator status must split document site, RAG preparation, RAG index, RAG serving
  and RAG verification status.
- Query-enabled regulation RAG serving requires a scope-level release admission
  manifest that exact-matches document identity/version/hash, document-units hash,
  cleaning/chunk/runtime profile identity, reader current version, qrels/eval
  coverage and authz deny evidence.
- `serving_published` without matching admission proof is not accepted release truth;
  it must be contained and replayed after admission.

## Verification

- Phase 7 focused replay and regression evidence:

  ```bash
  uv run --all-packages python -m unittest \
    tests.ingestion.test_registry_scope_release \
    tests.ingestion.test_registry_scope_release_acceptance_wiring \
    tests.ingestion.test_regulation_rag_release_lane \
    tests.ingestion.test_enqueue_regulation_rag_release_candidates_worker \
    tests.ingestion.test_process_regulation_rag_release_candidates_worker \
    tests.evals.retrieval_benchmark_qrels_module_and_handbook_suite \
    -v

  uv run --all-packages campus-ingestion-enqueue-regulation-rag-release-candidates \
    --from-materialization-report <phase-13-materialization-report> \
    --output ./evidence/phase-07-phase13-backfill-release-admission/enqueue-phase13-report.json

  uv run --all-packages campus-ingestion-process-regulation-rag-release-candidates \
    --acceptance-case-path packages/evals/fixtures/institutional_rules_release_acceptance.v1.json
  ```

  Final status evidence:
  `./evidence/phase-07-phase13-backfill-release-admission/candidate-status-after-audit-fix.json`.

- Phase 8 focused hardening command:

  ```bash
  uv run --all-packages python -m unittest \
    tests.ingestion.test_regulation_rag_release_lane \
    tests.ingestion.test_registry_scope_release \
    tests.ingestion.test_process_regulation_rag_release_candidates_worker \
    tests.ingestion.test_release_registry_scope_worker \
    tests.ingestion.test_scope_alias \
    tests.ingestion.test_scope_alias_worker
  ```

- Phase 6 canary focused command:

  ```bash
  uv run --all-packages campus-ingestion-generate-regulation-rag-release-selected-replay

  uv run --all-packages python -m unittest \
    tests.ingestion.test_regulation_rag_release_lane.RegulationRagReleaseLaneTest.test_phase_6_canary_cohort_closeout_states \
    tests.ingestion.test_regulation_rag_release_lane.RegulationRagReleaseLaneTest.test_phase_6_selected_replay_evidence_matches_real_sample_expectations \
    tests.ingestion.test_regulation_rag_release_lane.RegulationRagReleaseLaneTest.test_withdrawn_current_rule_generates_delete_terminal_state \
    -v
  ```

- Core regulation RAG lane focused command:

  ```bash
  uv run --all-packages python -m unittest \
    tests.ingestion.test_regulation_rag_release_lane \
    tests.ingestion.test_process_regulation_rag_release_candidates_worker \
    tests.ingestion.test_authenticated_notice_processing_projection \
    tests.ingestion.test_materialize_internal_notice_regulation_worker \
    tests.ingestion.test_materialize_internal_notice_scoped_rules_worker \
    tests.ingestion.internal_notice_regulation_materialization_gate_suite.InternalNoticeRegulationMaterializationGateTest.test_materialize_uses_projection_truth_without_rebuilding_promotion_manifest \
    tests.ingestion.internal_notice_scoped_rule_materialization_materialize_suite.InternalNoticeScopedRuleMaterializationMaterializeTest.test_materialize_scoped_rules_from_internal_notice_scope \
    -v
  ```

- `pnpm --filter app-api typecheck`
- `pnpm --filter protected-panel-web typecheck`
- `pnpm --filter app-api exec vitest run -c vitest.node.config.mts test/authenticated-notice-processing.service.test.ts`
- `pnpm --filter protected-panel-web run test:worker -- -t "authenticated notice processing"`

Known unrelated dirty-worktree blockers:

- `pnpm --filter app-api test -- authenticated-notice-processing.service.test.ts`
  currently invokes the full app-api node suite and fails in
  `test/shared-database-adoption.test.ts` on
  `official_web.target_selected_write_admissions`, which belongs to another
  active official-web selected-write slice.
- `pnpm --filter protected-panel-web run test:worker -- data-provider.authenticated-notice-processing.suite.ts`
  currently invokes the worker aggregate suite and fails in official-web
  selected-write provider/worker expectations, also outside this RAG lane.

## Session Continuity

**Stopped At:** Phase 8 hardening implemented locally; full lint/commit intentionally
not covered in this slice
**Resume File:** `./phases/phase-08-release-admission-hardening/PLAN.md`
