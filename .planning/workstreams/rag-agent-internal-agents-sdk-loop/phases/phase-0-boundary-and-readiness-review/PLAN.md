---
doc_type: phase_plan
status: planned
created: 2026-05-05
updated: 2026-05-05
---

<!-- markdownlint-disable MD013 -->

# Phase 0 Plan: Boundary And Readiness Review

## Objective

Produce an implementation-ready readiness matrix for introducing the official OpenAI Agents SDK
inside `rag-agent`, without changing runtime code, opening public ToolSpec surfaces or weakening
retrieval / grounding / observability boundaries.

## Phase Position

This is the GSD planning gate for the workstream. It converts the roadmap into executable later
phases and must finish before any SDK implementation starts.

## Source Documents To Read

- `.planning/workstreams/rag-agent-internal-agents-sdk-loop/README.md`
- `.planning/workstreams/rag-agent-internal-agents-sdk-loop/REQUIREMENTS.md`
- `.planning/workstreams/rag-agent-internal-agents-sdk-loop/ROADMAP.md`
- `.planning/workstreams/rag-agent-internal-agents-sdk-loop/STATE.md`
- `.planning/workstreams/rag-agent-internal-agents-sdk-loop/phases/phase-0-boundary-and-readiness-review/CONTEXT.md`
- `.planning/workstreams/rag-agent-internal-agents-sdk-loop/phases/phase-0-boundary-and-readiness-review/RESEARCH.md`
- `.planning/workstreams/agents-sdk-domain-agent-adapter-promotion/README.md`
- `.planning/workstreams/agents-sdk-domain-agent-adapter-promotion/STATE.md`
- `.planning/workstreams/agentic-rag-runtime-rearchitecture/ROADMAP.md`
- `.planning/workstreams/campus-bounded-autonomous-rag-completion/ROADMAP.md`
- `docs/architecture/system/execution-and-agents-architecture.md`
- `docs/architecture/system/agentic-retrieval-architecture.md`
- `docs/architecture/system/retrieval-serving-architecture.md`

## Code Areas To Audit

- `configs/runtime/tools.v1.json`
- `configs/runtime/agents.v1.json`
- `packages/rag-agent/src/campus_rag_agent/service.py`
- `packages/rag-agent/src/campus_rag_agent/service_pipeline.py`
- `packages/rag-agent/src/campus_rag_agent/service_planner_stage.py`
- `packages/rag-agent/src/campus_rag_agent/service_retrieval_stage.py`
- `packages/rag-agent/src/campus_rag_agent/service_evidence_stage.py`
- `packages/rag-agent/src/campus_rag_agent/service_answer_synthesis.py`
- `packages/rag-agent/src/campus_rag_agent/grounding_validation.py`
- `packages/rag-agent/src/campus_rag_agent/semantic_replan.py`
- `apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/agents_sdk_openai_runner.py`
- `apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/agents_sdk_runner.py`
- `apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/agents_sdk_trace_projection.py`
- `apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/agent_delegates.py`

## Work Breakdown

1. Confirm config truth:
   - `retrieval.query` remains internal/closed.
   - `rag-agent` still has no structured handoff tool allowlist.
   - no RAG SDK implementation should require ToolSpec expansion.
2. Confirm SDK dependency and API assumptions:
   - detect installed `openai-agents` version from lock/dependency files.
   - map which conformance tests Phase 2 must add before relying on SDK APIs.
3. Build RAG pipeline insertion map:
   - deterministic scope/version/preflight owner.
   - planner stage outputs available before SDK.
   - retrieval/evidence/synthesis components that SDK may replace or wrap.
   - components that must remain deterministic.
4. Build query-intent and category-discovery boundary:
   - classify `specific_policy_lookup`, `category_discovery`, `ambiguous_procedure`,
     `fact_lookup`, `comparison`, `unsupported_scope`.
   - decide how `奖学金` category discovery avoids premature clarification.
   - keep `门户密码忘了怎么办` out of current RAG answer scope.
5. Build claim/span grounding readiness map:
   - identify reusable grounding validators.
   - identify required source/excerpt/span fields available from evidence.
   - define tests needed for unsupported claim and uncited list-item rejection.
6. Build bounded replan readiness map:
   - identify existing `semantic_replan` behavior.
   - define query-slot selection versus admitted semantic replan.
   - freeze max replan count, reason requirement and no-widening constraints for later phases.
7. Build trace and observability posture:
   - confirm native SDK tracing remains disabled by default.
   - define sanitized fields allowed in diagnostics.
   - define redaction tests required later.
8. Build rollout mode matrix:
   - `candidate`
   - `shadow`
   - `default_on`
   - `fallback_only`
   - `closed`
   - decide which mode Phase 3 begins with.
9. Produce `SUMMARY.md` with readiness matrix:
   - `area`
   - `current_fact`
   - `required_behavior`
   - `phase_owner`
   - `owned_files`
   - `owned_tests`
   - `verification_command`
   - `risk_if_missing`

## Threat Model

- Risk: SDK output produces plausible but unsupported answer.
  Mitigation: claim/span grounding gate and fail-closed unsupported outcome.
- Risk: model query rewrite widens retrieval scope.
  Mitigation: deterministic query slots by default and bounded replan no-widening gate.
- Risk: SDK trace leaks raw prompt, transcript or evidence.
  Mitigation: native tracing default-off and sanitized projection tests.
- Risk: long-term dual synthesis paths hide regressions.
  Mitigation: rollout mode matrix and Phase 8 cleanup rule.
- Risk: implementation accidentally exposes `retrieval.query` publicly.
  Mitigation: config truth check and drift tests.

## Write Set

Allowed:

- `.planning/workstreams/rag-agent-internal-agents-sdk-loop/phases/phase-0-boundary-and-readiness-review/SUMMARY.md`
- `.planning/workstreams/rag-agent-internal-agents-sdk-loop/STATE.md`
- Minor corrections to this workstream's `README.md`, `REQUIREMENTS.md` or `ROADMAP.md` if Phase 0
  audit finds factual drift.
- Architecture docs only for boundary clarification required before implementation:
  - `docs/architecture/system/execution-and-agents-architecture.md`
  - `docs/architecture/system/agentic-retrieval-architecture.md`

Not allowed:

- Runtime code.
- Test code.
- ToolSpec or AgentSpec behavior changes.
- Retrieval release / canonical / embedding changes.

## Verification

Run after Phase 0:

```bash
pnpm docs:lint
git diff --check -- \
  .planning/workstreams/rag-agent-internal-agents-sdk-loop \
  .planning/WORKSTREAMS.md \
  docs/architecture/system/execution-and-agents-architecture.md \
  docs/architecture/system/agentic-retrieval-architecture.md
```

Optional read-only sanity checks:

```bash
GSD_WORKSTREAM=rag-agent-internal-agents-sdk-loop \
  gsd-sdk query init.plan-phase 0 --raw --cwd "$PWD"
```

## Exit Criteria

- `SUMMARY.md` exists and contains the readiness matrix.
- Phase 1-8 each have clear owner files, tests and verification commands.
- Phase 2 has explicit SDK conformance tests before SDK-dependent implementation.
- Phase 3 has explicit rollout mode and no silent dual-primary path.
- Phase 4 has claim/span grounding and bounded replan gates.
- Phase 6 has native SDK tracing default-off and sanitized projection rules.
- No public ToolSpec expansion is required.
