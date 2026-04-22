---
phase: "1"
artifact: "research"
created: 2026-04-21
updated: 2026-04-21
status: completed
---

# Phase 1 Research

## Purpose

把 `Phase 1: Request Protocol` 建立在两类事实之上：

- repo 已冻结的版本化 serving、agentic retrieval 与 ADR truth
- 官方 RAG/retrieval 最佳实践对 metadata filtering、complex query routing 与 eval 的最小要求

## Repo Pattern Readings

- `docs/plans/archive/completed/versioned-history-query-foundation.md`
- `docs/decisions/adr-0014-versioned-document-serving-and-history-query.md`
- `docs/architecture/system/retrieval-serving-architecture.md`
- `docs/architecture/system/agentic-retrieval-architecture.md`
- `docs/architecture/target-architecture.md`
- `docs/reference/runtime-serving-and-index-terms.md`

## External Sanity-Check References

- OpenAI Structured Outputs guide
  - https://developers.openai.com/api/docs/guides/structured-outputs
- LlamaIndex metadata filter guidance
  - https://developers.llamaindex.ai/python/framework/optimizing/basic_strategies/basic_strategies/
- Qdrant filtering documentation
  - https://qdrant.tech/documentation/search/filtering/

说明：

- 这些外部资料只用于 sanity-check “typed request seam + retrieval pre-filter + eval coverage” 方向是否合理。
- repo 级边界仍以本地 architecture / ADR / planning 文档为准。

## Findings

### 1. Repo 已经把“历史保留”和“历史查询”分开了

- ADR-0014 已明确：
  - 默认 serving 最新版本
  - 历史版本必须保留
  - 历史查询必须是显式能力
- 所以 `Phase 1` 的正确动作不是重谈“要不要保留历史”，而是冻结显式 request protocol。

### 2. Repo 已经把版本选择前移到 retrieval 之前

- `retrieval-serving` 已明确：
  - 版本选择发生在 retrieval 之前
  - retrieval backend 不能自行猜用户是不是要查历史版本
- 所以 request protocol 必须在 `Phase 1` 先写清，不然后续 phase 无法把 version selection 从 retrieval/answer 层剥离出来。

### 3. Repo 已经有长期 query mode 闭集，但当前 workstream 不应扩 scope

- `retrieval-serving` 与 `agentic-retrieval` 都承认：
  - `current`
  - `historical`
  - `as_of`
  - `compare`
  - `freshness_sensitive`
  - `live_assisted`
- 但本 reference plan 当前只承接 versioned-history query，因此 `Phase 1` 应先冻结前四个 mode，不把 freshness/live 混进来。

### 4. 官方最佳实践支持“typed request seam + retrieval-time filtering”

- OpenAI Structured Outputs 强调 schema-adherent output，并明确建议在可能时使用严格 schema。
- LlamaIndex 文档明确说明 metadata 可以在 query time 用来过滤数据，再执行 top-k similarity search。
- Qdrant 文档把 filtering 定义为用 payload conditions 缩小搜索范围的正式能力。
- 因此先把 `current / historical / as_of / compare` 固化为 typed `version_query`，再在后续 phase 引入 version-range filter，是符合当前 agentic RAG 实践的。

### 5. Eval 不是附加项，而是这条线的固定后置 phase

- Azure RAG 指南要求用测试 query、ground truth 和正负样本验证 retrieval/generation。
- repo 的 versioned history plan 已把 `Phase 5: Eval Coverage` 固定下来，这是对的。

## Phase-1 Decisions To Freeze

1. request protocol 先只覆盖：
   - `current`
   - `historical`
   - `as_of`
   - `compare`
2. 没有显式 version mode 的旧请求继续默认 `current`。
3. version mode 必须进入 typed query path，不允许隐藏在 prompt 文本里。
4. `historical`、`as_of`、`compare` 先在 request protocol 上分开，具体 selector resolution 留给 `Phase 2`。
5. `freshness_sensitive / live_assisted` 继续留在并列 temporal/live branch，不并入本 workstream 的 Phase 1。

## Deferrals

- `Phase 2`
  - version selector shape
  - registry resolution inputs/outputs
- `Phase 3`
  - retrieval candidate pre-filter
  - metadata field enforcement
- `Phase 4`
  - `rag-agent` answer semantics
  - non-current warning / compare dual-evidence wording
- `Phase 5`
  - eval datasets
  - negative / clarification samples

## Risks If Mis-Scoped

- 如果不先冻结 request protocol，后续很容易把版本意图重新塞回 prompt 猜测。
- 如果把 `freshness_sensitive` 与 `live_assisted` 一起并入本 phase，scope 会从“历史查询”膨胀成“完整 temporal/live retrieval”。
- 如果默认 current 兼容语义没先写清，后续实现会破坏当前默认 serving posture。

## Conclusions For Phase 1

1. 先冻结 request protocol，再做 registry resolution。
2. 先把 `historical / as_of / compare` 从普通 current query 中正式拆出来。
3. 保留默认 `current` backward compatibility。
4. 不把 freshness/live branch 混进这条线的第一阶段。
