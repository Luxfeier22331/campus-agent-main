---
doc_type: requirements
status: completed
created: 2026-05-04
updated: 2026-05-04
---

<!-- markdownlint-disable MD013 -->

# Requirements: Supervisor Multi-Agent Runtime Contract Hardening

## Goal

Make supervisor-led multi-agent execution a typed, observable, evaluable repo-owned runtime
contract rather than a set of planner strings, prompt conventions, or framework-native traces.

## In Scope

- `AgentSpec` registry design and implementation plan, initially targeting
  `configs/runtime/agents.v1.json` plus a schema/drift-test path.
- Agent invocation graph projection.
- Context projection / inheritance policy.
- Handoff lifecycle schema and store invariants.
- Tool / deterministic query function result provenance contract.
- Workflow trace completeness and eval denominator.
- Observability correlation for workflow / agent / tool / evidence lifecycle.
- Documentation, fixtures and drift tests that prevent boundary regression.

## Out Of Scope

- Replacing the Go supervisor runtime with an agent framework.
- Introducing LangGraph / Agents SDK / MCP as repo-wide orchestration owner.
- Opening new product capabilities.
- Implementing state-changing tools.
- Building browser UI for agent graph.
- Reworking retrieval ranking or ingestion source truth except where trace refs require existing
  projection ids.

## Success Criteria

- Every opened domain agent is represented by the repo-owned canonical `AgentSpec` artifact once
  Phase 1 freezes its path and schema.
- Go `WorkflowPlan.allowed_agents` and Python worker delegate map are derived from or checked
  against `AgentSpec`.
- `AgentInvocation` projection exists and can represent single-handoff and multi-step workflows.
- Cross-agent context projection has explicit kind, source step, content hash, visibility posture,
  length budget, source refs and safety summary.
- Required context projection absence fails closed instead of falling back to raw prompt history.
- Tool output used in multi-agent workflows carries typed payload, source refs, freshness/effective
  window where applicable, business outcome, fail-close reason and trace-safe summary.
- Workflow trace eval covers routing mode, handoff target, allowed tools, context projection,
  specialist output bounding, finalization and fail-close provenance.
- Raw provider trace/model output/source body/OCR dump/object-store bytes never enters shared
  contracts, panel, eval canonical assets or workflow trace summary.

## Completion Evidence

- `AgentSpec` registry, Go planner admission and Python dispatch fail-close are implemented.
- `AgentInvocation` projection, parent edge and consumed projection refs are represented in
  workflow trace/store tests.
- `AgentRequest.workflow_context` carries cross-agent projection refs and rejects raw context keys.
- Workflow trace eval gates raw context leaks, unbounded tool summaries, missing source/ref hash and
  missing fail-close reasons.
- Architecture docs define observability correlation without raw prompt/source/provider payload
  leakage.

## Non-Goals

- Make all future workflows multi-agent.
- Add peer-to-peer agent messaging.
- Turn deterministic structured runtime into LLM tool loops.
- Make app-api or browser surfaces consume internal graph truth directly.
- Reopen `governed-multi-agent-workflow-runtime` implementation before Phase 1-4 contract decisions
  and Phase 8 readiness review are complete.
