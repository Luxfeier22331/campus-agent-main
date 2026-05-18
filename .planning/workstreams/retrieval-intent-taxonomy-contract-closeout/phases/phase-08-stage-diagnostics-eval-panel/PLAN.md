---
doc_type: plan
status: planned
created: 2026-05-09
updated: 2026-05-09
---

<!-- markdownlint-disable MD013 -->

# Phase 8: Stage Diagnostics Eval Panel

## Goal

Add a component-level eval runner that explains a single sample through all RAG stages.

## Scope

- Eval runtime only.
- Stage diagnostics data model.
- CLI or test helper for deterministic samples.

## Implementation Tasks

1. Add `rag_stage_diagnostics` eval module.
2. Capture stages:
   - intent
   - plan
   - retrieval
   - rerank
   - selection
   - typed answer
   - synthesis path, including SDK synthesis when enabled
   - grounding
   - final response
3. Add failure classes:
   - `intent_mismatch`
   - `plan_mismatch`
   - `retrieval_miss`
   - `rerank_regression`
   - `selection_missing_coverage`
   - `typed_answer_invalid`
   - `synthesis_contract_failed`
   - `grounding_mismatch`
4. Add tests using existing deterministic fixtures.

## Acceptance Criteria

- one failed sample identifies a stage-local failure.
- diagnostics do not expose raw provider output, SDK-native types or raw retrieval backend payloads.
- eval output is deterministic.
- eval diagnostics use `RetrievalIntent.to_dict()` rather than model/runtime object reprs.

## Verification

```bash
uv run --all-packages python -m unittest tests.evals.answer_ready_component_eval_suite tests.evals.retrieval_rerank_eval_suite -q
uv run --all-packages ruff check packages/evals tests/evals
uv run --all-packages ruff format <changed-python-files> --check
```
