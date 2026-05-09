---
doc_type: plan
status: completed
created: 2026-05-09
updated: 2026-05-09
---

<!-- markdownlint-disable MD013 -->

# Phase 0: Current Truth And Contract Freeze

## Goal

Freeze the target `RetrievalIntent` contract before implementation so later phases cannot reinterpret
intent kinds, expected evidence roles, typed answer kinds or rerank/replan policy.

## Scope

- Audit current classifiers and projection points.
- Produce a mapping table from current types to target intent kinds.
- Define fields for `RetrievalIntent` v1.
- Decide which existing names remain as projections and which are deleted.
- Write acceptance checklist for Phase 1-9.

## Implementation Tasks

1. Inspect current implementations:
   - `packages/rag-agent/src/campus_rag_agent/handbook_query_planning.py`
   - `packages/rag-agent/src/campus_rag_agent/agent_answer_shape.py`
   - `packages/rag-agent/src/campus_rag_agent/rag_sdk_models.py`
   - `packages/rag-agent/src/campus_rag_agent/typed_answer_drafts.py`
   - `packages/rag-agent/src/campus_rag_agent/service_retrieval.py`
   - `packages/rag-agent/src/campus_rag_agent/semantic_replan.py`
2. Create `INTENT-MAPPING.md` with:
   - current classifier
   - current values
   - target intent kind
   - expected answer kind
   - expected evidence roles
   - required targets
   - rerank / replan default
3. Create `CONTRACT-FREEZE.md` with v1 field list, enum values and non-goals.
4. Update `STATE.md` with Phase 0 completion evidence.

## Acceptance Criteria

- Every current query/answer/retrieval classifier has a target disposition.
- Phase 1 can implement contract without reopening taxonomy naming.
- Out-of-scope boundaries are explicit.

## Verification

```bash
pnpm docs:lint
```
