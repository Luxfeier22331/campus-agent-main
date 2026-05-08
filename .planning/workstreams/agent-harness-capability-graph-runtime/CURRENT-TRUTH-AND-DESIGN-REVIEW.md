---
doc_type: review
status: completed
created: 2026-05-07
updated: 2026-05-07
---

<!-- markdownlint-disable MD013 -->

# Current Truth And Design Review

## Purpose

This is the Phase 0 closeout review for `agent-harness-capability-graph-runtime`.

It freezes the interpretation of this workstream before implementation starts: this line is about a
repo-governed runtime harness that compiles artifact requirements into workflow steps. It is not a
new SDK-owned global orchestrator and not a new product serving surface.

## Current Repo Truth

- Current product runtime is supervisor-led:
  `app-api -> supervisor-api -> supervisor-agent-worker -> domain agent`.
- Go `supervisor-api` owns deterministic admission, policy, allowed agents/tools, workflow plan
  projection, workflow run storage and finalization.
- Python `supervisor-agent-worker` executes admitted agent steps and may use OpenAI Agents SDK inside
  those steps.
- OpenAI Agents SDK is currently a step-local substrate for selected read-only domain-agent tools.
- Current real `multi_step` admission remains narrow: selected notice context + knowledge
  follow-through.
- Completed governed workflow work gives precedent for step projections, step summaries and
  workflow trace, but it must not be extended by adding new scenario-specific branches at the tail.

## External Design Inputs

- OpenAI Agents orchestration supports manager-style specialist execution. This maps to our model:
  supervisor keeps final answer ownership, specialists produce bounded artifacts.
- OpenAI Agents SDK tools, guardrails and tracing fit step-local execution, not repo-wide graph
  ownership.
- OpenAI agent eval guidance supports trace-level evaluation of tool use, handoff correctness and
  policy behavior. Our harness eval should therefore evaluate artifact selection and owner
  correctness, not only answer text.
- Durable workflow references such as LangGraph are useful for persistence/retry/idempotency
  semantics. They are not a required dependency for this workstream.

## Design Decision

Use this target shape:

```text
CapabilityPlan
-> artifact registry / capability graph resolver
-> WorkflowPlan
-> WorkflowRun
-> StepOutputProjection artifact bundle
-> Go supervisor finalizer
```

Do not use this shape:

```text
LLM or SDK global planner
-> free tool selection
-> opaque cross-agent transcript
-> final answer from specialist
```

## Phase 0 Completion Criteria

- Native workstream exists.
- Boundary and non-goals are explicit.
- External references are recorded.
- First migration target and first expansion target are explicit.
- Phase 1 has a concrete artifact ontology task.

All criteria are satisfied by the current workstream files plus this review.

## Implementation Guardrails

- Do not introduce per-artifact environment variable allowlists.
- Do not let `campus_notice_get` become a structured/provider/SDK tool.
- Do not make `retrieval.query` a public or top-level structured handoff tool.
- Do not allow `state_changing=true` artifacts or tools in this harness.
- Do not allow raw source/body/trace/backend payloads into artifact truth.
