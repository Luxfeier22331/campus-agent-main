---
doc_type: plan
status: planned
created: 2026-05-06
updated: 2026-05-06
---

<!-- markdownlint-disable MD013 -->

# Phase 4 Plan: Typed Answer Drafts And Grounding

## Goal

Introduce typed answer drafts inside `rag-agent` so policy list, procedure, eligibility judgment and
condition-table answers are validated before natural-language rendering.

## Tasks

1. Add typed draft models.
   - Candidate file: `packages/rag-agent/src/campus_rag_agent/typed_answer_drafts.py`.
   - Draft kinds: `policy_list`, `procedure_steps`, `eligibility_judgment`, `condition_table`,
     `unsupported`, `clarification`.
2. Map evidence to draft.
   - Category overview -> policy list.
   - Procedure step -> procedure steps.
   - Condition/exclusion/exception -> eligibility judgment or condition table.
   - Table fact -> condition table or amount/quota row.
3. Validate draft evidence support.
   - Every list item / procedure step / judgment conclusion must cite evidence source id and
     excerpt.
   - Unsupported draft must preserve no-answer reason.
   - Typed draft support must project into the existing claim/evidence graph.
   - Do not introduce a second grounding diagnostics truth beside the existing claim/evidence graph.
4. Render final Chinese answer.
   - Keep public `AgentResponse` unchanged.
   - Avoid overclaiming category discovery as guaranteed eligibility.
   - Preserve limitations such as annual notice / college detailed rules.
5. Integrate SDK path.
   - SDK structured output cannot bypass typed draft validation.
   - Legacy deterministic synthesis must map through draft validation or stay in test/fixture scope.
   - This work only adds validation/adapter guards to existing SDK and deterministic output paths.
   - Do not change SDK loop ownership, SDK tool schema, handoff routing or public ToolSpec.
6. Preserve grounding ownership.
   - Typed drafts are upstream structured answer representations.
   - The existing claim/evidence graph remains the single grounding diagnostics surface.
   - Claim/list/step support must be visible through that graph before final render.
7. Add tests.
   - Draft validation tests.
   - Rendering tests.
   - Grounding fail-close tests.
   - Existing answer quality regressions.

## Acceptance

- Completed answers come from validated typed drafts for targeted answer shapes.
- Unsupported/clarification outcomes remain explicit.
- Claim/list item/step support is checked before rendering.
- Existing claim/evidence graph remains the single grounding diagnostics surface.
- Public response schema remains stable.
- Existing SDK loop boundary remains unchanged except for typed draft validation at the `rag-agent`
  output adapter seam.

## Verification

```bash
uv run --all-packages python -m unittest \
  tests.agent.rag_agent_answer_grounding_suite \
  tests.agent.rag_agent_request_prompt_grounding_suite \
  tests.agent.rag_agent_realistic_e2e_samples_suite \
  tests.agent.rag_agent_handbook_category_discovery_suite \
  tests.agent.rag_agent_sdk_service_suite -q
uv run --all-packages ruff check packages/rag-agent tests/agent
```
