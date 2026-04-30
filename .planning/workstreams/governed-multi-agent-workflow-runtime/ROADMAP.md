---
doc_type: roadmap
status: deferred
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Roadmap: Governed Multi-Agent Workflow Runtime

## Phase Status

- [x] **Phase 0: Planning And Deferred Admission** — create workstream, freeze target shape, dependencies, blockers, and phase sequence.
- [ ] **Phase 1: Tool And Agent Readiness Matrix** — verify prerequisite single-step tools / agents are current and admissible.
- [ ] **Phase 2: Workflow Trace Denominator** — add eval fixtures for workflow mode, step sequence, allowed agents/tools, context projection, and fail-close branches.
- [ ] **Phase 3: Private Step Artifact Contract** — define private `StepOutputProjection` extensions for schedule, notice, place, evidence, and grounding outputs.
- [ ] **Phase 4: Go WorkflowPlan Admission Extension** — extend Go planner/runtime policy to express manager-style multi-agent plans without executing them yet.
- [ ] **Phase 5: Python Step Runner Runtime** — execute admitted ordered steps and validate typed projections.
- [ ] **Phase 6: Domain Agent Projection Outputs** — make selected agents emit and consume bounded projections for the pilot.
- [ ] **Phase 7: Transport Schedule + Notice Override + Place Context Pilot** — prove first end-to-end multi-agent manager-style workflow.
- [ ] **Phase 8: Observability, Eval, And Guardrail Closeout** — harden trace projection, release-gate denominator, drift guards, and failure semantics.
- [ ] **Phase 9: Second Scenario Admission Decision** — decide whether to expand to service-handling workflows or keep closed.

## Phase 0: Planning And Deferred Admission

**Status:** completed

**Goal:** Plan the workstream without starting implementation.

**Deliverables:**

- Native workstream directory.
- Requirements, roadmap, state, and planning phase plan.
- Deferred / blocked state until tool and agent prerequisites are verified.
- Registry entry under Deferred.

**Verification:**

```bash
pnpm docs:lint
git diff --check
```

## Phase 1: Tool And Agent Readiness Matrix

**Status:** deferred

**Goal:** prove the bottom-level tools and agents are reliable enough to compose.

**Scope:**

- `transport_schedule_lookup` readiness evidence.
- `campus_notice_discover` / `campus_notice_get` readiness evidence.
- `navigation-agent` place/stop context readiness evidence.
- `rag-agent` bounded upstream context + grounding readiness evidence.
- ToolSpec / allowed-tools drift guard evidence.

**Exit Criteria:**

- Each dependency has a current test/eval artifact or explicit blocker.
- No multi-agent runtime implementation starts if any dependency is stale, missing, or product-path closed.

## Phase 2: Workflow Trace Denominator

**Status:** deferred

**Goal:** make multi-agent correctness machine-checkable before runtime work.

**Scope:**

- Pilot case fixtures for transport/schedule + notice override + place context.
- Expected workflow mode and ordered step sequence.
- Expected allowed agents / allowed tools.
- Expected projection kinds and required source refs.
- Fail-close cases for missing baseline, missing notice body, ambiguous stop, stale projection, insufficient evidence, and closed capability.

## Phase 3: Private Step Artifact Contract

**Status:** deferred

**Goal:** define private workflow projections without prematurely promoting them to `packages/contracts`.

**Scope:**

- `ScheduleBaseline`.
- `NoticeChangeSet`.
- `CanonicalNoticeContext`.
- `PlaceContext` / `StopContext`.
- `EvidenceBundle`.
- `GroundingVerdict`.
- Projection hash, length limit, visibility posture, source refs, and safety summary.

## Phase 4: Go WorkflowPlan Admission Extension

**Status:** deferred

**Goal:** teach Go to express admitted manager-style multi-agent plans.

**Scope:**

- `allowed_agents`.
- `allowed_tools`.
- ordered step plan.
- required input / output projection kinds.
- step timeout / budget.
- retry / replan posture.
- terminal fail-close policy.
- trace projection skeleton.

**Non-Scope:** executing semantic agent reasoning in Go.

## Phase 5: Python Step Runner Runtime

**Status:** deferred

**Goal:** execute the admitted Go plan in Python without creating a free-form agent graph.

**Scope:**

- Step runner consumes `WorkflowPlan`.
- Agent dispatcher runs one bounded step at a time.
- Provider function calling remains limited to allowed tools.
- Step output validation and fail-close mapping.
- No raw provider/tool/source payload in `AgentResponse` or workflow trace.

## Phase 6: Domain Agent Projection Outputs

**Status:** deferred

**Goal:** make selected domain agents produce/consume pilot projections.

**Scope:**

- `campus-services-agent` emits `ScheduleBaseline`.
- `notice-agent` emits `NoticeChangeSet` / `CanonicalNoticeContext`.
- `navigation-agent` emits `PlaceContext` / `StopContext`.
- `rag-agent` consumes bounded upstream context and emits `EvidenceBundle` /
  `GroundingVerdict`.

## Phase 7: Transport Schedule + Notice Override + Place Context Pilot

**Status:** deferred

**Goal:** prove the first governed multi-agent workflow end to end.

**Scope:**

- Go planner chooses multi-step only for admitted pilot cases.
- Python step runner executes ordered agent steps.
- Go finalizer returns a supervisor-style response.
- Trace proves step sequence and bounded context exchange.
- Fail-close paths remain deterministic.

## Phase 8: Observability, Eval, And Guardrail Closeout

**Status:** deferred

**Goal:** make the workflow operable and regression-safe.

**Scope:**

- Operator-safe workflow summary.
- Agent step and projection summary.
- Tool call correlation and provider call id projection.
- Eval release gate for workflow trace.
- Drift guards preventing raw payload leakage and hidden global tool choice.

## Phase 9: Second Scenario Admission Decision

**Status:** deferred

**Goal:** decide whether to expand after the pilot is proven.

**Candidate Scenario:**

```text
service handling question
-> campus-services-agent guide/status/contact facts
-> navigation-agent place context
-> rag-agent policy/reference evidence
-> Go supervisor finalization
```

**Decision Rule:** expand only if Phase 7/8 show measurable correctness, traceability, and failure isolation improvement over single-agent/direct runtime.
