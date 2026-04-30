---
doc_type: requirements
status: deferred
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Requirements: Governed Multi-Agent Workflow Runtime

## Goals

- Establish the repo-owned target plan for governed multi-agent workflow runtime.
- Keep Go `supervisor-api` as deterministic workflow governance owner.
- Keep Python `supervisor-agent-worker` and domain agents as bounded semantic execution owners.
- Require typed cross-agent artifact exchange before implementation.
- Define readiness criteria for tool / agent single-step gates before any multi-agent runtime work starts.
- Define the first pilot around transport schedule baseline + notice override + place context + grounding.

## Functional Requirements

- `WorkflowPlan` must express workflow mode, selected steps, allowed agents, allowed tools, required input/output projection kinds, timeout/budget posture, retry/replan posture, and fail-close policy.
- Multi-agent execution must be impossible without explicit Go-owned workflow admission.
- Each agent step must consume bounded typed input projection and return bounded typed output projection.
- Cross-agent context must be represented as `StepOutputProjection` or a compatible private workflow projection, not raw text blobs.
- First pilot must distinguish stable baseline schedule facts, notice-derived overrides, place/stop context, evidence bundle, and grounding verdict.
- Workflow trace must distinguish terminal, direct runtime, single handoff, and multi-step manager-style execution.
- Operator/eval projection must expose agent step summaries, projection ids, hashes, safety summaries, source refs, business outcome, and fail-close reason without raw payload leakage.
- Provider-native function calling must stay limited to Go `allowed_tools` and ToolSpec-derived schema.
- Parallel fanout must be explicit in `WorkflowPlan`; provider free parallel tool calls must remain disabled unless separately admitted.
- Product rollout must remain gate-controlled; implementation readiness does not automatically open public chat.

## Readiness Dependencies

The workstream stays deferred until these are true and current:

- `transport_schedule_lookup` has fresh single-tool product-path evidence for baseline schedule, next departure, service windows, exceptions, source conflicts, and fail-close semantics.
- `campus_notice_discover` / `campus_notice_get` have fresh evidence for canonical notice selection, source-linked body access, bounded notice context projection, and fail-close semantics.
- `navigation-agent` has fresh evidence for place/stop context output that does not own timetable or service-status truth.
- `rag-agent` can consume bounded upstream context and produce grounded synthesis or a fail-close `GroundingVerdict`.
- `ToolSpec` registry, provider function schema generation, and allowed-tools runtime policy remain drift-guarded.
- `workflow_trace` eval denominator can assert selected step sequence, allowed agents/tools, context projections, and final answer grounding.
- Operator observability can show sanitized step / projection summary without raw source or provider payload.

## Non-Goals

- No immediate implementation while prerequisite tools / agents are unverified.
- No replacement of Go supervisor governance with LLM triage.
- No provider-native global tool choice across all campus tools.
- No peer-to-peer agent mesh.
- No generic web fallback or remote MCP answer-bearing fallback.
- No direct exposure of ingestion, collector, object store, raw SQL, or index build paths as query-time tools.
- No new product serving surface admission.
- No change to `packages/contracts` until private workflow projections stabilize.

## Success Criteria

- Workstream planning clearly identifies blockers, phases, dependencies, and resume criteria.
- First implementation phase cannot start without explicit readiness evidence for all prerequisite tools / agents.
- Pilot cases have expected workflow mode, step sequence, projection kinds, fail-close branches, and answer-grounding expectations.
- Private artifact contract can be validated before any public/shared contract promotion.
- Runtime implementation can be verified with deterministic Go/Python tests before any provider-backed behavior is required.
- Observability and eval artifacts can prove the workflow path, not just final answer quality.

## Required Verification Lanes

When implementation resumes, the minimum verification lanes are:

- Go tests for workflow planning, step admission, fail-close, runtime policy, and finalization.
- Python tests for step runner, agent dispatch, provider adapter boundaries, and projection validation.
- Agent package tests for bounded output projection and downstream context consumption.
- Eval tests for workflow trace denominator and pilot expected truth.
- Docs lint and drift checks for architecture / workstream truth.
- `git diff --check`.
