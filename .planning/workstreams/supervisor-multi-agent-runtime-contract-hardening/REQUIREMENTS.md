---
doc_type: requirements
status: active
created: 2026-05-04
updated: 2026-05-04
---

<!-- markdownlint-disable MD013 -->

# Requirements: Supervisor Multi-Agent Runtime Contract Hardening

## Goal

Make supervisor-led multi-agent execution a typed, observable, evaluable repo-owned runtime
contract rather than a set of planner strings, prompt conventions, or framework-native traces.

## In Scope

- `AgentSpec` registry design and implementation plan.
- Agent invocation graph projection.
- Context projection / inheritance policy.
- Handoff lifecycle schema and store invariants.
- Tool / deterministic query function result provenance contract.
- Workflow trace completeness and eval denominator.
- Observability correlation for workflow / agent / tool / evidence lifecycle.
- Documentation and drift tests that prevent boundary regression.

## Out Of Scope

- Replacing the Go supervisor runtime with an agent framework.
- Introducing LangGraph / Agents SDK / MCP as repo-wide orchestration owner.
- Opening new product capabilities.
- Implementing state-changing tools.
- Building browser UI for agent graph.
- Reworking retrieval ranking or ingestion source truth except where trace refs require existing
  projection ids.

## Success Criteria

- Every opened domain agent is represented by a repo-owned `AgentSpec` or equivalent artifact.
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

## Non-Goals

- Make all future workflows multi-agent.
- Add peer-to-peer agent messaging.
- Turn deterministic structured runtime into LLM tool loops.
- Make app-api or browser surfaces consume internal graph truth directly.

