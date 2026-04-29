---
doc_type: phase_plan
phase: "3"
phase_name: "Retrieval Version Filter"
status: completed
created: 2026-04-21
updated: 2026-04-21
---

# Phase 3 Plan

## Objective

把 `Phase 2` 的 registry-owned version-selection truth 正式接到 retrieval candidate path：
让 non-current 请求在进入 vector retrieval 前就携带 `version_id / revision_track` 过滤条件，而不是留给回答层事后裁剪。

## Locked Inputs

- `VersionQuery` contract 已由 `Phase 1` 冻结
- `resolve_version_query(...)` 已由 `Phase 2` 冻结
- 当前 phase 只消费：
  - resolved `target_document_ids`
  - resolved `version_query`
  - runtime profile 的 preferred revision tracks
- 当前 phase 不补完整 answer semantics

## Execution Slices

### Slice 1: Retrieval Request Surface

- 在 `RetrievalRequest` 增加最小 version filter 字段：
  - `target_version_ids`
  - `target_revision_track`
- 在 request normalization 中收口空字符串与空值

### Slice 2: Service Pass-Through

- 为 `retrieve_sources(...)` 暴露同名参数
- 保持现有 document / curriculum / authz filter seam 不变

### Slice 3: Backend Pre-Filter

- `backend_qdrant` 明确消费：
  - exact `revision_track`
  - `version_id IN (...)`
- 当显式 `target_version_ids` 存在时，跳过默认 `is_current=True`
- 当显式 `target_revision_track` 存在时，跳过 broad `serving_revision_tracks`

### Slice 4: rag-agent Resolution Hook

- 仅对 `version_query.mode != current` 触发 version resolution
- 仅在已收敛到单 target document 时允许继续 retrieval
- unresolved 时 fail-close，并返回正式 `version_filter_unresolved`

### Slice 5: Focused Tests

- retrieval service pass-through test
- backend pre-filter test
- rag-agent historical resolved / unresolved tests

## Exit Rule

Phase 3 完成后，repo 应达到：

- resolver 输出已成为 retrieval request 的正式输入
- backend candidate 阶段已经按 `version_id / revision_track` 预过滤
- unresolved historical request 不会静默回退成普通 current retrieval
- `Phase 4` 可以只聚焦 answer semantics，不再承接 filter plumbing
