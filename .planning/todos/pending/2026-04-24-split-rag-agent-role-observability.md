---
created: 2026-04-24T08:57:38+08:00
title: 拆清 rag-agent 内部角色观测
area: backend
owner: rag-agent
priority: backlog-after-app-api
files:
  - docs/reference/qa-assistant-and-harness-gap-review.md
  - docs/architecture/system/execution-and-agents-architecture.md
  - docs/architecture/system/retrieval-serving-architecture.md
  - packages/rag-agent/src/campus_rag_agent/service.py
  - packages/rag-agent/src/campus_rag_agent/retrieval_plan.py
  - packages/retrieval-core/src/campus_retrieval_core/service.py
  - .planning/workstreams/bounded-agentic-retrieval-productization/STATE.md
---

## Problem

2026-04-24 gap review 确认：`rag-agent` 的目标内部角色是 scope
resolver、retrieval planner、answer synthesizer 与 grounding validator。
当前 `delegate_to_rag_agent(...)` 仍集中承载 scope resolution、
curriculum planning、version selection、retrieval plan emission、
retrieval execution、answer synthesis、prompt fallback 与 grounding downgrade。

这不是当前功能错误，但会提高后续新增 retrieval branch、supporting evidence
policy 或 quality gate 的修改风险。

当前不进入 app-api-first scope；保留为 rag-agent backlog。

## Solution

后续恢复时先明确是否触发 `bounded-agentic-retrieval-productization`
reopen rule；只有当 role boundary、retrieval plan trace 或 supporting evidence
contract 需要改写时才重开。

候选方向：

1. 把 `delegate_to_rag_agent(...)` 的 scope / planning / synthesis /
   grounding 分段提成 package-internal role functions 或 classes。
2. 保持 `AgentRequest -> AgentResponse` 对外 seam 不变。
3. 为每个 role 输出 compact diagnostic summary，继续进入 app-api operator-safe
   observability，而不是暴露 raw trace。
4. 增加 role-level regression，覆盖 no-answer、clarification、compare、
   freshness fail-close、prompt grounding downgrade 与 deterministic answer path。
