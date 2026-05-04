---
doc_type: context
status: active
created: 2026-05-04
updated: 2026-05-04
---

# Phase 1 Context

## Why This Phase Exists

`rag-agent` 当前仍把 planner、retrieval、evidence shaping、synthesis、grounding 与
legacy answer-shape heuristic 混在同一条 service path 里。Phase 1 的目标不是先做更聪明的
回答，而是先把内部职责边界拆开，避免后续 multi-step / observability / eval 再继续沿用
opaque single-shot semantics。

## Repo Facts

- `packages/rag-agent/src/campus_rag_agent/service.py` 仍是主 orchestration 入口。
- `packages/rag-agent/src/campus_rag_agent/agent.py` 当前仍混合 candidate selection、
  evidence rendering 与 direct answer composition。
- `packages/rag-agent/src/campus_rag_agent/agent_answer_shape.py` 仍含 `title_lookup` 与
  condition / detail / fact / summary 之类 answer-shape heuristic。
- `packages/rag-agent/src/campus_rag_agent/service_retrieval_stage.py` 仍把 retrieval failure
  与 outcome construction 绑在同一路径里。
- `bounded-agentic-retrieval-productization` 已把 retrieval baseline、typed plan truth 与
  planner/executor boundary 的长期方向冻结为前置真相。

## Placement Decision

- 本 phase 冻结的 authoritative typed seam 仍是 `packages/rag-agent <-> packages/retrieval-core`
  的 internal boundary。
- `packages/contracts` 不承担 `RetrievalPlan / RetrievalStep / StepResult` 的首轮落点。
- planner 归 rag-agent，executor 归 retrieval-core，evidence selection 与 grounding
  由 rag-agent 继续拥有语义责任，但不再和 hidden prompt state 混写。

## User-Visible Problem This Phase Must Address

- low answer relevancy / faithfulness 的 failure 不容易归因
- “title_lookup / shape heuristic 命中了” 会掩盖真正的 evidence 质量问题
- prompt composition、evidence selection 和 grounding failure 混杂在一起
- perf / ragas / diagnostic 结果很难判断慢在哪里

## Output Of This Phase

- 明确 planner / retrieval / evidence / synthesis / grounding 的职责边界
- 明确哪些 helper 仍可作为 compatibility shim
- 明确哪些 heuristic 需要降级或移除
- 明确 phase 2 / 3 实现时的 typed seam
- 明确 typed seam 的 placement / owner / promotion trigger
