---
doc_type: research
status: active
created: 2026-04-21
updated: 2026-04-21
---

# Phase 2 Research

## Existing Repo Truth

### Current `rag-agent` is still single-call retrieval orchestration

- `packages/rag-agent/src/campus_rag_agent/service.py` 当前仍在 resolved scope / query planning 后
  直接调用一次 `retrieve_sources(...)`
- `packages/rag-agent/src/campus_rag_agent/intent.py` 的 `RagRetrievalPlan` 仍只是：
  - `default_rewrite`
  - `personalized_rewrite`

直接含义：

- `Phase 2` 需要把 rewrite label 升级为真正的 typed plan emission
- 但不应一次重写整条 answer path；先把 planner output 与 executor kernel 接起来即可

### Current `retrieval-core` only exposes a single-step kernel

- `packages/retrieval-core/src/campus_retrieval_core/models.py` 当前只有 `RetrievalRequest`
- `packages/retrieval-core/src/campus_retrieval_core/service.py` 只有 `retrieve_sources(...)`

直接含义：

- `Phase 2` 最稳妥的实现形态不是删除 `retrieve_sources(...)`，而是新增 multi-step kernel，
  再让现有 helper 成为兼容 wrapper 或 leaf executor

### Versioned history already solved the hardest version-selection problem

- versioned-history workstream 已完成 request protocol、registry version resolution、retrieval
  version filter 与 answer semantics

直接含义：

- `Phase 2` 不需要重新发明 `historical / as_of / compare`
- multi-step kernel 只需要复用现有 `version_query` truth，把它映射到 ordered plan 或
  version-filtered steps

### Current compare behavior already implies a multi-step future

- 现有测试已要求 compare 答案必须区分旧版/新版，并在单侧证据缺失时 fail-close

直接含义：

- `compare` 是最直接需要 multi-step retrieval 的第一类问题
- 首轮 kernel 只要把 compare 做成双步 version-filtered indexed lookup，就已经能证明 ordered
  plan/executor 的必要性

## Official Source Findings

### Azure AI Search: agentic retrieval is planner-first, parallel, and returns merged content plus references plus execution details

Official sources:

- https://learn.microsoft.com/en-us/azure/search/agentic-retrieval-overview
- https://learn.microsoft.com/en-us/azure/search/agentic-retrieval-how-to-retrieve
- https://learn.microsoft.com/en-us/azure/search/agentic-retrieval-how-to-answer-synthesis

Observed pattern:

- agentic retrieval is explicitly a multi-query pipeline
- subqueries run in parallel where dependencies allow
- retrieval response is three-part:
  - grounding / merged content
  - source references
  - execution details / activity plan
- raw data extraction remains a first-class mode; answer synthesis is optional, not mandatory

Direct implication for this repo:

- `retrieval-core` 应先提供 execution kernel 与 result layering，而不是强制耦合 answer synthesis
- dependency-free compare branches 可以作为首轮并行候选
- `StepResult.activity` 与 `QueryActivity` 应从第一天进入 executor result，即使 `Phase 4` 才把
  operator projection 正式扩完

### OpenAI Help Center: function calling works through model request plus app execution, and strict schemas reduce argument drift

Official source:

- https://help.openai.com/en/articles/8555517-function-calling-in-the-openai-api

Observed pattern:

- model emits a tool/function request, but application still executes it
- `strict: true` structured outputs guarantee arguments match provided JSON Schema
- JSON mode alone is not sufficient; application-side validation and edge-case handling remain required

Direct implication for this repo:

- `rag-agent` planner 可以被看作“model emits typed request”，但真正的 execution owner 仍必须是
  `retrieval-core`
- code-level plan models必须保持 closed vocabulary + validation，而不是 prompt-only free text
- bounded replan / budget exhausted / malformed plan 都要由 code-side enforcement 显式拦截

### MCP server concepts: tools are model-controlled actions, resources are application-controlled read context

Official source:

- https://modelcontextprotocol.io/docs/learn/server-concepts

Observed pattern:

- tools are model-controlled, schema-defined actions
- resources are application-driven read-only context
- applications decide how to retrieve and feed resources to models
- activity logs and approval controls are part of the standard interaction model

Direct implication for this repo:

- `Phase 2` 的 multi-step kernel 更像 application-owned retrieval resource orchestration，而不是把
  retrieval step 直接公开成 model-facing tool zoo
- future `live_source_lookup` 更适合作为 executor-owned admitted adapter，而不是 planner 直接
  拿黑盒 web tool 去跑
- query activity 应保留 compact logs，从一开始就和 execution 绑定

### Anthropic docs: tool use is request -> execute -> return-result, and citations quality depends on chunk/document shape

Official sources:

- https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/overview
- https://docs.anthropic.com/en/docs/build-with-claude/citations

Observed pattern:

- client-side tool use follows a loop:
  - define tools with names/descriptions/input schemas
  - model decides tool use
  - application executes
  - tool results are returned for final synthesis
- citation reliability improves when citations are structured instead of prompt-only
- citation granularity depends on how documents are chunked / shaped

Direct implication for this repo:

- `StepResult.references` 与 `SupportingEvidence` 必须继续依赖 stable canonical units，而不是 raw
  chunk trace
- `Phase 2` 即使先不扩 observability，也应保持 result layering，避免后续 answer path 重新把 raw
  candidate trace 暴露给 synthesis

## Architecture Recommendation

### Recommended initial code placement

Recommendation:

- `Phase 2` 的 code-level seam models 首轮放在 `packages/retrieval-core`
- `rag-agent` 通过现有 package dependency 直接 import 这些 internal seam types

Why:

- `rag-agent` 当前已经依赖 `retrieval-core`
- 反向让 `retrieval-core` import `rag-agent` 会破坏边界
- 不进入 `packages/contracts` 可以保持 supervisor/browser seam 干净

Important nuance:

- 代码 placement 在 `retrieval-core`
- 语义 owner 仍按 `Phase 1` contract 保持：
  - planner semantics 归 `rag-agent`
  - execution semantics 归 `retrieval-core`

### Recommended execution subset for Phase 2

Recommendation:

- `Phase 2` 先只把以下 execution subset 落成真实代码：
  - `indexed_lookup`

With query-mode mapping:

- `current`
  - 单步 `indexed_lookup`
- `historical`
  - 单步 version-filtered `indexed_lookup`
- `as_of`
  - 单步 version-filtered `indexed_lookup`
- `compare`
  - 双步 version-filtered `indexed_lookup`

Deferred to later phases:

- `freshness_gate`
- `live_source_lookup`
- `scope_follow_up`

Why:

- 这是最小但真实的 multi-step kernel
- 它直接复用现有 versioned-history truth
- 它能避免为 `historical_version_lookup` / `compare_pair_lookup` 先写大量元步骤却没有实际收益

### Recommended compatibility strategy

Recommendation:

- 新增 `execute_retrieval_plan(...) -> RetrievalExecutionResult`
- 保留 `retrieve_sources(...) -> EvidenceBundle` 作为 single-step compatibility wrapper

Why:

- 当前 repo 大量调用点与测试仍依赖 `retrieve_sources(...)`
- 一步切断会把 `Phase 2` 扩成 repo-wide migration，不符合 bounded implementation
- wrapper strategy 不等于临时兼容层腐烂，因为它保持清晰 owner：
  - old API = one-step convenience path
  - new API = planner/executor kernel

### Recommended bounded replan semantics

Recommendation:

- `Phase 2` 首轮只允许 1 次 bounded replan
- 触发条件仅限：
  - `empty`
  - non-terminal `blocked`
  - compare 双侧不均衡但仍存在 narrowed retry 空间

Hard constraints:

- replan 不得扩大 admitted scope
- replan 不得从 current/historical/compare 切去 live branch
- replan 只允许：
  - tighten selector
  - rewrite query text
  - lower per-step `top_k` is allowed only if still inside fixed budget logic

## Open Questions Resolved For Planning

1. code-level shared types 应放哪？
   - 先放 `retrieval-core` internal seam module
2. `Phase 2` 要不要一次实现所有 admitted step types？
   - 不要；首轮 execution subset 只做 `indexed_lookup`
3. `retrieve_sources(...)` 要不要直接删除？
   - 不要；保留为 single-step wrapper
4. `compare` 的最小真实 multi-step 形态是什么？
   - 两个 version-filtered `indexed_lookup` steps
