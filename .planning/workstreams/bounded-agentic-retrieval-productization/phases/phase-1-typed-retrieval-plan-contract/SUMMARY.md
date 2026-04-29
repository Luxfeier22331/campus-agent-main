---
doc_type: summary
status: completed
created: 2026-04-21
updated: 2026-04-21
---

# Phase 1 Summary

## Completed Outcome

`Phase 1` 已完成 typed retrieval plan seam 的 repo truth 冻结。

本 phase 的正式落地产物：

- `docs/contracts/rag-agent-retrieval-plan-contract.md`
- `docs/data/retrieval-query-activity-model.md`

## What Was Frozen

- `RetrievalPlan / RetrievalStep / StepResult` 的最小稳定 shape
- allowed step vocabulary、reserved value 与显式排除项
- `rag-agent` / `retrieval-core` 的 planner/executor boundary
- budget、bounded replan 与 fail-close 语义
- `candidate set / supporting evidence / query activity` 的分层
- `version_query`、`freshness_sensitive`、`live_assisted` 与 source-trust 的接缝

## Key Decisions

- 首轮 placement 保持在 `rag-agent <-> retrieval-core` internal seam，不进入 `packages/contracts`
- `RetrievalRequest` 继续是 executor kernel input，不等于 `RetrievalStep`
- `StepResult` 固定拆成：
  - `grounding`
  - `references`
  - `activity`
  - `failure`
- `scope_follow_up` 当前只保留为 reserved value，不要求初始 executor 必须支持

## Follow-up

下一步固定进入 `Phase 2: Planner Executor Multi-step Kernel`：

- 把 frozen seam 落成 code-level types
- 让 `rag-agent` 发出 ordered plan
- 让 `retrieval-core` 执行 multi-step retrieval 并支持 bounded replan
