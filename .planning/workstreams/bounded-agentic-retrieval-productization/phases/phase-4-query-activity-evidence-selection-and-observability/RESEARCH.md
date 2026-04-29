---
doc_type: research
status: active
created: 2026-04-22
updated: 2026-04-22
---

# Phase 4 Research

## Official Guidance

### 1. Agent systems should keep tool boundaries explicit

OpenAI 的 agent guidance 持续强调：先把 agent/tool handoff 边界保持显式，再逐步扩复杂度，而不是把所有当前信息查询都吞回一个模糊的 RAG 面。

参考：

- https://openai.com/business/guides-and-resources/a-practical-guide-to-building-ai-agents/
- https://developers.openai.com/tracks/building-agents

对本仓库的直接含义：

- `bounded agentic retrieval` 只应负责 generic retrieval planning/execution
- official-web 的“最新/今天/最近”时效 query 仍应保持 tool/runtime owner，而不是借 `Phase 4` 的 observability 再回到 `rag-agent`

### 2. Retrieval should use explicit filters, traces, and evaluation hooks

OpenAI retrieval guidance的方向是：把 retrieval 行为做成可过滤、可追踪、可评测的系统，而不是把 query rewrite 和结果选择都藏进黑盒 prompt。

参考：

- https://platform.openai.com/docs/guides/retrieval

对本 phase 的直接含义：

- `RetrievalStepActivity`、selector summary、version/authz filter 应继续保持 typed、可追踪
- `candidate set` 与 `supporting evidence` 必须分层，否则后续 eval 无法判断模型是在“看到候选”还是“被允许引用”

### 3. Evals need stable task-specific carriers, not only ad hoc spot checks

OpenAI eval guidance强调：先有稳定任务集、稳定追踪和清晰 pass/fail，再扩大 rollout。

参考：

- https://platform.openai.com/docs/guides/evals

对本 phase 的直接含义：

- `Phase 4` 必须先把 observability carrier 冻结，`Phase 5` 才能把 runtime acceptance 跑成稳定 gate
- 不能让 panel/operator 直接消费 raw trace dump；否则后续 eval 与 acceptance artifact 会同时失去边界

## Local Repo Audit

### 已存在的 building blocks

- `packages/retrieval-core/src/campus_retrieval_core/models.py`
  - 已有 `RetrievalStepActivity`
  - 已有 `RetrievalExecutionResult.step_activities`
- `docs/data/retrieval-query-activity-model.md`
  - 已定义 `QueryActivity / StepActivity / SupportingEvidence`
- `packages/rag-agent/src/campus_rag_agent/service.py`
  - 已把 supporting evidence 作为 retrieved evidence 的受控子集
- `packages/supervisor-core/src/campus_supervisor_core/response.py`
  - 已把 `retrieved_sources` 与最终 supporting evidence 分层
- `tests/supervisor/test_supervisor_core.py`
  - 已验证 raw retrieved source 不应自动冒充 final supporting source

### 仍需 Phase 4 正式收口的缺口

- `RetrievalStepActivity` 目前更多是 internal model truth，尚未冻结成跨层 operator-safe contract
- retrieval / specialist / supervisor / app-api 之间的最小 debug 字段集还没有在同一 workstream 下收口
- 现有 observability 证据分散在代码、测试和数据文档里，缺少正式 closeout 口径

## Conclusion

`Phase 4` 不是 greenfield implementation。

它本质上是：

- 审计当前已有 query activity / supporting evidence / observability building blocks
- 去掉“已有一半实现但没有正式 contract”的灰区
- 为 `Phase 5` 的 eval/runtime closeout 建立稳定 carrier
