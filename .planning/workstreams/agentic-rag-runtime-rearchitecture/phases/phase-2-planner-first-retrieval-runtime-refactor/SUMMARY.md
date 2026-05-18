---
doc_type: summary
status: active
created: 2026-05-04
updated: 2026-05-04
---

# Phase 2 Summary

Phase 2 已完成首轮实现。

## Completed

- 新增 `campus_rag_agent.service_planner_stage`，把 retrieval context 与 executable
  `RetrievalPlan` 作为 planner stage output 显式返回。
- 新增 `campus_rag_agent.service_evidence_stage`，把 supporting evidence selection、
  remote content suspicion labeling、compare support completeness 与 confidence derivation
  收口为 evidence selection stage output。
- 重构 `campus_rag_agent.service` 主链路为：
  `pipeline/preflight -> planner -> retrieval -> evidence_selection -> synthesis /
  version-aware response`。
- 重构 `campus_rag_agent.service_retrieval_stage`，使 retrieval stage 只消费 planner stage
  产出的 `RagRetrievalContext` 与 `RetrievalPlan`，不再在 execution 内部隐式生成 plan。
- 新增 `campus_rag_agent.service_retrieval.build_retrieval_plan_for_context`，把 plan
  emission 从 retrieval execution 中抽离，形成可单测 typed seam。
- 扩展 runtime contract tests，证明 planner stage 在不执行 retrieval 的情况下即可返回
  `RagRetrievalContext` 与 `RetrievalPlan`，evidence stage 能返回 supporting evidence、
  confidence 与 compare completeness。
- 修正 curated curriculum fact confidence：`family_membership`、`semester`、
  `semester_course_list`、`audience` 等内部事实 role 现在被识别为 positive answer support，
  避免 program/course fact answer 被误降为 low-confidence no-answer。
- 调整过度脆弱的 diagnostics 等值测试，使其继承当前 stage / retrieval diagnostics，而不是
  假设诊断字段为空。

## Boundary Decisions

- executable `RetrievalPlan` 仍只在 `packages/rag-agent <-> packages/retrieval-core`
  internal seam 中流动，不进入 `packages/contracts`。
- `service.py` 不再承担 plan emission、retrieval execution、supporting evidence selection
  的混合职责；它只编排 stage 输出和 fail-close 分流。
- retrieval executor 不再基于 opaque state 自行生成 plan；它执行 planner stage 已 admitted
  的 typed plan。
- serving surface 未扩大；curriculum internal fact collections 仍只作为
  `curriculum_plan` scope 内部 retrieval surface 被消费。

## Verification

- `uv run --all-packages python -m unittest tests.agent.rag_agent_agentic_runtime_contract_suite`
- `uv run --all-packages python -m unittest tests.agent.rag_agent_agentic_runtime_contract_suite tests.agent.test_rag_retrieval_plan`
- `uv run --all-packages python -m unittest tests.agent.rag_agent_curriculum_family_facts_program_suite tests.agent.rag_agent_curriculum_family_facts_course_suite tests.agent.rag_agent_curriculum_family_facts_schedule_suite`
- `uv run --all-packages python -m unittest tests.contracts.contract_models_runtime_and_tools_suite tests.contracts.contract_models_request_and_retrieval_suite tests.agent.rag_agent_agentic_runtime_contract_suite tests.agent.rag_agent_answer_quality_regression_suite tests.agent.rag_agent_request_prompt_fallback_suite tests.agent.rag_agent_request_prompt_grounding_suite tests.agent.rag_agent_answer_grounding_suite tests.agent.rag_agent_curriculum_family_facts_program_suite tests.agent.rag_agent_curriculum_family_facts_course_suite tests.agent.rag_agent_curriculum_family_facts_schedule_suite tests.agent.test_rag_retrieval_plan`
- `uv run --all-packages ruff check packages/rag-agent/src/campus_rag_agent/confidence.py packages/rag-agent/src/campus_rag_agent/service.py packages/rag-agent/src/campus_rag_agent/service_evidence_stage.py packages/rag-agent/src/campus_rag_agent/service_planner_stage.py packages/rag-agent/src/campus_rag_agent/service_retrieval.py packages/rag-agent/src/campus_rag_agent/service_retrieval_stage.py tests/agent/rag_agent_agentic_runtime_contract_suite.py tests/agent/rag_agent_answer_grounding_suite.py tests/agent/rag_agent_test_support.py`
- `uv run --all-packages ruff format --check packages/rag-agent/src/campus_rag_agent/confidence.py packages/rag-agent/src/campus_rag_agent/service.py packages/rag-agent/src/campus_rag_agent/service_evidence_stage.py packages/rag-agent/src/campus_rag_agent/service_planner_stage.py packages/rag-agent/src/campus_rag_agent/service_retrieval.py packages/rag-agent/src/campus_rag_agent/service_retrieval_stage.py tests/agent/rag_agent_agentic_runtime_contract_suite.py tests/agent/rag_agent_answer_grounding_suite.py tests/agent/rag_agent_test_support.py`

## Next

Phase 3 should now connect bounded multi-step retrieval / replan outputs and supporting evidence
refinement more deeply, using the typed planner -> retrieval -> evidence seam landed here.
