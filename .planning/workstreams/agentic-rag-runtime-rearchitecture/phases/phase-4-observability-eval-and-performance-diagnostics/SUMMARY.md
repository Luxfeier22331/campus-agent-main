---
doc_type: summary
status: active
created: 2026-05-04
updated: 2026-05-04
---

# Phase 4 Summary

Phase 4 已完成首轮 eval / perf diagnostic 实现。

## Completed

- `campus_evals.ragas_diagnostic_runner` 现在为每个 diagnostic case 输出
  `performance_breakdown`：
  `retrieval_ms`、`answer_ms`、`scorer_ms`、`diagnostic_ms`、`dependency_wait_ms`。
- diagnostic summary 现在聚合 `performance_breakdown`，输出 case count、sum、mean、max，
  用于区分 runtime retrieval / answer cost 与 scorer / diagnostic overhead。
- diagnostic case 现在输出 `failure_attribution`，按 metric 维度区分：
  `context_recall/context_precision -> retrieval`，
  `faithfulness/answer_relevancy -> synthesis`，其他异常归 `diagnostic`。
- summary 现在聚合 primary failure stage：`passed`、`retrieval`、`evidence_selection`、
  `synthesis`、`diagnostic`、`failed`。
- 新增 regression test 证明低 `context_recall` 和低 `answer_relevancy` 可以在同一 case
  内被分别归因，不再只看最终低分。
- 保留现有 `case_workers` 并发能力；本 phase 没有回退到单线程诊断。

## Boundary Decisions

- 本 phase 只增强 eval diagnostic report，不接管 eval workstream owner。
- performance breakdown 是 deterministic local timing，不依赖 provider raw trace，也不暴露 raw
  prompt / raw provider response。
- PyTorch / optional dependency noise 不再被混同为 retrieval 或 answer runtime；它会体现在
  scorer / diagnostic overhead。

## Verification

- `uv run --all-packages python -m unittest tests.evals.ragas_diagnostic_runner_suite`
- `uv run --all-packages python -m unittest tests.evals.ragas_diagnostic_runner_suite tests.evals.ragas_runtime_scorer_defaults_suite tests.evals.ragas_runtime_settings_suite tests.contracts.contract_models_runtime_and_tools_suite tests.contracts.contract_models_request_and_retrieval_suite tests.agent.rag_agent_agentic_runtime_contract_suite tests.agent.rag_agent_answer_quality_regression_suite tests.agent.rag_agent_request_prompt_fallback_suite tests.agent.rag_agent_request_prompt_grounding_suite tests.agent.rag_agent_answer_grounding_suite tests.agent.rag_agent_curriculum_family_facts_program_suite tests.agent.rag_agent_curriculum_family_facts_course_suite tests.agent.rag_agent_curriculum_family_facts_schedule_suite tests.agent.test_rag_retrieval_plan`
- `uv run --all-packages ruff check packages/evals/src/campus_evals/ragas_diagnostic_runner.py tests/evals/ragas_diagnostic_runner_suite.py packages/rag-agent/src/campus_rag_agent/confidence.py packages/rag-agent/src/campus_rag_agent/service.py packages/rag-agent/src/campus_rag_agent/service_evidence_stage.py packages/rag-agent/src/campus_rag_agent/service_planner_stage.py packages/rag-agent/src/campus_rag_agent/service_retrieval.py packages/rag-agent/src/campus_rag_agent/service_retrieval_stage.py tests/agent/rag_agent_agentic_runtime_contract_suite.py tests/agent/rag_agent_answer_grounding_suite.py tests/agent/rag_agent_test_support.py`
- `uv run --all-packages ruff format --check packages/evals/src/campus_evals/ragas_diagnostic_runner.py tests/evals/ragas_diagnostic_runner_suite.py packages/rag-agent/src/campus_rag_agent/confidence.py packages/rag-agent/src/campus_rag_agent/service.py packages/rag-agent/src/campus_rag_agent/service_evidence_stage.py packages/rag-agent/src/campus_rag_agent/service_planner_stage.py packages/rag-agent/src/campus_rag_agent/service_retrieval.py packages/rag-agent/src/campus_rag_agent/service_retrieval_stage.py tests/agent/rag_agent_agentic_runtime_contract_suite.py tests/agent/rag_agent_answer_grounding_suite.py tests/agent/rag_agent_test_support.py`

## Next

Phase 5 should close out old heuristic shortcuts and write the final reopen rule now that
planner/evidence/provenance/diagnostic seams are explicit.
