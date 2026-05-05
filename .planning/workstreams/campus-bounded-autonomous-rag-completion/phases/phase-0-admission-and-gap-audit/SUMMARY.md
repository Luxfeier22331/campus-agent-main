---
doc_type: phase_summary
status: completed
created: 2026-05-04
updated: 2026-05-04
---

<!-- markdownlint-disable MD013 -->

# Phase 0 Summary: Admission And Gap Audit

## Status

Completed in current worktree.

## Audit Conclusion

This workstream is a bounded completion and acceptance line, not a new architecture opening.
Current worktree truth keeps the RAG query-enabled scope limited to:

| Scope | Posture |
| --- | --- |
| `regulations/student_rules` | admitted current RAG surface |
| `regulations/institutional_rules` | admitted current RAG surface |
| `curriculum/curriculum_plan` | admitted current RAG surface |
| `official_web/stable_reference` | admitted current RAG surface |

The audit did not admit `official_web/fresh_news`, general web fallback, arbitrary URL fetch,
provider-hosted web search or product-chat model migration.

## Gap Matrix

| gap_id | phase | current_fact | required_behavior | classification | owned_files | owned_tests | verification_command | out_of_scope_notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `G0-scope` | 0 | Retrieval serving architecture already defines only four current query-enabled surfaces. | Preserve no-opening posture while closing runtime/eval gaps. | acceptance-only | workstream planning docs | docs lint / diff check | `pnpm docs:lint`; `git diff --check -- .planning/workstreams/campus-bounded-autonomous-rag-completion .planning/WORKSTREAMS.md` | `fresh_news`, web fallback and arbitrary fetch remain excluded. |
| `G1-projection-ref-metadata` | 1 | `WorkflowAgentContext` rejected raw trace keys and required projection kind, but projection refs could omit stable bounded metadata. | Projection refs must include `projection_id`, `source_step_id`, `projection_kind`, `content_hash` and non-empty `safety`. | implemented | `packages/contracts/src/campus_contracts/models_runtime.py` | `tests/contracts/contract_models_runtime_and_tools_suite.py` | `uv run --all-packages python -m unittest tests.contracts.contract_models_runtime_and_tools_suite tests.contracts.supervisor_execution_fixture_matrix_suite` | No retrieval executable/provider type was added to contracts. |
| `G1-tool-dispatch-fixture` | 1 | ToolSpec included `academic_calendar_lookup`, but Python dispatcher active-tool coverage fixture did not include the new handoff tool. | Every active structured handoff tool in ToolSpec must have dispatcher acceptance coverage. | implemented | `tests/supervisor/agent_dispatch_suite.py` | `tests/supervisor/agent_dispatch_suite.py`; `tests/supervisor/tool_spec_registry_suite.py` | `uv run --all-packages python -m unittest tests.supervisor.agent_dispatch_suite tests.supervisor.tool_spec_registry_suite` | Calendar work itself is unrelated; this only closes ToolSpec coverage drift. |
| `G2-query-mode-source-trust` | 2 | Planner/retrieval tests already cover current/version modes, source trust and fail-close behavior. | Default current RAG must not enter `freshness_sensitive`, `live_assisted` or `fresh_news`. | acceptance-only | `packages/rag-agent`; `packages/retrieval-core`; `packages/contracts` | `tests.agent.test_rag_retrieval_plan`; `tests.agent.rag_agent_clarification_versioning_suite`; `tests.agent.rag_agent_curriculum_planning_suite`; `tests.agent.rag_agent_official_web_guardrails_suite`; `tests.retrieval.retrieval_service_live_lookup_and_fail_close_suite` | included in the 223-test focused gate | Live/fresh branches remain deferred and require separate admission. |
| `G3-stage-diagnostics-test-drift` | 3 | RAG now emits stage activities for clarification/no-answer paths, but old tests asserted whole diagnostics equality against empty stage state. | Tests should verify semantic fail-close fields while preserving stage activity observability. | implemented | `tests/agent/rag_agent_clarification_versioning_suite.py`; `tests/agent/rag_agent_curriculum_planning_suite.py` | same files | included in the 223-test focused gate | No evidence/synthesis behavior was weakened. |
| `G3-evidence-grounding` | 3 | `title_lookup` has no answer-success authority; answer grounding and quality regression suites exist. | Final answers need answer-bearing support and grounding diagnostics. | acceptance-only | `packages/rag-agent` | `tests.agent.rag_agent_answer_quality_regression_suite`; `tests.agent.rag_agent_answer_grounding_suite` | included in the 223-test focused gate | No collection-specific special case was added. |
| `G4-untrusted-content` | 4 | Remote content hardening and prompt grounding guardrail suites already cover untrusted retrieved/source content behavior. | Retrieved/projection/source content remains data, not instruction or tool policy. | acceptance-only | `packages/rag-agent` guardrail/prompt modules | `tests.agent.rag_agent_request_prompt_grounding_suite`; `tests.agent.rag_agent_official_web_guardrails_suite`; `tests.evals.workflow_trace_gate_suite` | included in the 223-test focused gate | Provider/tool runtime files were not edited because Phase 0 found no RAG boundary trigger. |
| `G5-denominator` | 5 | RAGAS diagnostic small sample covered only student rules, institutional rules and curriculum. | Small-sample RAGAS diagnostic must include all current admitted RAG surfaces. | implemented | `packages/evals/src/campus_evals/ragas_diagnostic_runner.py` | `tests/evals/ragas_diagnostic_runner_suite.py`; `tests/evals/rag_eval_coverage_suite.py` | `uv run --all-packages python -m unittest tests.evals.ragas_diagnostic_runner_suite tests.evals.rag_eval_coverage_suite` | `official_web/fresh_news` remains excluded. |
| `G5-answer-quality-attribution` | 5 | Low `answer_relevancy` / `faithfulness` was attributed to synthesis even when raw retrieval had the expected doc but evidence selection dropped it. | Attribution must distinguish retrieval misses, evidence selection misses and synthesis failures. | implemented | `packages/evals/src/campus_evals/ragas_diagnostic_runner.py` | `tests/evals/ragas_diagnostic_runner_suite.py` | included in the Phase 5 eval gate | This is diagnostic attribution, not a production reranking/profile change. |
| `G5-scorer-performance` | 5 | RAGAS runner already had case workers and performance breakdown. | Preserve concurrent scorer support and runtime-vs-scorer overhead separation. | acceptance-only | `packages/evals/src/campus_evals` | `tests.evals.ragas_runtime_scorer_suite`; `tests.evals.ragas_runtime_http_transport_async_suite` | `uv run --all-packages python -m unittest tests.evals.ragas_runtime_scorer_suite tests.evals.ragas_runtime_http_transport_async_suite` | No dollar-budget control was added. |
| `G6-runtime-budgets` | 6 | Retrieval replan/live lookup fail-close, RAG fallback, cancel flags, bridge runtime and audit tests already exist. | Budget/cancel/timeout/fail-close outcomes must stay typed and trace-safe. | acceptance-only | `packages/retrieval-core`; `packages/rag-agent`; `apps/supervisor-api`; `apps/supervisor-agent-worker`; `packages/evals` | Phase 6 focused runtime gate | `uv run --all-packages python -m unittest tests.retrieval.retrieval_service_replan_execution_suite tests.retrieval.retrieval_service_live_lookup_and_fail_close_suite tests.agent.rag_agent_agentic_runtime_contract_suite tests.agent.rag_agent_request_prompt_fallback_suite tests.supervisor.test_cancel_flags tests.supervisor.agents_sdk_runner_suite tests.api.supervisor_api_bridge_runtime_suite tests.api.supervisor_api_audit_suite tests.evals.ragas_diagnostic_runner_suite tests.evals.ragas_runtime_scorer_failure_suite tests.evals.ragas_runtime_retry_policy_suite tests.evals.ragas_runtime_settings_suite` | Product chat runtime model was not changed. |

## Model Surface Resolution

`gpt-5.4` remains an eval/judge target for `EVAL_RAGAS_MODEL` / `EVAL_JUDGE_MODEL` paths. Product
chat runtime config such as `PROMPT_RUNTIME_MODEL` is a separate surface and was not changed by
this workstream.

## Provider Runtime Edit Gate

Provider SDK/tool runtime files were treated as verification targets only. No Phase 4 provider
runtime edit was made because the audited RAG path is already guarded through ToolSpec admission,
RAG prompt packet hardening, workflow trace redaction and eval gates.

## Verification Evidence

Focused gates run during this implementation:

```bash
uv run --all-packages python -m unittest \
  tests.contracts.contract_models_runtime_and_tools_suite \
  tests.contracts.supervisor_execution_fixture_matrix_suite \
  tests.api.supervisor_api_bridge_contract_suite \
  tests.api.supervisor_api_bridge_handoff_suite \
  tests.supervisor.agent_dispatch_suite \
  tests.supervisor.tool_spec_registry_suite \
  tests.agent.rag_agent_agentic_runtime_contract_suite \
  tests.agent.test_rag_retrieval_plan \
  tests.agent.rag_agent_clarification_versioning_suite \
  tests.agent.rag_agent_curriculum_planning_suite \
  tests.agent.rag_agent_official_web_guardrails_suite \
  tests.retrieval.retrieval_service_live_lookup_and_fail_close_suite \
  tests.contracts.contract_models_request_and_retrieval_suite \
  tests.evals.agentic_retrieval_plan_eval_suite \
  tests.agent.rag_agent_answer_quality_regression_suite \
  tests.agent.rag_agent_answer_grounding_suite \
  tests.agent.rag_agent_request_prompt_grounding_suite \
  tests.evals.ragas_diagnostic_runner_suite \
  tests.evals.workflow_trace_gate_suite \
  tests.evals.multi_agent_product_path_gate_suite \
  tests.evals.rag_eval_coverage_suite
```

Result: 223 tests passed.
