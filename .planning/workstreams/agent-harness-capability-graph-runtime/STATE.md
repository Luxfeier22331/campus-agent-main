---
doc_type: state
status: completed
created: 2026-05-07
updated: 2026-05-07
---

<!-- markdownlint-disable MD013 -->

# State: Agent Harness Capability Graph Runtime

## Current Position

**Status:** completed
**Current Phase:** completed
**Last Activity:** 2026-05-07
**Last Activity Description:** Moved transport expansion into dedicated follow-up
`transport-notice-override-harness-admission`, completed workstream closeout audit, and closed the
generic harness runtime line.

## Current Slice

Phase 0 through Phase 7 are complete, and the Phase 9 closeout slice for the current runtime is
also complete. Selected notice follow-through now enters runtime as an internal
`CapabilityPlan`, resolves through artifact registry truth into a bounded `WorkflowPlan`, and
runner execution fail-closes when a step returns success without the required artifact projections.

Phase 6 closed the previous Go->Python seam: `WorkflowAgentContextWire`, generated contracts,
fixture matrix, bridge parser, Go bridge payload projection and SDK runner now all carry
`expected_output_artifacts`, and SDK-backed steps fail closed with `sdk_artifact_incomplete` when a
repo-owned output projection is missing.

Phase 7 removed the remaining planner-baked selected-notice fixed-step shell. Planner admission now
returns a capability-only multi-step preplan, and runtime resolves the actual workflow shape
through the artifact graph.

Phase 9 closeout now records bounded final answer artifact usage in workflow trace summary through
`answer_artifact_projection_ids` and `answer_artifact_kinds`, with shared schema, generated
contract, runtime finalizer and eval-gate coverage.

The former Phase 8 transport expansion is no longer an open blocker on this workstream. It has been
split into follow-up `transport-notice-override-harness-admission`.

The current design target is:

```text
CapabilityPlan
-> artifact graph resolver
-> WorkflowPlan
-> StepOutputProjection artifact bundle
-> Go supervisor finalization
```

## Progress

**Phases Complete:** 9 of 9 owned phases
**Current Plan:** complete

**Remaining Phase Review:** complete. There are no remaining open phases in this workstream.

## Important Decisions

- This workstream is not about Codex/GSD execution harness; it is product runtime agent harness.
- OpenAI Agents SDK remains step-local runtime substrate, not global workflow owner.
- `multi_step` should not expand by adding per-scenario planner if-else branches.
- New composite capabilities must enter through artifact ontology, registry producer/consumer truth,
  resolver, eval denominator and opening gate.
- Existing selected notice follow-through is the first migration target.
- Transport schedule baseline + notice override + grounding has been moved into dedicated follow-up
  `transport-notice-override-harness-admission`.
- `configs/runtime/workflow-artifacts.v1.json` is the current artifact ontology source.
- Resolver only follows `consumes` edges for artifacts explicitly selected by the current
  `CapabilityPlan`.
- `retrieval.query` remains `agent_internal`; the resolved RAG handoff keeps `AllowedTools=[]`, and
  runtime observability infers the selected tool separately.
- Current projection support is uneven:
  - Go runtime supports `notice_context`, `schedule_baseline`, `evidence_bundle`,
    `grounding_verdict`.
  - Shared execution contract enum also includes `service_guide_facts` and `place_context`.
  - `notice_change_set`, `service_status_facts`, `contact_directory_facts` and
    `academic_calendar_facts` remain planned contract gaps.
  - AgentSpec currently uses `calendar_fact`; Phase 2 must normalize or explicitly alias it.

## Blockers

None for this completed workstream. Transport override admission is now tracked in
`transport-notice-override-harness-admission`.

## Verification

Fresh verification after Phase 7 / Phase 9 closeout:

```bash
uv run --all-packages python -m unittest tests.contracts.canonical_supervisor_execution_schema_suite tests.evals.workflow_trace_gate_suite tests.supervisor.agents_sdk_runner_suite tests.supervisor.agents_sdk_workflow_step_trace_suite tests.contracts.supervisor_execution_fixture_matrix_suite -q
cd apps/supervisor-api && go test ./internal/httpapi ./internal/execution ./internal/structuredplanning -count=1
uv run --all-packages python -m scripts.generate_supervisor_execution_contracts --check
```

Result: all commands passed.

## Session Continuity

**Stopped At:** workstream complete.
**Resume File:** `.planning/workstreams/agent-harness-capability-graph-runtime/README.md`

## Reopen Rule

Reopen only if `CapabilityPlan -> resolver -> WorkflowPlan` runtime truth regresses, selected-notice
multi-step migration drifts back to planner-baked fixed-step logic, workflow trace no longer proves
bounded final answer artifact usage, or a new admitted supervisor-level composite capability needs
to extend the generic harness runtime instead of using a dedicated follow-up line.
