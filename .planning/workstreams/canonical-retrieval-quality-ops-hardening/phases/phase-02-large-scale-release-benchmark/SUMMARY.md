---
doc_type: phase_summary
status: completed
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 2 Summary: Large-Scale Release Benchmark

## Completed

- Added `campus_evals.retrieval_release_benchmark` report builder.
- Added `campus_evals.retrieval_release_benchmark_cli` for dry-run benchmark reporting.
- Report records document count, chunk count, scaled chunk count, token estimate, scaled token
  estimate, embedding provider call estimate, cache hit/miss estimate, Qdrant step placeholders,
  query latency placeholders and alias publish mutation posture.
- Dry-run mode is non-mutating: Qdrant timings are `not_executed` and `alias_publish.mutated=false`.
- Added schema/CLI tests.

## Verification

```bash
uv run --all-packages python -m unittest tests.evals.retrieval_release_benchmark_suite
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

- Real provider / real Qdrant benchmark evidence still requires explicit credentials and admission.
  This phase only closed the repeatable dry-run harness and report schema.
