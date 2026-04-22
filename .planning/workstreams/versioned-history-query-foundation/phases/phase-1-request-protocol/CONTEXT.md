---
phase: "1"
name: "Request Protocol"
created: 2026-04-21
updated: 2026-04-21
status: planned
---

# Phase 1 Context

**Gathered:** 2026-04-21
**Status:** Planned

<domain>
## Phase Boundary

本 phase 只负责：

- 冻结 `current / historical / as_of / compare` 的显式 request protocol
- 冻结默认 `current` 语义与没有显式 version mode 时的 admission 规则
- 冻结 version query mode 进入 shared seam 的位置与职责边界
- 冻结这条线与 `freshness_sensitive / live_assisted` 的分层
- 为 `Phase 2` 的 registry version resolution 提供明确输入

它不负责：

- 直接实现 registry version resolution
- 直接实现 retrieval version pre-filter
- 直接实现 `rag-agent` 历史/对比回答语义
- UI / 产品交互设计
- 把 `freshness_sensitive / live_assisted` 一并并入本 workstream

</domain>

<current_truth>
## Current Truth

- 当前 repo 已固定：
  - document history retention 已存在
  - current truth 维护已存在
  - 默认 serving 只面向当前有效版本
  - 多来源等价内容归并已存在
- `retrieval-serving` 已冻结：
  - 长期 query model 包括 `current / historical / as_of / compare / freshness_sensitive / live_assisted`
  - 版本选择必须发生在 retrieval 之前
  - 普通 query-serving 默认只查当前有效版本
- `agentic-retrieval` 已冻结：
  - `RetrievalPlan` 必须显式表达 `query_mode`
  - admitted historical step types 包括 `historical_version_lookup` 与 `compare_pair_lookup`
- 当前尚未完成：
  - query path 显式指定 `historical / as_of / compare`
  - request-side version mode contract
  - registry version resolution owner

</current_truth>

<decisions>
## Implementation Decisions

- **01-01:** `Phase 1` 的 owner 是 request protocol freeze，不是 registry/filter/answer implementation。
- **01-02:** 这条 workstream 当前只承接四个 version mode：
  - `current`
  - `historical`
  - `as_of`
  - `compare`
- **01-03:** `freshness_sensitive` 与 `live_assisted` 虽然属于长期 retrieval model，但不并入这条 workstream的 Phase 1；它们继续作为并列 temporal/live branch 保留在其他 target-state 语义中。
- **01-04:** 没有显式 version mode 的既有请求，继续默认解释为 `current`；不允许因为引入历史查询而改写当前默认 serving posture。
- **01-05:** version mode 必须是 query path 的显式 typed truth，不允许隐藏在 prompt 文本、user_goal 字符串或 retrieval backend 黑盒猜测中。
- **01-06:** `historical` 表示“明确要查非当前版本”，但不等于 `as_of`；是否按具体版本 id、版本标签或相对历史定位，留给 `Phase 2` 的 registry resolution 决定。
- **01-07:** `as_of` 表示“按时间点/日期解析当时有效版本”；解析 owner 必须是 registry，不是 retrieval backend。
- **01-08:** `compare` 表示“双侧版本选择 + 变化点回答语义”的显式请求模式；它不是一次普通 current lookup 加一段说明。
- **01-09:** `Phase 1` 只冻结 request protocol 所需的最小字段语义，不提前设计完整 UI/HTTP 交互。
- **01-10:** current-mode backward compatibility 必须保留；历史查询能力必须是显式扩展，而不是放宽默认 filter 的副作用。

</decisions>

<specifics>
## Specific Gaps

- 当前 query path 没有正式 version mode，所以历史意图只能靠自然语言和 prompt 猜测。
- 当前没有写清“默认 current”与“显式 historical/as_of/compare”如何在同一 request family 下共存。
- `retrieval-serving` 和 `agentic-retrieval` 已经冻结了长期方向，但缺少 phase-local planning artifact 把 request protocol 先落下来。
- 如果不先做这一步，后续 `Phase 2-4` 都会摇摆：
  - mode 到底属于 product request、shared contract 还是 retrieval plan 前置字段
  - old callers 是否会被破坏
  - `freshness_sensitive` 是否被错误混进 versioned history lane

</specifics>

<canonical_refs>
## Canonical References

- `docs/plans/archive/completed/versioned-history-query-foundation.md`
- `.planning/workstreams/versioned-history-query-foundation/REQUIREMENTS.md`
- `.planning/workstreams/versioned-history-query-foundation/ROADMAP.md`
- `.planning/workstreams/versioned-history-query-foundation/STATE.md`
- `docs/decisions/adr-0014-versioned-document-serving-and-history-query.md`
- `docs/architecture/system/retrieval-serving-architecture.md`
- `docs/architecture/system/agentic-retrieval-architecture.md`
- `docs/architecture/target-architecture.md`
- `docs/reference/runtime-serving-and-index-terms.md`

### Web Sanity-Check References

- `https://developers.openai.com/api/docs/guides/retrieval`
- `https://learn.microsoft.com/en-us/azure/architecture/ai-ml/guide/rag/rag-information-retrieval`
- `https://learn.microsoft.com/en-us/azure/search/vector-search-filters`

</canonical_refs>

<deferred>
## Deferred Follow-up

- `Phase 2`: registry version resolution 的 owner、输入、输出和 selector contract
- `Phase 3`: retrieval candidate 阶段的 version pre-filter
- `Phase 4`: `rag-agent` 的 `historical / as_of / compare` answer semantics
- `Phase 5`: eval coverage 与澄清样本
- `freshness_sensitive / live_assisted` 的独立 temporal/live branch

</deferred>
