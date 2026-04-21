---
doc_type: research
status: active
created: 2026-04-21
updated: 2026-04-21
---

# Phase 3 Research

## Existing Repo Truth

### `Phase 2` already created the right typed hooks

- `RetrievalPlan.query_mode` 已包含 `freshness_sensitive` 与 `live_assisted`
- `RetrievalStep.step_type` 已包含 `freshness_gate` 与 `live_source_lookup`
- `RetrievalSourceTrustPolicy` 已有：
  - `minimum_tier`
  - `allow_live_source_lookup`

直接含义：

- `Phase 3` 不需要重新发明 plan seam
- 重点是把现有 typed hooks 接成真正的 runtime branch

### Current freshness behavior is still heuristic, not executor-owned

- `backend_qdrant.py` 当前会对 official-web stable-reference-like profile 应用
  low-signal / freshness fail-close
- `rag-agent/service.py` 当前也有 official-web freshness-sensitive query 的 fail-close helper

直接含义：

- repo 已经知道“最新/今天/最近”不能继续按普通 current query 回答
- 但这些逻辑还没被收进 planner/executor 的 typed step 链路

### Source-trust exists in answer validation, but not yet in live-branch admission

- `campus_contracts` 已定义 `T0/T1/T2/T3`
- `rag-agent/grounding_validation.py` 已经能在答案校验中生成 `SourceTrustSummary`
- 但 `RetrievalSourceTrustPolicy` 还没有真正约束 live branch execution

直接含义：

- `Phase 3` 要把 source-trust 从 answer-time summary 往前推进到 retrieval-time gate

## Official Source Findings

### Azure AI Search: agentic retrieval is multi-query, returns plan/references/details, and supports permissions-aware retrieval

Official sources:

- https://learn.microsoft.com/en-us/azure/search/agentic-retrieval-overview
- https://learn.microsoft.com/en-us/azure/search/agentic-retrieval-how-to-retrieve

Observed pattern:

- agentic retrieval 是 multi-query pipeline，而不是单次黑盒 search
- response 除了 grounding 还包括 query plan 与 source documents
- retrieve action 明确支持 optional permissions enforcement
- Azure 也通过 MCP endpoint 暴露 retrieval，但 retrieval owner 仍是 application/runtime

Direct implication for this repo:

- `freshness_gate` / `live_source_lookup` 必须是 typed plan/step，而不是散落在 prompt 里的隐式判断
- live branch 的 authz / permission / source admission 必须继续由 repo runtime 掌控
- `Phase 3` 应继续保持 execution details 与 references 分层，而不是把 live lookup 结果直接塞进答案

### MCP: tools are model-invoked actions, resources are application-controlled context

Official source:

- https://modelcontextprotocol.io/docs/learn/server-concepts

Observed pattern:

- tools 是 schema-defined action，由模型决定何时调用
- resources 是 application-controlled 的 read-only context
- application 决定如何把资源提供给模型

Direct implication for this repo:

- admitted live source lookup 更适合作为 executor-owned adapter，而不是让 planner 直接拿黑盒 browse tool
- `Phase 3` 的正确方向是“repo-controlled live resource acquisition + typed step result”，不是开放域 tool zoo

## Architecture Recommendation

### Recommended execution subset

Recommendation:

- `Phase 3` 首轮只把以下 subset 接成真实代码：
  - `freshness_gate`
  - `live_source_lookup`

With hard limits:

- 只允许 repo-admitted live source channel
- 不 admission general web fallback
- 不 admission structured runtime tools

### Recommended planner behavior

Recommendation:

- `freshness_sensitive`
  - 先生成 `freshness_gate`
  - gate satisfied 时继续 local indexed path
  - gate unsatisfied 时只允许进入 admitted `live_source_lookup` 或 fail-close
- `live_assisted`
  - 只表示“允许 live branch”
  - 不表示 planner 可以跳过 freshness/source-trust gate

### Recommended source-trust behavior

Recommendation:

- `source_trust_policy.minimum_tier` 应在 executor 的 live-branch merge 之前强制执行
- live evidence 若低于 required tier：
  - 不得进入 answer-bearing evidence
  - 必须 fail-close 或降为 non-answer-bearing execution truth

### Recommended runtime gate shape

Recommendation:

- runtime profile 需要显式声明：
  - 是否允许 `freshness_sensitive`
  - 是否允许 admitted `live_source_lookup`
  - admitted live source channel 是什么

Why:

- 这样才能保持“surface admission / live admission / source-trust”三层边界清晰
- 也能避免把 `official_web` 的局部策略错误扩散成所有 collection 的默认行为

## Open Questions Resolved For Planning

1. `Phase 3` 需要重开 planner/executor seam 吗？
   - 不需要；`Phase 2` 的 seam 已足够
2. live branch 应该建模成开放域 browse 吗？
   - 不应该；只能命中 repo-admitted live source channel
3. source-trust 应该只留在 synthesis/grounding validation 吗？
   - 不够；还要前移到 retrieval-time gate
