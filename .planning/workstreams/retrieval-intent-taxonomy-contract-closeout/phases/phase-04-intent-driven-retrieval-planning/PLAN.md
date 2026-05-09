---
doc_type: plan
status: planned
created: 2026-05-09
updated: 2026-05-09
---

<!-- markdownlint-disable MD013 -->

# Phase 4: Intent-Driven Retrieval Planning

## Goal

Drive rag-agent retrieval steps, selectors, budgets, need ids and expected outputs from
`RetrievalIntent`, while keeping retrieval-core as the typed plan executor.

## Scope

- RAG retrieval planning inside `packages/rag-agent`.
- Need id naming.
- Expected output selection.
- Budget / top-k policy.

## Implementation Tasks

1. Add intent profile mapping for rag-agent retrieval planning.
2. Map intent to:
   - `RetrievalStep.need_ids`
   - `RetrievalStep.expected_output`
   - selector target fields
   - top-k and support budget
3. Preserve scope/authz/version guardrails.
4. Ensure retrieval-core receives only existing typed `RetrievalPlan` / `RetrievalStep` fields and
   does not import `RetrievalIntent`.
5. Update retrieval plan tests.

## Acceptance Criteria

- rag-agent retrieval plan builder no longer contains scattered primary intent cue logic.
- each supported intent has deterministic retrieval plan expectations.
- compare/version and clause focus preserve selectors.
- retrieval-core remains executor-only for primary RAG intent.
- retrieval-core does not import `campus_rag_agent.retrieval_intent`.

## Verification

```bash
uv run --all-packages python -m unittest tests.agent.test_rag_retrieval_plan tests.retrieval.retrieval_service_replan_execution_suite -q
uv run --all-packages ruff check packages/rag-agent packages/retrieval-core tests/agent tests/retrieval
uv run --all-packages ruff format <changed-python-files> --check
```
