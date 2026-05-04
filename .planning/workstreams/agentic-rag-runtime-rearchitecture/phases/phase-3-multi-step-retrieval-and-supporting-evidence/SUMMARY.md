---
doc_type: summary
status: active
created: 2026-05-04
updated: 2026-05-04
---

# Phase 3 Summary

Phase 3 已完成首轮 runtime adapter 实现。

## Completed

- `service_evidence_stage.execute_rag_evidence_selection_stage` 现在可消费
  `RetrievalExecutionResult`。
- supporting evidence source anchor 现在会被标注 sanitized step provenance：
  `retrieval_plan_id`、`retrieval_step_ids`、`retrieval_replan_count`。
- provenance 只来自 internal `RetrievalExecutionResult.step_results` 的 `grounding` /
  `references`，不把 executable `RetrievalStepResult` 暴露到 contracts。
- evidence selection stage result 新增 `step_support_count`，用于内部判断 supporting
  evidence 覆盖了多少 retrieval step。
- `service.py` 主链路已把 retrieval execution result 传入 evidence selection stage，因此最终
  supporting evidence 可反查 retrieval plan / step。
- 新增 contract regression tests：
  - 两步 retrieval execution result 可在 supporting evidence anchor 中还原 step id。
  - completed answer 的 final supporting evidence 保留 retrieval step provenance。
- 调整旧测试中对 evidence bundle 的整对象等值断言，避免把新增 provenance anchor 误判成行为回归。

## Boundary Decisions

- 本 phase 没有改写 retrieval-core 的 replan executor，也没有扩大 query-enabled surface。
- step-level traceability 作为 rag-agent 内部 adapter 能力落地；contracts 层仍只暴露 sanitized
  retrieval/stage summaries。
- upstream bounded context plumbing 尚未在本 slice 新增；当前完成的是 multi-step / replan
  execution result 到 supporting evidence 的可追溯 adapter。

## Verification

- `uv run --all-packages python -m unittest tests.agent.rag_agent_agentic_runtime_contract_suite`
- `uv run --all-packages python -m unittest tests.agent.rag_agent_agentic_runtime_contract_suite tests.agent.rag_agent_answer_grounding_suite tests.agent.test_rag_retrieval_plan`
- `uv run --all-packages python -m unittest tests.agent.rag_agent_curriculum_family_facts_program_suite tests.agent.rag_agent_curriculum_family_facts_course_suite tests.agent.rag_agent_curriculum_family_facts_schedule_suite`
- `uv run --all-packages python -m unittest tests.contracts.contract_models_runtime_and_tools_suite tests.contracts.contract_models_request_and_retrieval_suite tests.agent.rag_agent_agentic_runtime_contract_suite tests.agent.rag_agent_answer_quality_regression_suite tests.agent.rag_agent_request_prompt_fallback_suite tests.agent.rag_agent_request_prompt_grounding_suite tests.agent.rag_agent_answer_grounding_suite tests.agent.rag_agent_curriculum_family_facts_program_suite tests.agent.rag_agent_curriculum_family_facts_course_suite tests.agent.rag_agent_curriculum_family_facts_schedule_suite tests.agent.test_rag_retrieval_plan`
- `uv run --all-packages ruff check packages/rag-agent/src/campus_rag_agent/confidence.py packages/rag-agent/src/campus_rag_agent/service.py packages/rag-agent/src/campus_rag_agent/service_evidence_stage.py packages/rag-agent/src/campus_rag_agent/service_planner_stage.py packages/rag-agent/src/campus_rag_agent/service_retrieval.py packages/rag-agent/src/campus_rag_agent/service_retrieval_stage.py tests/agent/rag_agent_agentic_runtime_contract_suite.py tests/agent/rag_agent_answer_grounding_suite.py tests/agent/rag_agent_test_support.py`
- `uv run --all-packages ruff format --check packages/rag-agent/src/campus_rag_agent/confidence.py packages/rag-agent/src/campus_rag_agent/service.py packages/rag-agent/src/campus_rag_agent/service_evidence_stage.py packages/rag-agent/src/campus_rag_agent/service_planner_stage.py packages/rag-agent/src/campus_rag_agent/service_retrieval.py packages/rag-agent/src/campus_rag_agent/service_retrieval_stage.py tests/agent/rag_agent_agentic_runtime_contract_suite.py tests/agent/rag_agent_answer_grounding_suite.py tests/agent/rag_agent_test_support.py`

## Next

Phase 4 should turn the stage / step provenance now available in runtime into stronger eval,
failure attribution, and ragas / diagnostic performance breakdowns.
