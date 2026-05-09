---
doc_type: plan
status: planned
created: 2026-05-09
updated: 2026-05-09
---

<!-- markdownlint-disable MD013 -->

# Phase 5: Intent-Aware Selection And Replan

## Goal

Make rag-agent selection and semantic replan consume intent expectations instead of relying on
generic empty / focus / polarity signals only.

## Scope

- Evidence selection in rag-agent.
- retrieval-core generic failure-kind projection where needed.
- Semantic replan trigger reasons in rag-agent.

## Implementation Tasks

1. Add intent-aware checks:
   - `category_coverage_missing`
   - `same_doc_overselected`
   - `weak_evidence_role`
   - `critical_term_missing`
   - `condition_subject_mismatch`
   - `procedure_step_incomplete`
   - `clause_parent_missing`
2. Route failures to replan or fail-closed outcomes.
3. Keep replan scope/selector/budget non-widening.
4. Do not move answer-kind or policy-category classification into retrieval-core.
5. Update replan tests and diagnostics projection.

## Acceptance Criteria

- replan trigger reasons are typed and intent-aware.
- semantic replan cannot widen scope, selector or budget.
- selection can explain coverage failures.
- retrieval-core generic failure kinds remain answer-kind neutral.

## Verification

```bash
uv run --all-packages python -m unittest tests.retrieval.retrieval_service_replan_execution_suite tests.agent.rag_agent_agentic_depth_runtime_suite -q
uv run --all-packages ruff check packages/rag-agent packages/retrieval-core tests/retrieval tests/agent
uv run --all-packages ruff format <changed-python-files> --check
```
