---
doc_type: summary
status: active
created: 2026-05-04
updated: 2026-05-04
---

# Phase 1 Summary

Phase 1 已完成首轮实现。

## Completed

- 新增 `campus_rag_agent.runtime_stages`，把 `planner`、`retrieval`、
  `evidence_selection`、`synthesis`、`grounding` 五个阶段写成 package-internal
  runtime stage contract。
- 明确 executable `RetrievalPlan / RetrievalStep / RetrievalStepResult /
  RetrievalExecutionResult` 仍属于 `packages/rag-agent <-> packages/retrieval-core`
  internal seam；`packages/contracts` 只暴露 sanitized summary diagnostics。
- 新增 `RagStageActivitySummary`，作为 contracts 层 sanitized observability projection，
  不承载 executable plan / step 类型。
- `RagResultDiagnostics.stage_activities` 已接入 `rag-agent` 结果构造，可输出
  `request_id`、`plan_id`、`query_mode`、`stage_name`、`stage_status`、
  `candidate_count`、`supporting_evidence_count`、`grounding_verdict`、
  `fallback_reason`、`latency_ms`、`retrieval_ms`、`prompt_ms`、`adapter_ms`、
  `diagnostic_ms`。
- 降级 `title_lookup` 权限：title-targeted single hit 如果没有 answer-bearing /
  positive support role，不再能把 weak title hit 推成 `completed`。
- 新增 regression tests 锁定：
  - `title_lookup` 只能作为 display / selection hint，不能决定 answer success。
  - executable retrieval seam types 不进入 `campus_contracts.__all__`。
  - stage contract 顺序和 owner 可检查。

## Compatibility Decisions

- `answer_shape` 仍允许影响 supporting source budget 和 support-row rendering。
- `title_lookup` 仍可生成“已找到《标题》”类展示文案，但前提是 answer success 已被
  evidence / confidence / grounding path 承认。
- `RetrievalPlanSummary` 与 `RetrievalStepActivitySummary` 保持 public diagnostics
  contract；它们不是 executable retrieval plan。

## Verification

- `uv run --all-packages python -m unittest tests.agent.rag_agent_agentic_runtime_contract_suite`
- `uv run --all-packages python -m unittest tests.contracts.contract_models_runtime_and_tools_suite tests.contracts.contract_models_request_and_retrieval_suite`
- `uv run --all-packages python -m unittest tests.agent.rag_agent_agentic_runtime_contract_suite tests.agent.rag_agent_answer_quality_regression_suite tests.agent.rag_agent_official_web_guardrails_suite tests.agent.rag_agent_official_web_reference_suite tests.agent.rag_agent_request_prompt_fallback_suite tests.agent.test_rag_retrieval_plan`

## Next

Phase 2 should now consume this stage contract and continue moving `service.py` toward explicit
plan -> retrieval -> evidence -> synthesis orchestration. Phase 4 still needs full eval/perf
diagnostic integration beyond the stage summary foundation landed here.
