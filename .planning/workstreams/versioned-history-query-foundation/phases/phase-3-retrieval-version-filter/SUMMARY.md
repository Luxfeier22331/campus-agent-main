---
doc_type: phase_summary
phase: "3"
phase_name: "Retrieval Version Filter"
status: completed
created: 2026-04-21
updated: 2026-04-21
---

# Phase 3 Summary

## Outcome

`versioned-history-query-foundation` 已完成第三层 retrieval version filter 收口：

- `RetrievalRequest` 新增正式 version filter seam：
  - `target_version_ids`
  - `target_revision_track`
- `retrieve_sources(...)` 已能把 resolver 输出显式传入 retrieval request
- `backend_qdrant` 已在 candidate 阶段应用：
  - exact `revision_track`
  - `version_id IN (...)`
- 当请求显式提供 `target_version_ids` 时，backend 会跳过默认 `current_only` 过滤，避免历史请求被 `is_current=True` 意外裁掉
- `rag-agent` 已在 non-current 请求上先做 version resolution：
  - 单 document 且 resolved 时，把过滤条件传给 retriever
  - unresolved 时直接 fail-close，`no_answer_reason=version_filter_unresolved`

## Implemented Surfaces

- `packages/retrieval-core`
  - `RetrievalRequest.target_version_ids`
  - `RetrievalRequest.target_revision_track`
  - `retrieve_sources(..., target_version_ids=..., target_revision_track=...)`
  - `_build_metadata_filters(...)`
  - `_build_qdrant_filter(...)`
- `packages/rag-agent`
  - `delegate_to_rag_agent()` 的 non-current version resolution hook
  - historical version unresolved fail-close branch

## Verification

- `uv run --all-packages python -m unittest tests.retrieval.test_service tests.retrieval.test_backend_qdrant tests.specialist.test_rag_specialist`
- `uv run --all-packages python -m unittest tests.contracts.test_models tests.api.test_supervisor_api tests.supervisor.test_supervisor_core tests.ingestion.test_version_resolution tests.retrieval.test_service tests.retrieval.test_backend_qdrant tests.specialist.test_rag_specialist`
- `git diff --check -- packages/retrieval-core/src/campus_retrieval_core/models.py packages/retrieval-core/src/campus_retrieval_core/service.py packages/retrieval-core/src/campus_retrieval_core/backend_qdrant.py packages/rag-agent/src/campus_rag_agent/service.py tests/retrieval/test_service.py tests/retrieval/test_backend_qdrant.py tests/specialist/test_rag_specialist.py`

## Notes

- 当前 phase 只支持“已收敛到单 target document 的历史请求”。
- compare / as_of 的用户可见回答语义仍留给 `Phase 4`，本 phase 不提前实现说明文案或双侧 evidence 解释。
