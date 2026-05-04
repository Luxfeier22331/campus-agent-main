---
doc_type: plan
status: active
created: 2026-05-04
updated: 2026-05-04
---

# Phase 1 Plan

## Objective

把 `rag-agent` 内部职责切成 planner、retrieval orchestration、evidence selection、
answer synthesis、grounding validation 五个可辨识阶段，并冻结哪些 legacy heuristic
只允许作为 compatibility shim。
同时把 typed seam 的首轮 placement 钉死在 `rag-agent <-> retrieval-core` internal boundary，
而不是让它漂到 `packages/contracts` 或 prompt hidden state。

## Tasks

1. 盘点当前 service chain
   - 标出 `service.py`、`service_retrieval_stage.py`、`service_answer_synthesis.py`、
     `agent.py`、`agent_answer_shape.py` 的责任边界
   - 标出哪些函数在做 planning，哪些在做 selection，哪些在做 synthesis
   - 明确 `RetrievalPlan / RetrievalStep / StepResult` 的 owner、placement 与 promotion trigger

2. 冻结内部 typed seam
   - 定义/梳理 planner output
   - 定义/梳理 retrieval stage output
   - 定义/梳理 evidence / grounding summary 输入输出
   - 确保不把这些状态继续藏在 prompt 文本里
   - 让 planner/output 与 executor/input 分层，而不是共享一套模糊 response blob

3. 降级 legacy answer-shape heuristic
   - 识别 `title_lookup`、condition/detail/fact shape 的实际用途
   - 区分可保留的 presentation hint 与必须移除的 decision logic
   - 明确它们不能决定 answer success

4. 分离 failure semantics
   - 把 retrieval failure、no_answer、low confidence、grounding failure、prompt fallback 区分开
   - 让每一类 failure 都能追到 stage-level 原因

5. 形成 phase 级文档输出
   - 更新 phase context / plan / summary
   - 将 phase 1 的 compatibility decisions 写成后续 phase 的约束
   - 写清 seam placement 决策，让 phase 2 不再重开 owner 辩论

## Constraints

- 不在本 phase 重写 multi-step executor
- 不把 structured runtime query 拉回 rag-agent planner
- 不改变 current serving surface
- 不让 heuristics 继续拥有主语义决策权

## Verification

- `git diff --check`
- targeted inspection of `packages/rag-agent/src/campus_rag_agent/*`
- phase summary review
- phase 1 decision note covering seam placement, typed artifact ownership, and heuristic downgrade

## Exit Criteria

- `rag-agent` 内部角色边界能被清晰描述
- `title_lookup` 等 heuristic 的权限被正式降级
- phase 2 有明确 typed seam 前置条件
- typed seam placement、owner 与 promotion trigger 已写成可复用决策
