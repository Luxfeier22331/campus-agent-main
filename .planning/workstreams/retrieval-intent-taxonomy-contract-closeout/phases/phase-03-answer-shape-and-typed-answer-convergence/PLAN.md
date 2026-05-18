---
doc_type: plan
status: planned
created: 2026-05-09
updated: 2026-05-09
---

<!-- markdownlint-disable MD013 -->

# Phase 3: Answer Shape And Typed Answer Convergence

## Goal

Stop `AnswerShape` and typed answer kind from independently inferring answer form.

## Scope

- `AnswerShape` projection from `RetrievalIntent`.
- `TypedAnswerDraft.kind` projection from `RetrievalIntent.expected_answer_kind`.
- Guard tests for no independent regulation query parsing in answer shape.

## Implementation Tasks

1. Replace independent regulation `infer_answer_shape()` usage with
   `answer_shape_from_retrieval_intent()`.
2. Update `RagAgent.build_answer()` to require or receive intent for covered query-serving paths.
3. Make `TypedAnswerDraft` validation assert expected answer kind alignment.
4. Preserve non-regulation curriculum/title/fact answer shape behavior only as explicit,
   scope-specific projections; do not leave a generic regulation query cue parser.
5. Update tests for policy list, judgment, procedure and condition table.

## Acceptance Criteria

- `AnswerShape` is a projection, not an owner.
- typed answer kind cannot diverge from retrieval intent.
- No new cue parser is added to answer synthesis.
- Existing curriculum and official-web answer behavior remains explicitly scoped and covered by
  tests when touched.

## Verification

```bash
uv run --all-packages python -m unittest \
  tests.agent.rag_agent_typed_answer_drafts_suite \
  tests.agent.rag_agent_answer_quality_regression_suite \
  tests.agent.rag_agent_service_structure_suite -q
uv run --all-packages ruff check packages/rag-agent tests/agent
uv run --all-packages ruff format <changed-python-files> --check
```
