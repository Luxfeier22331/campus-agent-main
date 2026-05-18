---
doc_type: plan
status: planned
created: 2026-05-09
updated: 2026-05-09
---

<!-- markdownlint-disable MD013 -->

# Phase 9: Residual Deletion And Guardrails

## Goal

Delete old independent classifiers and add guards so the system cannot drift back to multiple intent
truths.

## Scope

- Guard tests.
- Source cleanup.
- Documentation and workstream closeout.

## Implementation Tasks

1. Delete or demote old classifier functions that still own primary intent.
2. Add rg/unit guards:
   - synthesis must not classify primary task from raw query text
   - answer shape must not own regulation query parsing
   - rag-agent retrieval plan must require intent for covered query-serving paths
   - retrieval-core must not import or define `RetrievalIntent`
   - typed answer kind must match expected answer kind
3. Update architecture docs where current/target architecture mention RAG planning, and update
   `docs/contracts/rag-agent-retrieval-plan-contract.md` only if the internal retrieval-plan seam
   changes.
4. Update `STATE.md`, `ROADMAP.md`, and `.planning/WORKSTREAMS.md`.

## Acceptance Criteria

- guard tests catch reintroduced multi-truth classifiers.
- docs reflect final architecture.
- focused and broader verification commands are recorded.

## Verification

```bash
uv run --all-packages python -m unittest \
  tests.agent.rag_agent_service_structure_suite \
  tests.agent.rag_agent_typed_answer_drafts_suite \
  tests.agent.test_rag_retrieval_plan \
  tests.retrieval.retrieval_service_replan_execution_suite \
  tests.evals.answer_ready_component_eval_suite \
  tests.supervisor.rag_agents_sdk_delegate_suite -q
uv run --all-packages ruff check packages/rag-agent packages/retrieval-core packages/evals tests
uv run --all-packages ruff format <changed-python-files> --check
pnpm docs:lint
```
