---
doc_type: phase_plan
status: planned
created: 2026-05-04
updated: 2026-05-04
---

<!-- markdownlint-disable MD013 -->

# Phase 2 Plan: Query Mode, Version, And Source-Trust Planning

## Objective

Move query mode, version eligibility, source trust and freshness posture into explicit RAG planning
and diagnostics.

## Dependencies

- Phase 1 handoff/tool contract is complete or does not affect planner inputs.
- Phase 0 identifies the exact planner and diagnostics gaps.

## Desired End State

- Planner output explains selected query mode and rejected modes.
- Planner output records source-trust requirements and freshness posture.
- Default current RAG cannot silently fall into `freshness_sensitive`, `live_assisted` or
  `fresh_news`.
- Mode/source mismatch produces no-answer, clarification or fail-close with deterministic reason.
- Diagnostics expose mode/source decisions without leaking raw source content.

## Primary Code Targets

- `packages/rag-agent/src/campus_rag_agent/service_planner_stage.py`
- `packages/rag-agent/src/campus_rag_agent/service_retrieval.py`
- `packages/rag-agent/src/campus_rag_agent/service_versioning.py`
- `packages/rag-agent/src/campus_rag_agent/service_stage_diagnostics.py`
- `packages/rag-agent/src/campus_rag_agent/service_diagnostics_payload.py`
- `packages/rag-agent/src/campus_rag_agent/service_observability.py`
- `packages/rag-agent/src/campus_rag_agent/handbook_query_planning.py`
- `packages/rag-agent/src/campus_rag_agent/curriculum_query_planning.py`
- `packages/retrieval-core/src/campus_retrieval_core/service_requests.py`
- `packages/retrieval-core/src/campus_retrieval_core/service.py`
- `packages/contracts/src/campus_contracts/models_retrieval.py`

## Primary Test Targets

- `tests/agent/test_rag_retrieval_plan.py`
- `tests/agent/rag_agent_agentic_runtime_contract_suite.py`
- `tests/agent/rag_agent_clarification_versioning_suite.py`
- `tests/agent/rag_agent_curriculum_planning_suite.py`
- `tests/agent/rag_agent_official_web_guardrails_suite.py`
- `tests/retrieval/retrieval_service_live_lookup_and_fail_close_suite.py`
- `tests/contracts/contract_models_request_and_retrieval_suite.py`
- `tests/evals/agentic_retrieval_plan_eval_suite.py`

## TDD Plan

1. Add failing planner tests:
   - `current` queries record `query_mode=current`.
   - `historical`, `as_of` and `compare` queries record mode and version constraints.
   - default current query cannot create a `live_source_lookup` or `freshness_sensitive` plan.
2. Add failing source-trust tests:
   - stable official-web reference is allowed only as `stable_reference`.
   - `fresh_news` and `news_archive` are rejected for current RAG planning.
   - restricted or non-serving surfaces fail closed or clarify according to existing policy.
3. Add failing diagnostics tests:
   - diagnostics include `query_mode`, `source_trust_summary`, `freshness_posture` or equivalent
     safe fields identified by Phase 0.
   - mode mismatch is stage-attributed to planner/admission, not synthesis.
4. Add failing eval test:
   - agentic retrieval plan eval can score missing mode/source-trust metadata as a failure.

## Implementation Steps

1. Inspect existing retrieval plan model.
   - Determine whether mode/source fields already exist in `RetrievalPlan` or only in summary.
   - Keep executable plan types in `retrieval-core`/`rag-agent` internal seam.
   - Only expose safe summaries through `packages/contracts`.
2. Add source-trust policy helper if absent.
   - Keep it semantic: collection family, serving role, version mode and eligibility.
   - Do not make `retrieval-core` the product scope owner.
3. Extend planner stage.
   - Resolve mode before plan emission.
   - Attach source-trust/freshness posture to plan or diagnostics.
   - Emit deterministic fail-close reason if requested branch is not opened.
4. Extend diagnostics and observability.
   - Surface mode/source decision in `RagResultDiagnostics` and `AgentObservability.safe_details`.
   - Keep raw source snippets out of diagnostics.
5. Update eval profile.
   - Add agentic retrieval plan cases for current/historical/as_of/compare and disallowed fresh/live.
   - Ensure report names the planner/source-trust failure class.

## Write Set

Allowed:

- RAG planning/diagnostics files listed above
- Retrieval request/plan helpers if the internal plan needs explicit fields
- Safe contract summary fields if needed
- Focused tests/fixtures for query mode and source trust
- Phase summary/state

Not allowed:

- Opening `freshness_sensitive` or `live_assisted`
- Adding query-time broad crawl
- Moving runtime profile or serving alias ownership into RAG
- Treating `fresh_news` as an accepted current RAG source

## Verification

Run focused tests:

```bash
uv run --all-packages python -m unittest \
  tests.agent.test_rag_retrieval_plan \
  tests.agent.rag_agent_agentic_runtime_contract_suite \
  tests.agent.rag_agent_clarification_versioning_suite \
  tests.agent.rag_agent_curriculum_planning_suite \
  tests.agent.rag_agent_official_web_guardrails_suite \
  tests.retrieval.retrieval_service_live_lookup_and_fail_close_suite \
  tests.contracts.contract_models_request_and_retrieval_suite \
  tests.evals.agentic_retrieval_plan_eval_suite
```

Run lint/format for changed Python:

```bash
uv run --all-packages ruff check \
  packages/rag-agent/src/campus_rag_agent \
  packages/retrieval-core/src/campus_retrieval_core \
  packages/contracts/src/campus_contracts \
  packages/evals/src/campus_evals \
  tests/agent tests/retrieval tests/contracts tests/evals
uv run --all-packages ruff format \
  packages/rag-agent/src/campus_rag_agent \
  packages/retrieval-core/src/campus_retrieval_core \
  packages/contracts/src/campus_contracts \
  packages/evals/src/campus_evals \
  tests/agent tests/retrieval tests/contracts tests/evals \
  --check
```

## Exit Criteria

- Query mode is visible in planner diagnostics for all admitted modes.
- Fresh/live branches are explicitly rejected or deferred in tests.
- Source-trust mismatch is deterministic and stage-attributed.
- Eval can detect missing query mode/source-trust metadata.
- Phase summary includes the current source-trust matrix.

## Risks

- Risk: mode logic already exists in multiple places.
  Mitigation: consolidate at planner/admission seam and leave downstream consumers read-only.
- Risk: adding summary fields leaks executable internals.
  Mitigation: expose only safe summaries, not `RetrievalStep` execution objects.
- Risk: compare/as_of tests need fixture data not present locally.
  Mitigation: use deterministic unit-level planner fixtures before release-scale evals.
