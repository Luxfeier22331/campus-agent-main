---
phase: "2"
name: "Registry Version Resolution"
created: 2026-04-21
updated: 2026-04-21
status: planned
---

# Phase 2 Context

**Gathered:** 2026-04-21
**Status:** Planned

<domain>
## Phase Boundary

本 phase 只负责：

- 冻结 registry 作为 version selector resolution owner 的输入/输出边界
- 把 `current / historical / as_of / compare` 从 request-side mode 解析成 retrieval 前可消费的 version-selection truth
- 明确 resolver 何时可以直接给出版本选择，何时必须返回 unresolved/fail-close
- 为 `Phase 3` 的 retrieval version filter 提供稳定输入

它不负责：

- 从原始 user text 做 document/entity 语义解析
- retrieval candidate 检索、排序或 rerank
- `rag-agent` 的历史/对比回答语义
- `freshness_sensitive / live_assisted` 分支

</domain>

<current_truth>
## Current Truth

- `Phase 1` 已完成：
  - `SupervisorRequest -> RagRequestPayload` 已拥有 typed `version_query`
  - 闭集固定为 `current / historical / as_of / compare`
  - 无显式 mode 的旧请求继续默认 `current`
- `handbook` / `curriculum` 现有 planner 已能输出 `target_document_ids`
- `rag-agent` 已把 `target_document_ids` 传给 retrieval
- `DocumentRegistry` 当前只提供：
  - `get(document_id, revision_track, version_id)`
  - `latest_versions(document_id, revision_track?)`
  - `current_version(document_id, preferred_revision_tracks=())`
- `RetrievalRequest` 当前只有 document/family/authz filter seam，没有 version-range selector seam
- Qdrant runtime payload 已持有：
  - `document_id`
  - `revision_track`
  - `version_id`
  - `is_current`
- backend 里已经存在按 `document_id` 和单个 `version_id` 构造 filter 的代码路径，但没有正式的 version resolution contract

</current_truth>

<decisions>
## Implementation Decisions

- **02-01:** `Phase 2` 的 owner 是 registry-facing version resolution seam，不是 retrieval backend 黑盒分支，也不是 `rag-agent` prompt 语义。
- **02-02:** resolver 只能消费已经完成语义解析后的输入：
  - resolved `corpus/collection`
  - resolved `target_document_ids`
  - typed `version_query`
  - runtime profile / preferred revision-track context
- **02-03:** resolver 不得消费原始 user text，也不得承担 title/entity fuzzy match；这一步不是第二个 query planner。
- **02-04:** version selection 必须在 retrieval filter 构造之前完成；`Phase 3` 只翻译 resolver 输出，不再重新猜版本意图。
- **02-05:** registry resolution 输出必须是 typed、machine-readable 的 selection truth；至少要能表达：
  - resolved mode
  - 适用的 `document_id`
  - 适用的 `revision_track`
  - 一侧或两侧的 `version_id` 集合
  - resolution status / unresolved reason
- **02-06:** `historical` 不允许静默退化成 `current`；如果当前输入不足以稳定定位历史版本，resolver 必须返回 unresolved/fail-close truth。
- **02-07:** `as_of` 的 owner 固定是 registry；它必须直接输出“该时间点生效的版本”或 unresolved，而不是把日期继续下放给 retrieval 或 answer 层解释。
- **02-08:** `compare` 必须在 retrieval 前锁定双侧版本 truth；如果当前 request protocol 无法提供足够 selector，`Phase 2` 可以补最小 typed selector 扩展，但只允许表达版本轴锚点，不允许引入自由文本查询器。
- **02-09:** 如需补 selector，允许的锚点类型只能是 bounded machine hints，例如：
  - exact `version_id`
  - explicit `as_of`
  - relative current/previous-style anchor
  不允许把自然语言标题、全文关键词或任意字符串重新塞回 resolver。
- **02-10:** 为保持范围收敛，`Phase 2` 默认只在已明确收敛到单 logical document 或显式 document set 时工作；不能把 multi-document 历史比较扩成跨文档检索器。

</decisions>

<specifics>
## Specific Gaps

- 当前 `DocumentRegistry` 没有“列出某个 document 的历史版本并做时间/版本解析”的正式 seam。
- 当前 `VersionQuery` 只有 `mode` 与 `as_of`；这足够支撑 `current` 与部分 `as_of`，但不足以稳定表达一般 `historical` / `compare` selector。
- 当前 retrieval 层可以按 `version_id` 过滤，但没有 code-owned 上游 resolver 告诉它该过滤哪些 `version_id`。
- 如果直接跳去 `Phase 3`，retrieval 层就会被迫承担：
  - 解释 `historical`
  - 解释 `compare`
  - 决定 unresolved/fail-close
  这与 ADR-0014 和 retrieval-serving frozen truth 冲突。

</specifics>

<canonical_refs>
## Canonical References

- `.planning/workstreams/versioned-history-query-foundation/REQUIREMENTS.md`
- `.planning/workstreams/versioned-history-query-foundation/ROADMAP.md`
- `.planning/workstreams/versioned-history-query-foundation/STATE.md`
- `.planning/workstreams/versioned-history-query-foundation/phases/phase-1-request-protocol/CONTEXT.md`
- `.planning/workstreams/versioned-history-query-foundation/phases/phase-1-request-protocol/RESEARCH.md`
- `.planning/workstreams/versioned-history-query-foundation/phases/phase-1-request-protocol/PLAN.md`
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
- `packages/rag-agent/src/campus_rag_agent/handbook_query_planning.py`
- `packages/rag-agent/src/campus_rag_agent/service.py`
- `packages/retrieval-core/src/campus_retrieval_core/models.py`
- `packages/retrieval-core/src/campus_retrieval_core/backend_qdrant.py`

### Web Sanity-Check References

- `https://openai.com/index/introducing-structured-outputs-in-the-api/`
- `https://learn.microsoft.com/en-us/azure/architecture/ai-ml/guide/rag/rag-information-retrieval`
- `https://learn.microsoft.com/en-us/azure/search/vector-search-filters`
- `https://qdrant.tech/documentation/concepts/filtering/`

</canonical_refs>

<deferred>
## Deferred Follow-up

- `Phase 3`
  - retrieval request 的 version filter 字段
  - Qdrant/backend filter translation
- `Phase 4`
  - historical/as_of/compare 回答语义
  - non-current warning / compare 双侧 evidence 解释
- `Phase 5`
  - end-to-end eval coverage
  - unresolved/clarification regression cases

</deferred>
