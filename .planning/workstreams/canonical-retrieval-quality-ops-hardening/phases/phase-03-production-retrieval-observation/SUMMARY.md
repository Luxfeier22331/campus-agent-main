---
doc_type: phase_summary
status: completed
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 3 Summary: Production Retrieval Observation

## Completed

- Added `build_retrieval_observation_event_sink()` as a durable event seam wrapping sanitized
  retrieval observations under `retrieval.runtime_observation`.
- Kept JSONL observation sink as local/debug sink.
- Confirmed observation sink failures log warning and do not fail the answer path.
- Confirmed indexed lookup backend exceptions emit failed-closed observation before re-raising.
- Extended monitoring backlog classification for `reranker_degraded` and routed it to
  `reranker_gate_review`.
- Preserved privacy default: raw query text is absent unless explicitly requested.

## Verification

```bash
uv run --all-packages python -m unittest \
  tests.retrieval.retrieval_service_replan_execution_suite \
  tests.evals.retrieval_monitoring_suite
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

- The durable seam is implemented as an injected event emitter. Production storage / OTel exporter
  rollout remains a deployment/integration task, not a retrieval-core contract gap.
