---
doc_type: plan
status: planned
created: 2026-05-09
updated: 2026-05-09
---

<!-- markdownlint-disable MD013 -->

# Phase 7: Typed Answer Object Internal Primary

## Goal

Promote typed answer draft semantics into the internal primary answer artifact for supported
regulation answer kinds.

## Scope

- Typed answer object naming and validation for regulation answer kinds.
- SDK synthesis input projection where the SDK path is used.
- Grounding graph source of truth.

## Implementation Tasks

1. Rename or wrap `TypedAnswerDraft` as the internal primary typed answer object for supported
   regulation answer kinds.
2. Ensure SDK synthesis receives typed object projection for supported regulation answer kinds.
3. Ensure claim/evidence graph derives from typed object support, not post-hoc text guessing.
4. Preserve public natural-language answer text as the user-facing response.

## Acceptance Criteria

- supported regulation typed answer kinds have typed object tests.
- grounding graph and claim support are tied to typed object support.
- public response shape does not change unless separately approved.

## Verification

```bash
uv run --all-packages python -m unittest tests.agent.rag_agent_typed_answer_drafts_suite tests.agent.rag_agent_answer_grounding_suite tests.agent.rag_agent_sdk_service_suite -q
uv run --all-packages ruff check packages/rag-agent tests/agent
uv run --all-packages ruff format <changed-python-files> --check
```
