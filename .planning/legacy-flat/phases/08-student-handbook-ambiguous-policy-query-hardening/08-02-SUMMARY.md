---
phase: 08-student-handbook-ambiguous-policy-query-hardening
plan: "02"
status: completed
completed_at: "2026-04-02T12:29:36+08:00"
---

# 08-02 Summary

## Outcome

`rag-specialist` 现在能对 handbook 歧义制度对象问句走保守解析，而不是把 formal title 继续塞回自由文本检索：

- 新增 `configs/ingestion/regulations/student_handbook/query-planning.json`
- 新增 specialist-local `query_planning.py`，用于解析 alias、冲突对象和缺失对象
- 已解析的制度对象会把 `target_document_ids` 传给 retrieval
- 未解析对象在检索前直接返回 `needs_clarification`
- 已解析但条款不支持的问题会返回带 resolved policy name 的对象内 `no_answer`

## Files

- `configs/ingestion/regulations/student_handbook/query-planning.json`
- `packages/rag-specialist/src/campus_rag_specialist/query_planning.py`
- `packages/rag-specialist/src/campus_rag_specialist/service.py`
- `tests/specialist/test_rag_specialist.py`

## Verification

- `UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m pytest tests/specialist/test_rag_specialist.py -q`: pass

## Next

执行 `08-03`：把 alias-resolved、clarification、对象内 `no_answer` 三类 handbook policy-object case 固化进 eval / retrieval benchmark truth。
