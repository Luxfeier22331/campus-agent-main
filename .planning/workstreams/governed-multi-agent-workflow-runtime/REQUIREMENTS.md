---
doc_type: requirements
status: completed
created: 2026-05-01
updated: 2026-05-06
---

<!-- markdownlint-disable MD013 -->

# Requirements: Governed Multi-Agent Workflow Runtime

## Goals

- Establish the repo-owned target plan for governed multi-agent workflow runtime.
- Keep Go `supervisor-api` as deterministic workflow governance owner.
- Keep Python `supervisor-agent-worker` and domain agents as bounded semantic execution owners.
- Require typed cross-agent artifact exchange before implementation.
- Define readiness criteria for tool / agent single-step gates before any multi-agent runtime work starts.
- Define the first pilot around transport schedule baseline + notice override + grounding.
- Own future step-local Agents SDK runtime for governed workflow steps without promoting SDK graph
  state to repo-level truth.

## Functional Requirements

- `WorkflowPlan` must express workflow mode, selected steps, allowed agents, allowed tools, required input/output projection kinds, timeout/budget posture, retry/replan posture, and fail-close policy.
- Multi-agent execution must be impossible without explicit Go-owned workflow admission.
- `WorkflowPlan.allowed_agents` must validate against repo-owned `AgentSpec` or equivalent
  canonical artifact, not free-form target strings.
- Each agent step must consume bounded typed input projection and return bounded typed output projection.
- Cross-agent context must be represented as `StepOutputProjection` or a compatible private workflow projection, not raw text blobs.
- First pilot must distinguish stable baseline schedule facts, notice-derived overrides, evidence bundle, and grounding verdict.
- Workflow trace must distinguish terminal, direct runtime, single handoff, and multi-step manager-style execution.
- Operator/eval projection must expose agent step summaries, projection ids, hashes, safety summaries, source refs, business outcome, and fail-close reason without raw payload leakage.
- Provider-native function calling must stay limited to Go `allowed_tools` and ToolSpec-derived schema.
- Agents SDK, when used in this workstream, must stay inside an already admitted workflow step and
  must validate output into repo-owned private workflow projection types.
- Private projection payload schemas must have a declared runtime config location, schema version,
  Go validator owner, Python validator owner, eval owner, and promotion rule before runtime code uses
  them.
- Step runner execution must produce a minimum sanitized trace before Phase 5 exit: run ref, step id,
  agent id, projection refs, output projection hash/kind, status, terminal reason, and fail-close
  reason without raw payload leakage.
- Parallel fanout must be explicit in `WorkflowPlan`; provider free parallel tool calls must remain disabled unless separately admitted.
- Product rollout must remain gate-controlled; implementation readiness does not automatically open public chat.

## Readiness Dependencies

Phase 1 is complete. Runtime implementation may proceed while these dependencies stay current:

- `transport_schedule_lookup` has fresh single-tool product-path evidence for baseline schedule, next departure, service windows, exceptions, source conflicts, and fail-close semantics.
- `campus_notice_discover` has fresh evidence for canonical notice selection, title/source URL/date
  card search, bounded result projection, and fail-close semantics.
- selected notice card/context projection has fresh evidence for deterministic selected notice
  resolution without reopening `campus_notice_get` as a top-level ToolSpec / provider / SDK tool.
- `rag-agent` can consume bounded upstream context and produce grounded synthesis or a fail-close `GroundingVerdict`.
- `AgentSpec` / `ToolSpec` registries, provider function schema generation, allowed-agents policy,
  and allowed-tools runtime policy remain drift-guarded.
- `workflow_trace` eval denominator can assert selected step sequence, allowed agents/tools, context projections, and final answer grounding.
- Operator observability can show sanitized step / projection summary without raw source or provider payload.

## Non-Goals

- No immediate implementation while prerequisite tools / agents are unverified.
- No replacement of Go supervisor governance with LLM triage.
- No provider-native global tool choice across all campus tools.
- No peer-to-peer agent mesh.
- No hidden specialist agent without AgentSpec, projection contract, readiness row, and eval
  denominator.
- No generic web fallback or remote MCP answer-bearing fallback.
- No direct exposure of ingestion, collector, object store, raw SQL, or index build paths as query-time tools.
- No new product serving surface admission.
- No change to `packages/contracts` until private workflow projections stabilize.
- No SDK-owned global workflow graph, SDK-native session memory, raw SDK trace, or SDK-native type in
  `packages/contracts`, panel, eval canonical artifacts, public responses, or workflow trace truth.
- No state-changing service actions. Booking, submission, payment, ticket creation, approval, or
  rollback require a separate approval / HITL workstream.

## Success Criteria

- Workstream planning clearly identifies blockers, phases, dependencies, and resume criteria.
- First implementation phase cannot start without explicit readiness evidence for all prerequisite tools / agents.
- Pilot cases have expected workflow mode, step sequence, projection kinds, fail-close branches, and answer-grounding expectations.
- Private artifact contract can be validated before any public/shared contract promotion.
- `READINESS-MATRIX.md` maps each external pilot dependency to owner, evidence, verification
  command, freshness, verdict, and runtime admission impact before runtime implementation begins.
- Internal gates in `READINESS-MATRIX.md` map Phase 2/3/4/5/8 deliverables to their blocking
  dependent phase without self-blocking Phase 1.
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
