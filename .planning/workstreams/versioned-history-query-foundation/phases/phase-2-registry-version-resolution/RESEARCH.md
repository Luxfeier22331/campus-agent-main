---
phase: "2"
artifact: "research"
created: 2026-04-21
updated: 2026-04-21
status: completed
---

# Phase 2 Research

## Purpose

把 `Phase 2: Registry Version Resolution` 建立在三类事实之上：

- repo 已冻结的 versioned serving / agentic retrieval / data-plane boundary
- 当前代码里 registry、planner、retrieval 各自已经拥有和缺失的 seam
- 官方向量检索文档对 schema-bound filtering、pre-filter 与 bounded orchestration 的支持

## Repo Pattern Readings

- `.planning/workstreams/versioned-history-query-foundation/REQUIREMENTS.md`
- `.planning/workstreams/versioned-history-query-foundation/phases/phase-1-request-protocol/CONTEXT.md`
- `.planning/workstreams/versioned-history-query-foundation/phases/phase-1-request-protocol/RESEARCH.md`
- `docs/plans/archive/completed/versioned-history-query-foundation.md`
- `docs/decisions/adr-0014-versioned-document-serving-and-history-query.md`
- `docs/architecture/retrieval-serving-architecture.md`
- `docs/architecture/agentic-retrieval-architecture.md`
- `docs/architecture/data-plane-architecture.md`
- `docs/reference/runtime-serving-and-index-terms.md`
- `docs/reference/internal-notice-manual-review-future-query-contract.md`
- `packages/contracts/src/campus_contracts/models.py`
- `packages/ingestion-core/src/campus_ingestion_core/registry.py`
- `packages/ingestion-core/src/campus_ingestion_core/in_memory_registries.py`
- `packages/retrieval-core/src/campus_retrieval_core/models.py`
- `packages/retrieval-core/src/campus_retrieval_core/backend_qdrant.py`
- `packages/rag-agent/src/campus_rag_agent/handbook_query_planning.py`
- `packages/rag-agent/src/campus_rag_agent/service.py`

## External Sanity-Check References

- OpenAI Structured Outputs introduction
  - https://openai.com/index/introducing-structured-outputs-in-the-api/
- Azure RAG information retrieval guide
  - https://learn.microsoft.com/en-us/azure/architecture/ai-ml/guide/rag/rag-information-retrieval
- Azure AI Search vector filters
  - https://learn.microsoft.com/en-us/azure/search/vector-search-filters
- Qdrant filtering concepts
  - https://qdrant.tech/documentation/concepts/filtering/

说明：

- 这些资料只用于 sanity-check “typed resolver seam -> retrieval-time filter” 的方向是否符合当前 agentic RAG / vector retrieval 实践。
- repo 边界、owner 与 phase 顺序仍以本地 architecture / ADR / planning truth 为准。

## Findings

### 1. Repo 里已经存在“resolved document identity”上游 seam

- `handbook_query_planning` 已能把 policy object 解析成单个 `document_id`
- `rag-agent` 已把 `target_document_ids` 传给 retrieval
- 这说明 `Phase 2` 不需要也不应该重新做 query text 解析

推论：

- registry resolver 的正确输入不是原始 user text，而是“已解析 document identity + version query”

### 2. 当前 registry 只支持读取 current/latest，不支持正式历史版本解析

- `DocumentRegistry` 现在只有：
  - `get`
  - `latest_versions`
  - `current_version`
- 这不足以表达：
  - `historical` 的历史版本集合或锚点解析
  - `as_of` 的时间点解析
  - `compare` 的双侧版本锁定

推论：

- `Phase 2` 需要新增 registry-owned resolution seam；否则后续只能把解析偷渡回 retrieval 或 answer 层

### 3. Retrieval 已经具备 version filter 的物理承载能力，但缺少上游 truth

- `backend_qdrant` 当前已按 `document_id` 构造 metadata/qdrant filter
- source-scoped path 已存在 exact `version_id` 过滤
- evidence shaping 也已经读取 `document_id/revision_track/version_id`

推论：

- `Phase 3` 并不需要发明新的底层存储语义
- 真正缺口是 `Phase 2` 还没有输出“应该过滤哪些 version_id”

### 4. Repo 文档已经把 `as_of` 和 `compare` 的关键原则写死了

- ADR-0014 已明确：
  - 版本选择必须发生在 retrieval 前
  - `compare` 不是单边 lookup
- `internal-notice-manual-review-future-query-contract` 已明确：
  - `as_of` 必须在 retrieval 前落成 filter
  - `compare` 必须先锁定可比范围，再进入 retrieval

推论：

- `Phase 2` 的目标不是“支持一点历史查询”，而是冻结正式 resolver seam，让 `Phase 3/4` 不再争论 owner

### 5. 官方向量检索资料支持“先结构化约束，再检索”

- Azure RAG retrieval guide 明确把 filtering 作为 query-side 检索策略的一部分，并强调索引字段需要事先声明 filterable/retrievable/searchable 角色
- Azure AI Search 文档把 `preFilter` 作为推荐模式，强调过滤应缩小向量查询候选范围，而不是全部召回后再裁剪
- Qdrant 官方文档把 payload/id condition 作为一等过滤能力，并明确指出当 embedding 无法表达全部业务特征时应使用过滤条件
- OpenAI Structured Outputs 官方介绍支持 schema-adherent output，这与 repo 把 version mode / selector 变成 typed truth 的方向一致

推论：

- “先用 typed resolver 解析版本选择，再把结果翻译成 retrieval filter”是符合当前实践的
- “先全量检索，再让回答层挑历史版本”不符合这组资料支持的主流做法

### 6. `compare` 在当前 request protocol 下仍然存在 selector 缺口

- 当前 `VersionQuery` 只有：
  - `mode`
  - `as_of`
- 这足够支撑：
  - `current`
  - 部分 `as_of`
- 但不够稳定支撑：
  - anchored `historical`
  - general `compare`

推论：

- `Phase 2` 需要正面决定：
  - compare 是否先收敛到 bounded selector subset
  - 若需要新增字段，必须只表达 version-axis anchor，不允许回退成自由文本

## Phase-2 Decisions To Freeze

1. resolver 消费已解析 `document_id`，不消费原始 user text。
2. registry/version resolution 必须发生在 retrieval filter 之前。
3. resolver 输出是 typed version-selection truth，不是 prompt 说明文字。
4. retrieval/backend 只消费 resolver 输出，不重新解释 `historical / as_of / compare`。
5. 如需补 selector，字段只能是 bounded machine-readable anchor，不能把 resolver 变成通用查询器。

## Deferrals

- `Phase 3`
  - `RetrievalRequest` version selector/filter 字段
  - backend filter translation
- `Phase 4`
  - historical/as_of/compare 最终回答语义
  - compare 变化点组织
- `Phase 5`
  - end-to-end eval
  - clarification / unresolved 样本

## Risks If Mis-Scoped

- 如果 resolver 直接消费 user text，它会复制 planner 职责并把 registry 变成 query engine。
- 如果 `compare` 不补足 selector seam，后续实现只能靠隐式猜测 pair，等于把 Phase 1 的 typed mode 又打回 prompt 语义。
- 如果 registry 不输出 machine-readable version truth，`Phase 3` 就只能把 resolution 藏进 retrieval backend 黑盒。

## Conclusions For Phase 2

1. 正确 owner 是 `ingestion-core` 内的 registry-backed version resolver，不是 retrieval-core。
2. 正确输入是“resolved document scope + typed version_query + runtime revision-track context”。
3. 正确输出是“resolved version-selection truth”，供 `Phase 3` 直接翻译成 filter。
4. `compare`/anchored `historical` 当前仍有 selector 缺口；如果补字段，必须保持 bounded、typed、非文本化。
