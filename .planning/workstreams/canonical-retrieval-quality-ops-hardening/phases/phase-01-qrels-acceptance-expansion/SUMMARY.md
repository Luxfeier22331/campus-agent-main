---
doc_type: phase_summary
status: completed
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 1 Summary: Qrels And Acceptance Expansion

## Completed

- Added `retrieval_qrels_denominator_policy.v1.json` as machine-checkable qrels denominator
  policy for all default query-enabled scopes.
- Added `campus_evals.retrieval_qrels_policy` to load and validate denominator policy, required
  scenarios, required classes and fixture mappings.
- Removed duplicated hard-coded qrels policy constants from benchmark tuning / registry release
  validation paths.
- Added release acceptance fixtures for `institutional_rules`, `curriculum_plan` and
  `official_web/stable_reference`.
- Extended `student_rules_release_acceptance.v1.json` with an explicit no-hit impossible query.
- Kept default query-enabled qrels coverage fail-closed with `issues 0`.

## Verification

```bash
uv run --all-packages python -m unittest \
  tests.evals.retrieval_qrels_policy_suite \
  tests.evals.retrieval_tuning_suite \
  tests.ingestion.test_index_release_acceptance
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

- The fixtures are still deterministic regression fixtures, not a replacement for a larger golden
  dataset. Runtime observation backlog should continue feeding candidate qrels.
