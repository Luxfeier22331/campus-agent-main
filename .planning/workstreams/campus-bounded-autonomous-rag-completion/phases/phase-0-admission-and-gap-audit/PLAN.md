---
doc_type: phase_plan
status: planned
created: 2026-05-04
updated: 2026-05-04
---

<!-- markdownlint-disable MD013 -->

# Phase 0 Plan: Admission And Gap Audit

## Objective

Produce an implementation-ready gap matrix for campus-bounded autonomous RAG completion, with exact
file/test ownership for Phases 1-6 and no query-surface expansion.

## Phase Position

This phase is the admission gate. It must finish before any runtime code is changed.

It converts the broad workstream goal into concrete implementation slices:

- bounded supervisor/domain-agent to RAG handoff
- query mode, version and source-trust planning
- answer-bearing evidence and claim grounding
- untrusted content/tool guardrails
- RAGAS/workflow eval denominator and regression gates
- runtime budgets, cancellation and trace-safe observability

## Source Documents To Read

- `.planning/workstreams/campus-bounded-autonomous-rag-completion/README.md`
- `.planning/workstreams/campus-bounded-autonomous-rag-completion/REQUIREMENTS.md`
- `.planning/workstreams/agentic-rag-runtime-rearchitecture/README.md`
- `.planning/workstreams/agentic-rag-runtime-rearchitecture/ROADMAP.md`
- `.planning/workstreams/agentic-rag-runtime-rearchitecture/STATE.md`
- `.planning/workstreams/supervisor-multi-agent-runtime-contract-hardening/README.md`
- `.planning/workstreams/supervisor-multi-agent-runtime-contract-hardening/REQUIREMENTS.md`
- `.planning/workstreams/canonical-retrieval-quality-ops-hardening/README.md`
- `.planning/workstreams/canonical-retrieval-quality-ops-hardening/REQUIREMENTS.md`
- `docs/architecture/system/agentic-retrieval-architecture.md`
- `docs/architecture/system/execution-and-agents-architecture.md`
- `docs/architecture/system/retrieval-serving-architecture.md`
- `docs/architecture/current-architecture.md`
- `docs/architecture/target-architecture.md`

## Code Areas To Audit

- `packages/rag-agent/src/campus_rag_agent/service.py`
- `packages/rag-agent/src/campus_rag_agent/service_planner_stage.py`
- `packages/rag-agent/src/campus_rag_agent/service_retrieval_stage.py`
- `packages/rag-agent/src/campus_rag_agent/service_evidence_stage.py`
- `packages/rag-agent/src/campus_rag_agent/service_answer_synthesis.py`
- `packages/rag-agent/src/campus_rag_agent/service_stage_diagnostics.py`
- `packages/rag-agent/src/campus_rag_agent/service_observability.py`
- `packages/rag-agent/src/campus_rag_agent/grounding_validation.py`
- `packages/rag-agent/src/campus_rag_agent/remote_content_hardening.py`
- `packages/rag-agent/src/campus_rag_agent/prompt_packets.py`
- `packages/retrieval-core/src/campus_retrieval_core/service.py`
- `packages/retrieval-core/src/campus_retrieval_core/service_execution.py`
- `packages/retrieval-core/src/campus_retrieval_core/service_requests.py`
- `packages/contracts/src/campus_contracts/models_runtime.py`
- `packages/contracts/src/campus_contracts/models_retrieval.py`
- `packages/contracts/src/campus_contracts/models_tools.py`
- `apps/supervisor-api/internal/execution/bridge_payload.go`
- `apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/bridge_v6_parser.py`
- `apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/agent_dispatch.py`
- `apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/tool_spec_registry.py`
- `apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/bridge_context_projection_codecs.py`
- `packages/evals/src/campus_evals/ragas_diagnostic_runner.py`
- `packages/evals/src/campus_evals/agentic_retrieval_plan_eval.py`
- `packages/evals/src/campus_evals/workflow_trace_gate.py`
- `packages/evals/src/campus_evals/multi_agent_product_path_gate.py`

## Test Areas To Audit

- `tests/agent/rag_agent_agentic_runtime_contract_suite.py`
- `tests/agent/rag_agent_answer_quality_regression_suite.py`
- `tests/agent/rag_agent_answer_grounding_suite.py`
- `tests/agent/rag_agent_request_prompt_grounding_suite.py`
- `tests/agent/rag_agent_official_web_guardrails_suite.py`
- `tests/agent/test_rag_retrieval_plan.py`
- `tests/contracts/contract_models_runtime_and_tools_suite.py`
- `tests/contracts/contract_models_request_and_retrieval_suite.py`
- `tests/contracts/supervisor_execution_fixture_matrix_suite.py`
- `tests/supervisor/agent_dispatch_suite.py`
- `tests/supervisor/tool_spec_registry_suite.py`
- `tests/api/supervisor_api_bridge_contract_suite.py`
- `tests/api/supervisor_api_bridge_handoff_suite.py`
- `tests/evals/ragas_diagnostic_runner_suite.py`
- `tests/evals/agentic_retrieval_plan_eval_suite.py`
- `tests/evals/multi_agent_product_path_gate_suite.py`
- `tests/evals/rag_eval_coverage_suite.py`

Do not edit these files in Phase 0; use them to map implementation gaps only.

## Work Breakdown

1. Confirm the no-opening boundary:
   - default query-enabled scopes remain `student_rules`, `institutional_rules`,
     `curriculum_plan` and `official_web/stable_reference`
   - `official_web/fresh_news`, general web fallback and arbitrary URL fetch stay out of scope
   - `freshness_sensitive` and `live_assisted` remain closed unless a separate admission opens them
2. Build a RAG runtime stage map:
   - planner inputs/outputs
   - retrieval plan and execution
   - evidence selection
   - synthesis
   - grounding
   - observability/diagnostics
3. Build a supervisor handoff map:
   - Go handoff payload
   - bridge v6 parser
   - `AgentRequest.workflow_context`
   - allowed tool derivation
   - Python dispatcher
4. Build an eval denominator map:
   - current RAGAS diagnostic cases
   - agentic retrieval plan cases
   - workflow trace gate cases
   - product path gate cases
   - missing regression classes
5. Resolve model-surface ownership before implementation:
   - `EVAL_RAGAS_MODEL` and `EVAL_JUDGE_MODEL` belong to eval/judge paths
   - `PROMPT_RUNTIME_MODEL` belongs to product chat runtime
   - Product chat runtime model changes require explicit admission and are not incidental
     budget/observability work
6. Decide provider/tool runtime edit eligibility:
   - Provider and SDK tool runtime files are editable in later phases only if the gap matrix shows a
     RAG product path reaches that boundary
   - Otherwise guardrail implementation stays in RAG prompt/evidence/grounding and eval redaction
7. Produce a gap matrix with these columns:
   - `gap_id`
   - `phase`
   - `current_fact`
   - `required_behavior`
   - `classification`
   - `owned_files`
   - `owned_tests`
   - `verification_command`
   - `out_of_scope_notes`
8. Update Phase 1-6 summaries if the audit discovers changed ownership assumptions.

## TDD Requirements For Later Phases

This phase does not write runtime tests unless it discovers an existing test command is broken.
It must define the first failing test target for each later phase.

Required test-first targets:

- Phase 1: raw workflow context and disallowed projection refs fail closed
- Phase 2: live/fresh branches cannot be reached from default current RAG
- Phase 3: title/entity hits without answer-bearing evidence do not produce completed answers
- Phase 4: retrieved malicious instructions cannot alter policy or tool use
- Phase 5: RAGAS/workflow diagnostics attribute failures by stage
- Phase 6: max steps/replans/tools/timeouts produce typed fail-close outcomes
- Model-surface gate: eval/judge model config and product chat runtime model config cannot be
  conflated

## Write Set

Allowed:

- `.planning/workstreams/campus-bounded-autonomous-rag-completion/phases/phase-0-admission-and-gap-audit/SUMMARY.md`
- `.planning/workstreams/campus-bounded-autonomous-rag-completion/STATE.md`
- Minor planning-only corrections in this workstream if the audit finds inconsistencies

Not allowed:

- Runtime code
- Eval fixture changes
- Architecture docs, unless correcting a planning factual error

## Verification

Run:

```bash
pnpm docs:lint
git diff --check -- .planning/workstreams/campus-bounded-autonomous-rag-completion .planning/WORKSTREAMS.md
```

Optional audit-only import checks if the file map changes unexpectedly:

```bash
uv run --all-packages python -m unittest \
  tests.agent.rag_agent_agentic_runtime_contract_suite \
  tests.evals.ragas_diagnostic_runner_suite \
  tests.contracts.contract_models_runtime_and_tools_suite
```

## Exit Criteria

- `SUMMARY.md` contains the full gap matrix.
- Each later phase has concrete owned files and owned tests.
- The workstream still explicitly excludes `fresh_news`, general web fallback and arbitrary URL fetch.
- No implementation phase depends on moving source-truth ownership into `rag-agent` or
  `retrieval-core`.
- `STATE.md` points to Phase 1 as next only after the audit matrix is complete.

## Risks

- Risk: duplicated work from completed workstreams.
  Mitigation: classify as `implemented` or `acceptance-only` instead of reimplementing.
- Risk: treating target architecture as current truth.
  Mitigation: separate `current_fact` and `required_behavior` in the matrix.
- Risk: expanding RAG into structured current-state capabilities.
  Mitigation: require bounded projection consumption rather than retrieval-step ownership.
