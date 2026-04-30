---
doc_type: phase_summary
status: completed
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 4 Summary: Reranker Adoption Gate

## Completed

- Added `RerankerAdoptionThresholds`, `RerankerAdoptionGateResult` and
  `evaluate_reranker_adoption_gate()`.
- Gate checks doc hit@1 delta, latency p95 budget, cost per query budget, rerank regression cases
  and forbidden-hit regression.
- Added runtime profile fields:
  - `reranker_enabled_by_default`
  - `reranker_top_n`
  - `reranker_profile_version`
  - `reranker_adoption_evidence_id`
- Runtime profile validation fails closed if reranker is enabled without top-N, profile version and
  adoption evidence id.
- Index release manifest / release metadata payload now record reranker opt-in provenance.
- Release drift guard requires reranker metadata for opt-in profiles and includes reranker identity
  in profile identity hash.
- Retrieval execution only calls reranker when runtime profile opts in. Reranker failure, timeout or
  missing executor falls back to baseline hybrid/RRF evidence and emits `reranker_degraded`
  observation metadata.

## Verification

```bash
uv run --all-packages python -m unittest \
  tests.evals.retrieval_rerank_eval_suite \
  tests.ingestion.test_corpus_runtime_profile \
  tests.ingestion.test_index_release \
  tests.retrieval.backend_qdrant_release_guard_suite \
  tests.retrieval.retrieval_service_replan_execution_suite
```

Later focused workstream gate also covered this phase:

```bash
uv run --all-packages python -m unittest \
  tests.evals.retrieval_qrels_policy_suite \
  tests.evals.retrieval_tuning_suite \
  tests.evals.retrieval_release_benchmark_suite \
  tests.evals.retrieval_monitoring_suite \
  tests.evals.retrieval_rerank_eval_suite \
  tests.ingestion.test_index_release_acceptance \
  tests.ingestion.test_corpus_runtime_profile \
  tests.ingestion.test_index_release \
  tests.retrieval.retrieval_service_replan_execution_suite \
  tests.retrieval.retrieval_service_live_lookup_and_fail_close_suite \
  tests.retrieval.backend_qdrant_release_guard_suite
```

Observed result: `Ran 104 tests ... OK`.

## Remaining Risk

- No collection is enabled for production reranker by default in this phase. Enabling a collection
  still requires deterministic evidence and a deliberate runtime-profile patch.
