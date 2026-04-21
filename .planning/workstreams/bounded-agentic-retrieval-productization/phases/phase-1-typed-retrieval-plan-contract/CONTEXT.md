---
doc_type: context
status: active
created: 2026-04-21
updated: 2026-04-21
---

# Phase 1 Context

## Why This Phase Exists

`bounded agentic retrieval` 已经在 target architecture 中被接受，但 repo 当前还停在
single-shot baseline。现在缺的不是“再写一段更复杂的 prompt”，而是正式的 code-owned
typed plan truth。

如果跳过这一步直接做 multi-step patch，后续很容易退化成：

- `rag-agent` 内部出现 hidden prompt state，但 repo 没有 `RetrievalPlan` truth
- `retrieval-core` 一边保留单次 `RetrievalRequest`，一边被动吸收产品级 step 语义
- `freshness_sensitive / live_assisted` 被临时塞进问答分支，而不是 formal runtime mode
- structured runtime query 被误当成 retrieval step，重新混淆 capability boundary

## Repo Facts

- `docs/architecture/retrieval-serving-architecture.md` 已明确：
  - 当前 merged truth 仍是 single-shot retrieval baseline
  - full agentic retrieval 仍是 target architecture，而不是 current truth
- `docs/architecture/agentic-retrieval-architecture.md` 已明确要求：
  - planner-first
  - typed `RetrievalPlan`
  - typed `RetrievalStep`
  - bounded replan
  - explicit freshness / live branch
- `packages/rag-agent/src/campus_rag_agent/intent.py` 当前的 `retrieval_plan` 仍只是：
  - `default_rewrite`
  - `personalized_rewrite`
- `packages/retrieval-core/src/campus_retrieval_core/models.py` 当前只有单次 `RetrievalRequest`，
  还没有 ordered step、step budget、step result 或 replan contract
- `versioned-history-query-foundation` 已完成：
  - typed `current / historical / as_of / compare`
  - version resolution
  - retrieval version filter
  - answer semantics 与 eval
  这意味着 Phase 1 不需要重做 version mode，而是要决定它如何进入 retrieval plan
- `service_status_lookup`、`transport_schedule_lookup`、`campus_notice_*` 已被固定为
  domain-agent owned structured runtime query，不应被重新吸回 retrieval planner

## User Decisions Already Made

- 目标固定为 `bounded campus agentic retrieval`
- 不允许 general web fallback
- 不允许把 structured runtime tool family 伪装成 retrieval steps
- `rag-agent` / `retrieval-core` 的 planner/executor 边界必须保留
- 先把 planning truth 补齐，再决定何时真正实现

## Phase Output

本 phase 必须产出并冻结：

- `RetrievalPlan / RetrievalStep / StepResult` 的 owner、placement 与 shared shape
- allowed step types 与显式 non-goals
- plan/step budget、fail-close 与 bounded replan semantics
- `version_query`、`freshness_sensitive`、`live_assisted` 与 source-trust 在 plan 中的进入方式
- `rag-agent` 与 `retrieval-core` 的 planner/executor boundary
