---
doc_type: state
status: completed
workstream: regulation-rag-release-lane
created: 2026-05-02
updated: 2026-05-03
---

<!-- markdownlint-disable MD013 -->

# Regulation RAG Release Lane State

## Current Position

**Status:** Completed
**Current Phase:** Phase 15 institutional release baseline gate completed
**Last Activity:** 2026-05-03
**Last Activity Description:** 42 school-level `institutional_rules` were
quality-checked, admitted, embedded, indexed and published through the release
lane. The 12 re-admitted documents were written to object storage/operator
registry, the real 42-doc registry-scope chunk preparation passed, release
admission was written, 42 release candidates were processed, and all 42 reached
`serving_published`. Alias `institutional_rules` now points to
`institutional_rules__r20260503_111156_686885_6ce8d197` with 1747 points.
Phase 13 fixed the 3 golden retrieval strategy gaps; release-gate live retrieval
45 cases and golden retrieval 89 cases now both pass with `doc_hit@1=1.0`,
`doc_recall@5=1.0` and `forbidden_hit_rate=0.0`. Phase 14 proved answer-level
and supervisor product-path consumption: answer-quality passed 42/42 cases, and
`rag_delegate_institutional_rules` product-path smoke returned a grounded
answer with 3 `institutional_rules` sources under restricted campus-member
authorization. Phase 15 added and ran the
`institutional-rules-release-baseline` eval gate, combining release retrieval,
golden retrieval, answer-quality, Qdrant no-hit and supervisor product-path
checks into one release/manual baseline; the gate passed 5/5 checks.

## Progress

**Phases Complete:** 15
**Current Plan:** Keep this lane closed unless a new regulation query-enabled
surface is explicitly admitted, a release-policy drift appears, or the 42-doc
institutional retrieval/golden/answer/product-path baseline regresses.

## Current Slice

Phase 15 institutional release baseline gate is completed:

- `scripts.eval_gate accept --profile institutional-rules-release-baseline` now
  runs the institutional release baseline as one repo-owned gate.
- The gate verifies release retrieval qrels, golden retrieval qrels,
  institutional answer-quality contract, Qdrant no-hit policy suite and
  `rag_delegate_institutional_rules` product-path smoke.
- The gate is not GitHub workflow dispatchable by default because it requires
  Qdrant, embedding env and local supervisor product-path smoke runtime.
- Real gate evidence passed 5/5 checks: release retrieval 45 cases,
  golden retrieval 89 cases, answer-quality 42 cases, no-hit suite and
  product-path smoke.
- This phase does not admit new regulations or change the serving alias.

Phase 14 institutional answer and product-path acceptance is completed:

- Deterministic answer-quality contract passed across 42 institutional answer
  cases with 42 passed and 0 failed.
- `rag_delegate_institutional_rules` was added to the supervisor process smoke
  profiles and retrieval profiles.
- The institutional product-path smoke request now uses restricted
  campus-member retrieval authorization:
  `entitlement_groups=["campus_members"]`, `visibility_level="restricted"` and
  `visibility_scope="campus"`.
- Product-path smoke passed with answer HTTP 200, answer status `completed`,
  semantic outcome `grounded_answer`, resolved collection `institutional_rules`
  and 3 retrieved sources.
- The smoke explicitly treats `retrieval_failed` and `"status": "no_answer"` as
  forbidden body tokens for this positive path.
- This phase does not admit `scoped_rules`, annual/cohort rules or college-level
  rules to default query-serving.

Phase 13 institutional golden retrieval quality follow-up is completed:

- `backend_qdrant_no_hit_policy.py` now supports the institutional title alias
  `助教/助研/助管 -> 三助`, so
  `研究生助教助研助管工作应该依据哪份管理办法？` retrieves
  `中央民族大学研究生“三助”工作管理办法`.
- Institutional scope-membership questions that name annual/cohort implementation
  rules now fail closed instead of returning adjacent current school-level
  management rules.
- Institutional scope-membership questions that name college-level implementation
  rules now fail closed instead of returning adjacent current school-level rules.
- Release-gate live retrieval passed across 45 cases with `doc_hit@1=1.0`,
  `doc_hit@3=1.0`, `doc_recall@5=1.0` and `forbidden_hit_rate=0.0`.
- Golden retrieval passed across 89 cases with `doc_hit@1=1.0`,
  `doc_hit@3=1.0`, `doc_recall@5=1.0` and `forbidden_hit_rate=0.0`.
- The three Phase 12 golden gaps are now closed without opening `scoped_rules` or
  annual/cohort rules to default `institutional_rules` consumption.

Phase 12 institutional 42 quality and release proved:

- 42校级 `regulations/institutional_rules` are covered by quality evidence:
  30 prior Phase 9 released documents plus 12 selected school-level re-admitted
  documents.
- The 12 re-admitted documents were transformed from scoped evidence into
  institutional-scope `document-units` with institutional document ids,
  `content_kind=institutional_regulation`, `content_role=regulation_*` and
  `promotion_class=formal_regulation`.
- The 12 re-admitted documents produced 437 units and 345 chunks; all chunks use
  `institutional_rules_formal_v1`.
- Combined quality evidence covers 42 documents and 1747 chunks.
- The quality gate passed with no blocking cleaning/chunk issues.
- The 12 re-admitted records were uploaded to object storage and upserted into
  the operator registry.
- Operator registry now exposes 42 releasable institutional records.
- Real registry-scope chunk preparation produced a passed 42-document,
  1747-chunk manifest under preparation run `phase12-institutional-42-release`.
- Release admission was written for 42 documents under admission run
  `phase12-institutional-42-release`.
- 42 release candidates were enqueued; 30 were forced policy replays for already
  published records.
- 42 release candidates were processed; all 42 reached `serving_published`.
- Qdrant alias `institutional_rules` points to
  `institutional_rules__r20260503_111156_686885_6ce8d197` with 1747 points.
- Runtime readiness was rechecked: root `.env` embedding provider settings are
  present and Qdrant `/readyz`, `/livez` and `/collections` returned HTTP 200
  with API key.

Phase 11 selected school-level regulation admission proved:

- `retrieval-eval-manifest.v1.json` now anchors 42校级
  `regulations/institutional_rules` documents for downstream consumption.
- The 30 Phase 9 released documents keep their existing document ids and version ids.
- 12 selected school-level regulations from the scoped holding set are explicitly
  re-admitted under regenerated `regulations/institutional_rules` document ids.
- Re-admitted document `version_id` and `semantic_content_hash` are aligned to
  Phase 42 v9 `document-units.jsonl` chunk-preparation evidence, while document
  ids are regenerated under the institutional semantic scope.
- `institutional_rules_retrieval_qrels.json` and
  `institutional_rules_release_acceptance.v1.json` now each carry 42 title-exact
  cases plus semantic, authz-deny and no-hit guards.
- `institutional_rules_golden_retrieval_qrels.v1.json` now carries 89
  regression-locked cases: 84 positive consumption cases and 5 hard-negative /
  no-hit guards.
- `institutional_rules_answer_quality_cases.v1.json` now covers all 42校级
  institutional titles.
- `中央民族大学2026届推荐应届本科毕业生免试攻读硕士学位研究生实施办法`
  remains excluded as an annual/cohort-specific scoped rule.
- This phase does not claim a new live alias publish or live retrieval run for
  the expanded 42-document set; that requires a separate release/benchmark run.

Phase 10 institutional RAG consumption acceptance proved:

- `institutional_rules_retrieval_qrels.json` now covers all 30 released校级
  institutional titles, plus one semantic release-gate case, one authz-deny
  guard and one no-hit guard
- `retrieval-eval-manifest.v1.json` now anchors all 30 released document ids,
  current version ids, titles and restricted campus-member visibility metadata
- live retrieval against alias `institutional_rules` returned `doc_hit@1=1.0`,
  `doc_hit@3=1.0` and `forbidden_hit_rate=0.0` across 33 cases
- the authz-deny and no-hit cases returned no retrieved sources as expected
- answer-quality contract now supports required/forbidden source title and URL
  identity checks
- institutional answer-consumption evidence passed 3 deterministic cases and
  rejects `scoped_rules` reader paths / scoped-rule promotion URLs as acceptable
  institutional evidence
- qdrant client compatibility was fixed for release guard `get_collection`
  calls on versions that reject `timeout` as an unknown keyword argument

Phase 9 institutional 30 release evidence proved:

- the operator registry contains 30 releasable current `regulations/institutional_rules`
  records
- reader publish, chunk preparation and release admission were generated for the
  full current institutional scope
- chunk preparation produced 30 documents and 1402 chunks
- the first processor replay correctly failed closed because the release-gate
  fixture still locked two case `expected_version_ids` to pre-cleaning hashes
- after refreshing `institutional_rules_release_acceptance.v1.json` and
  `institutional_rules_retrieval_qrels.json` to the current operator registry
  version ids, the processor published one collection-scope release and copied
  terminal status to all 30 candidates
- final alias target is `institutional_rules__r20260503_040442_379305_7ac37b80`
  with 1402 points
- final selected candidate status is 30 `serving_published`; preparation,
  indexing and verification statuses are all completed/passed for the selected
  candidate set
- `scoped_rules` remains outside default query-serving

Earlier Phase 7 Phase 13 backfill release evidence proved:

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
- unchanged `serving_published` candidates can be force-reenqueued only through
  the explicit release-policy replay path; the replay stays auditable with
  `candidate_reason=forced_release_policy_reenqueue`

Phase 8 closeout evidence proved:

- suspect alias `institutional_rules__r20260502_020250_873774_266f68e9` was
  contained with expected-current alias matching
- reader assets, chunk preparation and release admission were generated for the
  two current `institutional_rules` documents
- the two unchanged `serving_published` candidates were force-reenqueued and then
  processed through `campus-ingestion-process-regulation-rag-release-candidates`
- final alias target is `institutional_rules__r20260502_030502_882844_ba991c97`
  with 79 points
- final candidate store status is 2 `institutional_rules:serving_published` and
  8 `scoped_rules:not_query_enabled`

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
- Forced reenqueue is an operator replay control for policy/admission gate changes;
  it must not be used as a normal incremental update bypass or to skip release
  admission.
- 校级 `institutional_rules` is the only regulation notice-derived scope currently
  admitted to default RAG query-serving;院级 `scoped_rules` remains excluded from
  document-site/RAG default consumption until separately admitted.

## Verification

- Phase 15 institutional release baseline gate evidence:

  - `./evidence/phase-15-institutional-release-baseline-gate/institutional-rules-release-baseline-gate.json`
  - `./evidence/phase-15-institutional-release-baseline-gate/retrieval-live-run.json`
  - `./evidence/phase-15-institutional-release-baseline-gate/golden-retrieval-live-run.json`
  - `./evidence/phase-15-institutional-release-baseline-gate/answer-quality-contract/profile-report.json`
  - `./evidence/phase-15-institutional-release-baseline-gate/product-path-smoke/process-smoke-summary.json`

- Phase 15 focused verification:

  ```bash
  uv run --all-packages python -m scripts.eval_gate accept \
    --profile institutional-rules-release-baseline \
    --observations-path .planning/workstreams/regulation-rag-release-lane/evidence/phase-14-institutional-answer-and-product-path-acceptance/institutional-answer-quality-observations.json \
    --output-dir .planning/workstreams/regulation-rag-release-lane/evidence/phase-15-institutional-release-baseline-gate \
    --json
  ```

- Phase 14 institutional answer and product-path acceptance evidence:

  - `./evidence/phase-14-institutional-answer-and-product-path-acceptance/institutional-answer-quality-observations.json`
  - `./evidence/phase-14-institutional-answer-and-product-path-acceptance/answer-quality-contract/profile-report.json`
  - `./evidence/phase-14-institutional-answer-and-product-path-acceptance/product-path-smoke/process-smoke-summary.json`

- Phase 14 focused verification:

  ```bash
  uv run --all-packages python -m campus_evals.answer_quality_contract accept \
    --cases-path packages/evals/fixtures/institutional_rules_answer_quality_cases.v1.json \
    --observations-path .planning/workstreams/regulation-rag-release-lane/evidence/phase-14-institutional-answer-and-product-path-acceptance/institutional-answer-quality-observations.json \
    --output-dir .planning/workstreams/regulation-rag-release-lane/evidence/phase-14-institutional-answer-and-product-path-acceptance/answer-quality-contract \
    --json

  uv run --all-packages python -m scripts.supervisor_runtime_process_smoke \
    --profile rag_delegate_institutional_rules \
    --output-dir .planning/workstreams/regulation-rag-release-lane/evidence/phase-14-institutional-answer-and-product-path-acceptance/product-path-smoke \
    --api-port 27151 \
    --worker-port 27152 \
    --timeout-seconds 90 \
    --startup-timeout-seconds 240

  uv run --all-packages python -m unittest \
    tests.test_supervisor_runtime_process_smoke.SupervisorRuntimeProcessSmokeTest.test_institutional_rules_rag_profile_uses_restricted_campus_auth_projection \
    tests.test_supervisor_runtime_process_smoke.SupervisorRuntimeProcessSmokeTest.test_profiles_select_distinct_answer_payloads_and_expectations \
    tests.test_supervisor_runtime_process_smoke.SupervisorRuntimeProcessSmokeTest.test_rag_delegate_smoke_fails_when_positive_path_returns_no_answer \
    -v

  jq empty \
    .planning/workstreams/regulation-rag-release-lane/evidence/phase-14-institutional-answer-and-product-path-acceptance/institutional-answer-quality-observations.json \
    .planning/workstreams/regulation-rag-release-lane/evidence/phase-14-institutional-answer-and-product-path-acceptance/answer-quality-contract/profile-report.json \
    .planning/workstreams/regulation-rag-release-lane/evidence/phase-14-institutional-answer-and-product-path-acceptance/product-path-smoke/process-smoke-summary.json
  ```

- Phase 13 institutional golden retrieval follow-up evidence:

  - `./evidence/phase-13-institutional-golden-retrieval-quality-follow-up/retrieval-live-run.json`
  - `./evidence/phase-13-institutional-golden-retrieval-quality-follow-up/retrieval-live-summary.json`
  - `./evidence/phase-13-institutional-golden-retrieval-quality-follow-up/golden-retrieval-live-run.json`
  - `./evidence/phase-13-institutional-golden-retrieval-quality-follow-up/golden-retrieval-live-summary.json`

- Phase 13 focused verification:

  ```bash
  uv run --all-packages python -m unittest tests.retrieval.backend_qdrant_no_hit_suite -v

  uv run --all-packages python -m unittest tests.evals.retrieval_benchmark_qrels_module_and_handbook_suite -v

  uv run --all-packages ruff check \
    packages/retrieval-core/src/campus_retrieval_core/backend_qdrant_no_hit_policy.py \
    tests/retrieval/backend_qdrant_no_hit_suite.py

  jq empty \
    .planning/workstreams/regulation-rag-release-lane/evidence/phase-13-institutional-golden-retrieval-quality-follow-up/retrieval-live-run.json \
    .planning/workstreams/regulation-rag-release-lane/evidence/phase-13-institutional-golden-retrieval-quality-follow-up/retrieval-live-summary.json \
    .planning/workstreams/regulation-rag-release-lane/evidence/phase-13-institutional-golden-retrieval-quality-follow-up/golden-retrieval-live-run.json \
    .planning/workstreams/regulation-rag-release-lane/evidence/phase-13-institutional-golden-retrieval-quality-follow-up/golden-retrieval-live-summary.json
  ```

- Phase 13 live retrieval verification:

  ```bash
  uv run --all-packages python -m campus_evals.retrieval_live_benchmark \
    --qrels packages/evals/fixtures/institutional_rules_retrieval_qrels.json \
    --output .planning/workstreams/regulation-rag-release-lane/evidence/phase-13-institutional-golden-retrieval-quality-follow-up/retrieval-live-run.json \
    --format json \
    --top-k 3

  uv run --all-packages python -m campus_evals.retrieval_live_benchmark \
    --qrels packages/evals/fixtures/institutional_rules_golden_retrieval_qrels.v1.json \
    --output .planning/workstreams/regulation-rag-release-lane/evidence/phase-13-institutional-golden-retrieval-quality-follow-up/golden-retrieval-live-run.json \
    --format json \
    --top-k 5
  ```

- Phase 12 institutional 42 quality and release readiness evidence:

  - `./evidence/phase-12-institutional-42-quality-and-release/quality-and-release-readiness.report.json`
  - `./evidence/phase-12-institutional-42-quality-and-release/selected-12-institutional-chunk-prep/validation-summary.json`
  - `./evidence/phase-12-institutional-42-quality-and-release/release-blockers.report.json`
  - `./evidence/phase-12-institutional-42-quality-and-release/operator-registry-admission.report.json`
  - `./evidence/phase-12-institutional-42-quality-and-release/chunk-preparation.report.json`
  - `./evidence/phase-12-institutional-42-quality-and-release/release-admission.report.json`
  - `./evidence/phase-12-institutional-42-quality-and-release/candidate-enqueue.report.json`
  - `./evidence/phase-12-institutional-42-quality-and-release/release-execution-status.report.json`
  - `./evidence/phase-12-institutional-42-quality-and-release/process-release.report.json`
  - `./evidence/phase-12-institutional-42-quality-and-release/runtime-readiness.report.json`
  - `./evidence/phase-12-institutional-42-quality-and-release/retrieval-live-run.json`
  - `./evidence/phase-12-institutional-42-quality-and-release/retrieval-live-summary.json`
  - `./evidence/phase-12-institutional-42-quality-and-release/golden-retrieval-live-run.json`
  - `./evidence/phase-12-institutional-42-quality-and-release/golden-retrieval-live-summary.json`
  - `./evidence/phase-12-institutional-42-quality-and-release/golden-retrieval-gap-analysis.json`

- Phase 12 focused verification:

  ```bash
  jq empty \
    .planning/workstreams/regulation-rag-release-lane/evidence/phase-12-institutional-42-quality-and-release/*.json \
    .planning/workstreams/regulation-rag-release-lane/evidence/phase-12-institutional-42-quality-and-release/selected-12-institutional-chunk-prep/*.json

  uv run --all-packages python -m unittest \
    tests.ingestion.test_internal_notice_institutional_regulation_chunk_prep \
    tests.ingestion.test_regulation_chunk_quality \
    tests.evals.retrieval_benchmark_qrels_module_and_handbook_suite \
    tests.evals.answer_quality_contract_suite \
    tests.ingestion.test_index_release_acceptance \
    -v
  ```

- Phase 12 live retrieval verification:

  ```bash
  uv run --all-packages python -m campus_evals.retrieval_live_benchmark \
    --qrels packages/evals/fixtures/institutional_rules_retrieval_qrels.json \
    --output .planning/workstreams/regulation-rag-release-lane/evidence/phase-12-institutional-42-quality-and-release/retrieval-live-run.json \
    --format json \
    --top-k 3

  uv run --all-packages python -m campus_evals.retrieval_live_benchmark \
    --qrels packages/evals/fixtures/institutional_rules_golden_retrieval_qrels.v1.json \
    --output .planning/workstreams/regulation-rag-release-lane/evidence/phase-12-institutional-42-quality-and-release/golden-retrieval-live-run.json \
    --format json \
    --top-k 5
  ```

- Phase 11 selected school-level regulation admission evidence:

  - `./evidence/phase-11-selected-school-level-regulation-admission/selected-school-level-regulation-admission.report.json`

- Phase 11 focused verification:

  ```bash
  jq empty \
    configs/ingestion/regulations/institutional_rules/retrieval-eval-manifest.v1.json \
    packages/evals/fixtures/institutional_rules_retrieval_qrels.json \
    packages/evals/fixtures/institutional_rules_release_acceptance.v1.json \
    packages/evals/fixtures/institutional_rules_golden_retrieval_qrels.v1.json \
    packages/evals/fixtures/institutional_rules_answer_quality_cases.v1.json \
    .planning/workstreams/regulation-rag-release-lane/evidence/phase-11-selected-school-level-regulation-admission/selected-school-level-regulation-admission.report.json

  uv run --all-packages python -m unittest \
    tests.ingestion.test_regulation_chunk_quality \
    tests.evals.retrieval_benchmark_qrels_module_and_handbook_suite \
    tests.evals.answer_quality_contract_suite \
    tests.ingestion.test_index_release_acceptance \
    -v
  ```

- Phase 10 institutional RAG consumption evidence:

  - `./evidence/phase-10-institutional-rag-consumption/retrieval-live-run.json`
  - `./evidence/phase-10-institutional-rag-consumption/retrieval-benchmark-summary.json`
  - `./evidence/phase-10-institutional-rag-consumption/institutional-answer-quality-observations.json`
  - `./evidence/phase-10-institutional-rag-consumption/answer-quality-contract/profile-report.json`

- Phase 10 focused verification:

  ```bash
  uv run --all-packages python -m campus_evals.retrieval_live_benchmark \
    --qrels packages/evals/fixtures/institutional_rules_retrieval_qrels.json \
    --output .planning/workstreams/regulation-rag-release-lane/evidence/phase-10-institutional-rag-consumption/retrieval-live-run.json \
    --format json \
    --top-k 3

  uv run --all-packages python -m campus_evals.answer_quality_contract accept \
    --cases-path packages/evals/fixtures/institutional_rules_answer_quality_cases.v1.json \
    --observations-path .planning/workstreams/regulation-rag-release-lane/evidence/phase-10-institutional-rag-consumption/institutional-answer-quality-observations.json \
    --output-dir .planning/workstreams/regulation-rag-release-lane/evidence/phase-10-institutional-rag-consumption/answer-quality-contract \
    --json
  ```

- Phase 9 institutional 30 release evidence:

  - `./evidence/phase-09-institutional-30-release/institutional-reader-publish-report.json`
  - `./evidence/phase-09-institutional-30-release/chunk-preparation.report.json`
  - `./evidence/phase-09-institutional-30-release/release-admission.report.json`
  - `./evidence/phase-09-institutional-30-release/institutional-force-reenqueue-report.json`
  - `./evidence/phase-09-institutional-30-release/institutional-process-release-report.json`
  - `./evidence/phase-09-institutional-30-release/institutional-force-reenqueue-after-acceptance-refresh-report.json`
  - `./evidence/phase-09-institutional-30-release/institutional-process-release-after-acceptance-refresh-report.json`
  - `./evidence/phase-09-institutional-30-release/institutional-final-candidate-alias-state.json`

- Phase 9 focused verification:

  ```bash
  jq empty \
    packages/evals/fixtures/institutional_rules_release_acceptance.v1.json \
    packages/evals/fixtures/institutional_rules_retrieval_qrels.json \
    .planning/workstreams/regulation-rag-release-lane/evidence/phase-09-institutional-30-release/*.json

  uv run --all-packages python -m unittest \
    tests.ingestion.test_admit_regulation_rag_release_worker \
    tests.ingestion.test_process_regulation_rag_release_candidates_worker \
    tests.ingestion.test_index_release_acceptance \
    tests.evals.retrieval_benchmark_qrels_module_and_handbook_suite \
    -v
  ```

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

  Runtime closeout evidence:

  - `./evidence/phase-08-release-admission-hardening/suspect-release-containment-report.json`
  - `./evidence/phase-08-release-admission-hardening/institutional-reader-publish-report.json`
  - `./evidence/phase-08-release-admission-hardening/institutional-chunk-preparation-report.json`
  - `./evidence/phase-08-release-admission-hardening/institutional-release-admission-report.json`
  - `./evidence/phase-08-release-admission-hardening/institutional-force-reenqueue-report.json`
  - `./evidence/phase-08-release-admission-hardening/institutional-process-forced-candidates-report.json`
  - `./evidence/phase-08-release-admission-hardening/institutional-final-candidate-alias-state.json`

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

**Stopped At:** Phase 10 institutional RAG consumption acceptance completed.
Reopen only for new admitted regulation query-serving scope, release-policy
drift, candidate lifecycle drift, alias/acceptance regression or product-path
runtime E2E admission.
**Resume File:** `./phases/phase-10-institutional-rag-consumption/PLAN.md`
