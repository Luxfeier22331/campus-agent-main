---
doc_type: phase_summary
status: completed
created: 2026-05-04
updated: 2026-05-04
---

<!-- markdownlint-disable MD013 -->

# Phase 5 Summary: RAG Eval Denominator And Regression Gates

## Status

Completed in current worktree.

## Implemented

- RAGAS diagnostic small-sample manifest now covers all current admitted RAG surfaces:
  `regulations/student_rules`, `regulations/institutional_rules`,
  `curriculum/curriculum_plan` and `official_web/stable_reference`.
- `official_web/fresh_news` remains excluded from the current RAG denominator.
- RAGAS diagnostic failure attribution now distinguishes:
  `retrieval` when the expected doc was never retrieved,
  `evidence_selection` when raw retrieval had the expected doc but selected supporting evidence did
  not, and `synthesis` when selected evidence contained the expected doc but answer quality was low.
- Diagnostic report cases expose raw retrieved doc ids separately from selected support doc ids.
- CLI diagnostic tests now patch the retrieval backend so local Qdrant/release metadata drift does
  not make the diagnostic wiring test depend on external state.

## Files Changed

- `packages/evals/src/campus_evals/ragas_diagnostic_runner.py`
- `tests/evals/ragas_diagnostic_runner_suite.py`

## Verification Evidence

```bash
uv run --all-packages python -m unittest \
  tests.evals.ragas_diagnostic_runner_suite \
  tests.evals.ragas_runtime_scorer_defaults_suite \
  tests.evals.ragas_runtime_scorer_suite \
  tests.evals.ragas_runtime_http_transport_async_suite \
  tests.evals.agentic_retrieval_plan_eval_suite \
  tests.evals.workflow_trace_gate_suite \
  tests.evals.multi_agent_product_path_gate_suite \
  tests.evals.rag_eval_coverage_suite \
  tests.evals.retrieval_qrels_coverage_suite
```

Result: 72 tests passed.

## Performance Posture

RAGAS slowness remains attributable through report performance breakdown:

- `retrieval_ms`
- `answer_ms`
- `scorer_ms`
- `diagnostic_ms`
- `dependency_wait_ms`

The eval lane preserves `case_workers` concurrency and separates scorer overhead from retrieval
runtime.

## Deferred Work

No JSON fixture was edited in this implementation, so no additional `json.tool` validation was
needed for Phase 5. Larger denominator expansion remains a release/maturity gate, not this local
small-sample gate.
