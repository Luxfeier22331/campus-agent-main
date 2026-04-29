---
doc_type: context
status: active
created: 2026-04-22
updated: 2026-04-22
---

# Phase 4 Context

## Why This Phase Exists

`Phase 3` 已经把 generic freshness/live/source-trust seam 接成正式 typed runtime branch，但 repo 还没有把
`query activity -> supporting evidence -> operator-safe observability` 这条链路正式冻结成当前 truth。

如果停在现在的状态，会留下三个直接问题：

- `RetrievalStepActivity` 已存在，但还没有明确收口成 `retrieval-core -> rag-agent -> supervisor/app-api`
  的最小 debug contract
- supporting evidence 与 raw retrieved sources 虽然已经分层，但 operator-facing / browser-safe 的最终
  字段边界还没有正式固定
- `Phase 5` 的 eval/runtime acceptance 无法判断“看到的是 execution truth 还是 answer truth”

因此 `Phase 4` 的目标不是新增 planner 能力，而是把现有 building blocks 正式收口成可验收的 observability truth。

## Repo Facts

- `packages/retrieval-core/src/campus_retrieval_core/models.py` 已有：
  - `RetrievalStepActivity`
  - `RetrievalExecutionResult.step_activities`
- `docs/data/retrieval-query-activity-model.md` 已冻结：
  - `QueryActivity`
  - `StepActivity`
  - `SupportingEvidence`
  - raw candidate / final evidence 分层
- `packages/rag-agent/src/campus_rag_agent/service.py` 已把 supporting evidence 构造成 retrieved evidence 的受控子集
- `packages/supervisor-core/src/campus_supervisor_core/response.py` 已把 raw retrieved sources 与 final supporting evidence 分开投影
- `tests/supervisor/test_supervisor_core.py` 已覆盖 retrieved-source / supporting-source separation
- `packages/evals` 已具备 retrieval/live benchmark 与 supplemental adapter，不再是从零开始

## Phase Boundary

本 phase 只处理：

- query activity / step activity 的 end-to-end contract 收口
- candidate set / retrieved sources / supporting evidence 的边界冻结
- operator-safe observability 与 debug projection 的正式文档化和测试化
- 为 `Phase 5` 提供明确的 acceptance carrier

本 phase 不处理：

- 新的 retrieval step taxonomy
- 打开新的 query-enabled surface
- official-web 时效 query 的 tool/runtime owner 实现
- general web fallback

## Primary Implementation Constraint

这一步必须把“执行真相”和“回答真相”分开，而不是为了调试方便再次把 raw trace 暴露回产品面。

固定约束：

- raw retrieved trace 属于 execution truth，不自动进入 browser-facing evidence
- supporting evidence 必须继续是 retrieved evidence 的受控子集
- operator observability 只暴露 compact、bounded、operator-safe 的 execution summary
- 不把 official-web freshness 问题重新借 observability 文档塞回 `rag-agent` ownership

## Phase Output

本 phase 必须产出并验证：

- `query activity / step activity / terminal state` 的正式收口文档
- raw retrieved sources 与 supporting evidence 的 operator-safe 分层 contract
- `retrieval-core -> rag-agent -> supervisor/app-api` 的最小 observability 字段集
- 对应的 targeted tests 与 closeout evidence
