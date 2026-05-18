---
doc_type: phase_summary
status: completed
workstream: regulation-rag-release-lane
phase: phase-10-institutional-rag-consumption
created: 2026-05-03
updated: 2026-05-03
---
# Phase 10 Summary: Institutional RAG Consumption Acceptance

## Outcome

The 30 released校级 `regulations/institutional_rules` documents are now covered
by downstream RAG consumption acceptance.

Retrieval evidence:

- qrels cases: 33
- title-exact release-gate cases: 30
- semantic release-gate case: 1
- regression guards: authz deny and no-hit
- live retrieval `doc_hit@1`: 1.0
- live retrieval `doc_hit@3`: 1.0
- forbidden hit rate: 0.0

Answer-consumption evidence:

- deterministic answer-quality cases: 3
- passed: 3
- required source identity: institutional reader title and
  `/docs/regulations/institutional_rules/`
- forbidden source identity: `scoped_rules` reader path and
  `campusrag://promotion/internal_notice_scoped_rules/`

## Notes

- This phase does not reopen historical regulation backfill or expand院级
  `scoped_rules` serving.
- Qdrant release guard was fixed to retry `get_collection` without `timeout`
  for qdrant client versions that reject unknown keyword arguments with
  `AssertionError`.
- Answer-quality runtime collection remains a later explicit E2E; this phase
  records deterministic observation-backed consumption acceptance.

## Evidence

- Retrieval live run:
  `../../evidence/phase-10-institutional-rag-consumption/retrieval-live-run.json`
- Retrieval benchmark summary:
  `../../evidence/phase-10-institutional-rag-consumption/retrieval-benchmark-summary.json`
- Answer observations:
  `../../evidence/phase-10-institutional-rag-consumption/institutional-answer-quality-observations.json`
- Answer profile report:
  `../../evidence/phase-10-institutional-rag-consumption/answer-quality-contract/profile-report.json`

## Verification

```bash
uv run --all-packages python -m unittest \
  tests.evals.retrieval_benchmark_qrels_module_and_handbook_suite.RetrievalInstitutionalRulesQrelsFixtureTest \
  tests.evals.answer_quality_contract_suite.AnswerQualityContractSuite \
  -v

uv run --all-packages python -m unittest \
  tests.retrieval.backend_qdrant_release_guard_suite.BackendQdrantReleaseGuardTest.test_release_guard_retries_get_collection_without_timeout_for_older_qdrant_client \
  -v
```
