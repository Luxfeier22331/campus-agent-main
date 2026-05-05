---
doc_type: phase_plan
status: planned
created: 2026-05-04
updated: 2026-05-04
---

<!-- markdownlint-disable MD013 -->

# Phase 5 Plan: RAG Eval Denominator And Regression Gates

## Objective

Extend RAGAS and workflow evals so answer relevancy, faithfulness, handoff, source trust, grounding,
guardrail and performance failures are repeatable and stage-attributed.

## Dependencies

- Phase 1-4 have introduced or confirmed the runtime fields that evals should observe.
- Phase 0 identifies local small-sample cases versus larger maturity/release gates.

## Desired End State

- Local small-sample gate covers the new autonomous RAG failure classes.
- Larger maturity/release gates remain separate.
- `fresh_news` remains excluded from current RAG denominator.
- RAGAS slow path reports scorer/judge overhead separately from runtime retrieval/synthesis.
- Eval reports include stage attribution and product surface.

## Primary Code Targets

- `packages/evals/src/campus_evals/ragas_diagnostic_runner.py`
- `packages/evals/src/campus_evals/ragas_adapter.py`
- `packages/evals/src/campus_evals/ragas_adapter_results.py`
- `packages/evals/src/campus_evals/ragas_adapter_projection.py`
- `packages/evals/src/campus_evals/agentic_retrieval_plan_eval.py`
- `packages/evals/src/campus_evals/workflow_trace_gate.py`
- `packages/evals/src/campus_evals/multi_agent_product_path_gate.py`
- `packages/evals/src/campus_evals/rag_eval_coverage.py`
- `packages/evals/fixtures/agentic_retrieval_plan_cases.v1.json`
- `packages/evals/fixtures/workflow_trace_gate_cases.v1.json`
- `packages/evals/fixtures/public_chat_product_path_cases.v1.json`
- `packages/evals/fixtures/rag_eval_maturity_policy.v1.json`
- `packages/evals/fixtures/eval_denominator_registry.v1.json`

## Primary Test Targets

- `tests/evals/ragas_diagnostic_runner_suite.py`
- `tests/evals/ragas_runtime_scorer_defaults_suite.py`
- `tests/evals/ragas_runtime_scorer_suite.py`
- `tests/evals/ragas_runtime_http_transport_async_suite.py`
- `tests/evals/agentic_retrieval_plan_eval_suite.py`
- `tests/evals/workflow_trace_gate_suite.py`
- `tests/evals/multi_agent_product_path_gate_suite.py`
- `tests/evals/rag_eval_coverage_suite.py`
- `tests/evals/retrieval_qrels_coverage_suite.py`

## TDD Plan

1. Add failing diagnostic report tests:
   - unsupported claim maps to `grounding` or `evidence_selection`.
   - source-trust mismatch maps to `planner` or `admission`.
   - malicious source instruction maps to `guardrail`.
   - scorer timeout/latency maps to `diagnostic_overhead`.
2. Add failing small-sample fixture tests:
   - at least one case per admitted surface where feasible.
   - at least one hard negative/no-answer case.
   - at least one query mode/source-trust failure case.
3. Add failing concurrency/performance tests:
   - async scorer lane remains concurrent.
   - report separates runtime latency from judge/scorer latency.
4. Add denominator guard test:
   - `official_web/fresh_news` is not counted in current RAG eval denominator.

## Implementation Steps

1. Define eval taxonomy.
   - Use stable stage names: `planner`, `retrieval`, `evidence_selection`, `synthesis`,
     `grounding`, `guardrail`, `diagnostic_overhead`.
   - Keep taxonomy aligned with RAG runtime diagnostics.
2. Extend fixtures.
   - Add small-sample cases from Phase 1-4 failure classes.
   - Keep fixture count intentionally small for local iteration.
   - Do not mutate release/maturity denominators unless Phase 0 explicitly identified a gap.
3. Extend RAGAS diagnostics.
   - Add performance breakdown fields if missing.
   - Preserve async/concurrent scorer execution.
   - Avoid importing optional heavy dependencies at module import time.
4. Extend workflow trace gate.
   - Check handoff/projection/source-trust/guardrail metadata.
   - Reject raw source/provider payload leakage.
5. Document gates.
   - Phase summary records local focused commands, maturity/release commands and denominator counts.

## Write Set

Allowed:

- Eval runtime/reporting files listed above
- Eval fixtures listed above
- Tests listed above
- Phase summary/state

Not allowed:

- Budget control by dollar cap
- Treating LLM judge as sole release authority
- Adding `fresh_news` to current RAG denominator
- Tuning production runtime profile from eval-only output

## Verification

Run focused eval tests:

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

Run lint/format:

```bash
uv run --all-packages ruff check packages/evals/src/campus_evals tests/evals
uv run --all-packages ruff format packages/evals/src/campus_evals tests/evals --check
```

Run fixture syntax checks if JSON fixtures change:

```bash
python -m json.tool packages/evals/fixtures/agentic_retrieval_plan_cases.v1.json >/dev/null
python -m json.tool packages/evals/fixtures/workflow_trace_gate_cases.v1.json >/dev/null
python -m json.tool packages/evals/fixtures/public_chat_product_path_cases.v1.json >/dev/null
python -m json.tool packages/evals/fixtures/rag_eval_maturity_policy.v1.json >/dev/null
python -m json.tool packages/evals/fixtures/eval_denominator_registry.v1.json >/dev/null
```

If Phase 5 edits different JSON fixtures, run `python -m json.tool` for each edited fixture instead
of relying on YAML, JSONL or TOML checks.

## Exit Criteria

- Eval reports attribute failures by stage and surface.
- RAGAS performance breakdown separates runtime and scorer overhead.
- Local small-sample gate covers new failure classes.
- Current RAG denominator still excludes `fresh_news`.
- Phase summary records denominator counts and commands.

## Risks

- Risk: eval fixture expansion becomes too large for local iteration.
  Mitigation: split focused small-sample gate from maturity/release gates.
- Risk: scorer concurrency regresses while adding diagnostics.
  Mitigation: preserve async scorer tests and latency assertions.
- Risk: optional dependency warnings distract from failures.
  Mitigation: keep optional imports lazy and classify dependency noise separately.
