---
doc_type: phase_plan
status: planned
created: 2026-05-07
updated: 2026-05-07
---

<!-- markdownlint-disable MD013 -->

# Phase 7: Typed Answer Grounding Integration

## Goal

确保 `rag-agent` 的 typed answer draft 和 claim grounding 能消费 v3 evidence contract，并继续保持一个
grounding truth，不新增绕过证据支持的回答路径。

## Scope

- Align typed answer draft construction with v3 evidence roles.
- Validate draft item support against evidence spans/claims.
- Ensure category list, procedure, eligibility judgment and condition table answers use typed
  metadata.
- Ensure SDK/deterministic output adapters cannot bypass evidence support.
- Consume the Phase 0 semantic oracle for expected draft kind and grounding requirement.

## Deliverables

- Updated typed answer draft mapping.
- Grounding validation updates.
- Tests for:
  - policy list from category overview
  - procedure steps from typed procedure evidence
  - eligibility judgment from condition/exclusion evidence
  - condition table from grouped conditions
  - unsupported / clarification when v3 evidence is absent
  - oracle mismatch produces `draft_contract_mismatch` or `grounding_mismatch`
- No public `AgentResponse` shape expansion unless explicitly justified.

## Implementation Boundaries

- Do not reopen Agents SDK loop ownership or tool schema.
- Do not move v3 extraction logic into `rag-agent`.
- Do not create a second claim/evidence graph.

## Verification

```bash
uv run --all-packages python -m unittest tests.agent.rag_agent_typed_answer_drafts_suite tests.agent.rag_agent_answer_grounding_suite tests.agent.rag_agent_answer_quality_regression_suite -q
uv run --all-packages ruff check packages/rag-agent tests/agent
uv run --all-packages ruff format packages/rag-agent tests/agent --check
```

## Exit Criteria

- Typed drafts cannot complete without supporting v3 evidence where required.
- Category/procedure/judgment answers ground each list item or claim.
- Public response contract stays stable.
- SDK output path is validated against the same grounding requirements.
- Draft kind and grounding behavior match `SEMANTIC-ORACLE.md`.

## Non-Goals

- Add new top-level agent.
- Change supervisor routing.
