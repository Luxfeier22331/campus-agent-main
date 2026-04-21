---
phase: "3"
name: "Retrieval Version Filter"
created: 2026-04-21
updated: 2026-04-21
status: completed
---

# Phase 3 Context

**Gathered:** 2026-04-21
**Status:** Completed

<domain>
## Phase Boundary

本 phase 只负责：

- 为 retrieval path 增加正式 version filter seam
- 把 `Phase 2` resolver 输出翻译成 backend pre-filter
- 明确 historical single-document 请求在 version unresolved 时必须 fail-close

它不负责：

- 重新解释自然语言历史意图
- 在 answer 层补齐 current / historical / as_of / compare 的完整用户语义
- 扩写成 freshness / live retrieval 总线

</domain>

<current_truth>
## Current Truth

- `Phase 1` 已固定 `version_query` request contract
- `Phase 2` 已固定 registry-owned version resolution seam
- `rag-agent` 已能在 resolved query plan 下给 retrieval 传递 `target_document_ids`
- `backend_qdrant` 已持有 `document_id / revision_track / version_id / is_current` payload 过滤条件
- 当前缺口只剩：
  - `RetrievalRequest` 没有正式 version filter 字段
  - backend 没有消费 resolver 输出
  - historical 请求 unresolved 时仍可能落回普通 current retrieval

</current_truth>

<decisions>
## Implementation Decisions

- **03-01:** `Phase 3` 只接 `Phase 2` 的 typed version-selection truth，不在 retrieval/backend 重新猜 selector。
- **03-02:** retrieval pre-filter 是 canonical owner；不允许“先 current-only 召回，再在回答层裁剪历史版本”。
- **03-03:** `RetrievalRequest` 只补最小字段：
  - `target_version_ids`
  - `target_revision_track`
- **03-04:** 这些字段不是通用查询语言；它们只承载上游已解析好的 bounded selection truth。
- **03-05:** 当显式 `target_version_ids` 存在时，backend 必须跳过默认 `current_only` 过滤。
- **03-06:** 当显式 `target_revision_track` 存在时，backend 必须使用 exact `revision_track`，而不是 runtime profile 的 broad serving track set。
- **03-07:** `rag-agent` 只为 non-current 请求执行 version resolution；`current` 保持现有路径不变。
- **03-08:** 当前 phase 只支持已收敛到单 document 的 historical request；如果目标 document 未稳定收敛，则直接 fail-close。

</decisions>

<canonical_refs>
## Canonical References

- `.planning/workstreams/versioned-history-query-foundation/ROADMAP.md`
- `.planning/workstreams/versioned-history-query-foundation/STATE.md`
- `.planning/workstreams/versioned-history-query-foundation/phases/phase-2-registry-version-resolution/SUMMARY.md`
- `docs/plans/archive/completed/versioned-history-query-foundation.md`
- `packages/retrieval-core/src/campus_retrieval_core/models.py`
- `packages/retrieval-core/src/campus_retrieval_core/service.py`
- `packages/retrieval-core/src/campus_retrieval_core/backend_qdrant.py`
- `packages/rag-agent/src/campus_rag_agent/service.py`
- `tests/retrieval/test_service.py`
- `tests/retrieval/test_backend_qdrant.py`
- `tests/specialist/test_rag_specialist.py`

</canonical_refs>
