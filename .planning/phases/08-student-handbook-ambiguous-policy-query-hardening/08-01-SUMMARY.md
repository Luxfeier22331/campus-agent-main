---
phase: 08-student-handbook-ambiguous-policy-query-hardening
plan: "01"
status: completed
completed_at: "2026-04-02T12:29:36+08:00"
---

# 08-01 Summary

## Outcome

`retrieval-core` 现在具备了 handbook 制度对象问句所需的 document-targeted retrieval 基础能力：

- `RetrievalRequest` 与 `retrieve_sources(...)` 新增可选 `target_document_ids`
- Qdrant filter 仅在传入 target docs 时追加 `document_id` 约束
- 既有 `corpus` / `collection` / `status` / `revision_track` / `is_current` / ACL / `visibility_scope` 过滤保持不变
- targeted 与 untargeted 检索路径都有直接回归测试

## Files

- `packages/retrieval-core/src/campus_retrieval_core/models.py`
- `packages/retrieval-core/src/campus_retrieval_core/service.py`
- `packages/retrieval-core/src/campus_retrieval_core/backend_qdrant.py`
- `tests/retrieval/test_backend_qdrant.py`

## Verification

- `UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m pytest tests/retrieval/test_backend_qdrant.py -q`: pass

## Next

执行 `08-02`：在 `rag-specialist` 内补齐 handbook policy-object resolution、pre-retrieval clarification，以及对象内 `no_answer` fail-close。
