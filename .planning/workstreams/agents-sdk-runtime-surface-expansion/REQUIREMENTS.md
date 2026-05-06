---
doc_type: requirements
workstream: agents-sdk-runtime-surface-expansion
status: active
created: 2026-05-06
updated: 2026-05-06
---

<!-- markdownlint-disable MD013 -->

# Requirements: Agents SDK Runtime Surface Expansion

## Goal

Extend OpenAI Agents SDK usage from the current completed pilot/admitted surfaces into a reusable,
governed runtime substrate for more domain-agent and worker-internal execution surfaces, while
preserving repo-owned admission, source-truth, contracts, eval truth, and Go finalization.

## In Scope

- Add repo-owned SDK instruction-profile substrate for admitted domain-agent surfaces.
- Carry instruction profile id through runner request and sanitized observability projection.
- Keep per-target/per-tool SDK runtime behavior explicit instead of using one generic tool-loop
  instruction for every admitted surface.
- Create a dedicated active workstream and phase plan for post-promotion SDK runtime expansion.
- Expand focused tests for admitted surfaces that now use profile-specific SDK semantics.
- Define the implementation order for:
  - RAG SDK default-on acceptance hardening
  - structured domain-agent adapter parity for new read-only tools
  - offline notice multimodal/media review adapter
  - service-guide/contact synthesis loop refinement

## Out Of Scope

- Replacing Go `WorkflowPlan` with SDK handoffs or agent graphs.
- Turning SDK into repo-wide orchestration owner.
- Opening hosted web search, file search, code interpreter, remote MCP, shell or filesystem tools.
- Moving SDK-native trace/session/run-state into shared contracts or product responses.
- State-changing tools such as appointment, submission, payment or work-order actions.
- Opening `retrieval.query` as a public ToolSpec/provider function/SDK tool.

## Success Criteria

- The repo has a dedicated active workstream for SDK runtime-surface expansion.
- `notice-agent`、`campus-services-agent`、`calendar-agent` can carry explicit SDK instruction
  profiles through runner-shell execution.
- Runner-shell observability reports the selected SDK instruction profile id as safe summary data.
- Focused SDK tests prove the right runtime surface receives the right profile.
- The expansion roadmap clearly separates what is implementable now from what is blocked on Docker
  or ingestion-side multimodal scope.
