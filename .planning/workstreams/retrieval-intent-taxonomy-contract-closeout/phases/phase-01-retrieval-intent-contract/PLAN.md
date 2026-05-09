---
doc_type: plan
status: completed
created: 2026-05-09
updated: 2026-05-09
---

<!-- markdownlint-disable MD013 -->

# Phase 1: RetrievalIntent Contract

## Goal

Add a versioned, SDK-free `RetrievalIntent` internal contract inside the RAG/retrieval internal
seam, with validation tests.

## Scope

- Add model definitions in `packages/rag-agent` or a RAG/retrieval internal seam module; do not add
  them to `packages/contracts`.
- Define enums for intent kind, answer kind, coverage policy, selection policy, rerank policy and
  replan policy.
- Add serialization and validation tests.

## Implementation Tasks

1. Add `RetrievalIntent` and support DTOs.
2. Export models only to RAG/retrieval-internal code without leaking provider/runtime-specific
   types.
3. Add tests for:
   - valid policy-list intent
   - valid eligibility judgment intent
   - valid procedure intent
   - valid condition-table intent
   - invalid empty required target
   - invalid enum values
   - stable dict / JSON projection
4. Add drift guard ensuring SDK-native names are absent from the contract and that
   `packages/contracts` does not import or define `RetrievalIntent`.

## Acceptance Criteria

- Contract tests pass.
- No SDK/provider/Qdrant/MinIO types appear in the contract.
- `packages/contracts` remains unchanged except for unrelated existing shared evidence models.
- Intent defaults are explicit and stable.

## Verification

```bash
uv run --all-packages python -m unittest tests.agent.rag_agent_retrieval_intent_contract_suite -q
uv run --all-packages ruff check packages/rag-agent tests/agent
```
