---
doc_type: summary
status: completed
created: 2026-05-04
updated: 2026-05-04
---

<!-- markdownlint-disable MD013 -->

# Phase 5 Summary

Phase 5 已完成 heuristic cleanup 与 workstream closeout。

## Completed

- 移除 `agent_answering.py` 中旧 `_compose_title_lookup_answer` direct found-copy 分支；
  `title_lookup` 不再能产出“已找到《title》”并据此决定 answer success。
- 保留 `AnswerShape.TITLE_LOOKUP` 作为 evidence selection / presentation hint，而不是
  answer authority。
- `TITLE_LOOKUP` 且非课程列表 / 非 structured curriculum lookup 时，support row
  selection 会优先使用 narrative answer-bearing content；当同一培养方案同时召回
  `table_fact` 和培养目标/正文段时，课程表行不再混入文档概览答案。
- `derive_confidence` 从 metadata-only positive support 扩展为 metadata + curriculum
  textual support：培养方案标题命中可由“培养目标 / 学制 / 总学分 / 学位授予”等正文事实
  支撑，但 navigation / attribution / boilerplate 等弱命中仍 fail-close。
- 低分同文档多 chunk 的 curriculum textual support 只提升到 `medium`，不因缺少强分数支撑而
  误升为 `high`。
- 更新过时的 diagnostics 测试断言，使其接受 Phase 2-4 已落地的 stage activities、
  retrieval plan summary 与 retrieved source projection，而不是继续要求旧的 opaque
  diagnostics object。

## Boundary Decisions

- 本 phase 没有新增 query-enabled serving surface。
- `RetrievalPlan / RetrievalStep / RetrievalExecutionResult` 仍停留在
  `packages/rag-agent <-> packages/retrieval-core` internal seam，没有进入
  `packages/contracts`。
- `title_lookup` 仍可作为 query / evidence selection 语义标签存在，但不能独立证明答案成功。
- confidence 的新增 textual support 只对 `curriculum/curriculum_plan` 生效，不放宽
  regulations / official_web 的弱 title hit fail-close。
- 架构文档已有 target-state agentic retrieval 约束；本 phase 只把当前 worktree
  implementation truth 写入 native workstream closeout，不把它冒充为已合入 `develop` 的
  merged truth。

## Verification

- `uv run --all-packages python -m unittest tests.agent.rag_agent_answer_quality_regression_suite.RagAgentAnswerQualityRegressionTest.test_curriculum_title_lookup_selection_excludes_table_facts_when_narrative_exists`
- `uv run --all-packages python -m unittest tests.agent.rag_agent_answer_quality_regression_suite.RagAgentAnswerQualityRegressionTest.test_curriculum_title_lookup_selection_excludes_table_facts_when_narrative_exists tests.agent.rag_agent_answer_quality_regression_suite.RagAgentAnswerQualityRegressionTest.test_curriculum_title_lookup_uses_answer_bearing_content_not_found_copy`
- `uv run --all-packages python -m unittest tests.agent.rag_agent_curriculum_structured_lookup_access_suite.RagAgentCurriculumStructuredLookupAccessTest.test_confidence_derivation_prefers_stronger_and_more_consistent_support tests.agent.rag_agent_curriculum_structured_lookup_query_suite.RagAgentCurriculumStructuredLookupQueryTest.test_curriculum_short_fact_answer_reorders_supporting_sources_before_confidence tests.agent.rag_agent_curriculum_structured_lookup_query_suite.RagAgentCurriculumStructuredLookupQueryTest.test_curriculum_named_document_query_with_low_title_score_still_completes`
- `uv run --all-packages python -m unittest tests.agent.rag_agent_answer_quality_regression_suite tests.agent.rag_agent_request_prompt_fallback_suite tests.agent.rag_agent_agentic_runtime_contract_suite tests.agent.rag_agent_curriculum_structured_lookup_query_suite tests.agent.rag_agent_curriculum_structured_lookup_access_suite tests.agent.rag_agent_curriculum_structured_lookup_named_document_suite tests.agent.rag_agent_curriculum_semester_selection_suite tests.agent.rag_agent_answer_grounding_suite`
- `uv run --all-packages python -m unittest tests.evals.ragas_diagnostic_runner_suite tests.evals.ragas_runtime_scorer_defaults_suite tests.evals.ragas_runtime_settings_suite tests.contracts.contract_models_runtime_and_tools_suite tests.contracts.contract_models_request_and_retrieval_suite tests.agent.rag_agent_agentic_runtime_contract_suite tests.agent.rag_agent_answer_quality_regression_suite tests.agent.rag_agent_request_prompt_fallback_suite tests.agent.rag_agent_request_prompt_grounding_suite tests.agent.rag_agent_answer_grounding_suite tests.agent.rag_agent_curriculum_family_facts_program_suite tests.agent.rag_agent_curriculum_family_facts_course_suite tests.agent.rag_agent_curriculum_family_facts_schedule_suite tests.agent.test_rag_retrieval_plan`
- `uv run --all-packages ruff check packages/rag-agent/src/campus_rag_agent/agent_answering.py packages/rag-agent/src/campus_rag_agent/agent_selection_rows.py packages/rag-agent/src/campus_rag_agent/confidence.py tests/agent/rag_agent_answer_quality_regression_suite.py tests/agent/rag_agent_curriculum_structured_lookup_access_suite.py tests/agent/rag_agent_curriculum_structured_lookup_named_document_suite.py`

## Reopen Rule

Reopen this workstream if any of the following happen:

- `title_lookup` or another answer-shape heuristic again decides `completed` / answer success
  without answer-bearing evidence and grounding.
- Stage observability regresses to opaque prompt output and can no longer show planner,
  retrieval, evidence_selection, synthesis and grounding boundaries.
- Supporting evidence no longer carries retrieval plan / step / replan provenance when
  execution result is available.
- RAGAS / diagnostic runners can no longer attribute low answer relevancy / faithfulness to
  retrieval, evidence selection, synthesis, grounding or diagnostic overhead.
- Planner / retrieval / evidence / grounding responsibilities blur again, especially by moving
  retrieval internals into `packages/contracts` or by letting `retrieval-core` own product scope.

## Remaining Gaps

- This workstream closes rag-agent runtime rearchitecture in the current worktree. Promotion to
  merged truth still requires normal branch integration into `develop`.
- Future work should be opened separately if product scope expands beyond the existing RAG
  serving surfaces.
