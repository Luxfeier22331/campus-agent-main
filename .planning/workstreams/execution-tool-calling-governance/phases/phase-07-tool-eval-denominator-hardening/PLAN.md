---
doc_type: plan
phase: phase-07-tool-eval-denominator-hardening
status: planned
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 7 Plan: Tool Eval Denominator Hardening

## Goal

Expand evals from final answer quality to explicit tool behavior correctness.

## Tasks

1. Add should-call vs no-call cases.
2. Add selected tool correctness and argument precision scoring.
3. Add fail-close correctness cases.
4. Add hallucinated tool-call prevention cases.
5. Add tool result usage checks for answer synthesis and workflow traces.

## Write Scope

- `packages/evals/src/campus_evals/`
- `packages/evals/fixtures/`
- focused eval tests

## Verification

```bash
uv run --all-packages python -m unittest tests.evals.intent_synthetic_suite tests.evals.workflow_trace_gate_suite
uv run --all-packages ruff check packages/evals tests/evals
git diff --check
```
