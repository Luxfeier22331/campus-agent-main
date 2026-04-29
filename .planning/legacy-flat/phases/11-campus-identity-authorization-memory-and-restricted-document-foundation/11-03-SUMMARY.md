# 11-03 Summary

## Outcome

- restricted retrieval 现在在 candidate retrieval 前对 targeted restricted documents 执行 fail-close access check，不再把未授权 target 当成普通空命中继续走检索。
- retrieval filter 现在只依赖 canonical `visibility_level`、`entitlement_groups`、`visibility_scope`，不再依赖 legacy `acl_level`、`acl_groups`、`campus_scope` fallback。
- `rag-specialist` 现在会把 targeted restricted deny 映射为安全的 `no_answer`：public path 不泄露 resolved policy title，operator path 只返回最小 deny 文案，不回传 snippet、citation、anchor 或 title summary。

## Main Changes

- `packages/retrieval-core/src/campus_retrieval_core/models.py`
  - 为 `RetrievalRequest` 增加 canonical document access 判定，统一 restricted + scoped visibility 的 allow/deny 语义。
- `packages/retrieval-core/src/campus_retrieval_core/backend_qdrant.py`
  - 增加 `RestrictedDocumentAccessDeniedError`。
  - 在 targeted retrieval 前基于 registry projection 预判 restricted/scoped doc deny，并 fail-close。
  - metadata/Qdrant auth filter 改为 canonical-only：只看 `visibility_level`、`entitlement_groups`、`visibility_scope`。
- `packages/retrieval-core/src/campus_retrieval_core/__init__.py`
  - 导出 restricted deny 异常给上层消费。
- `packages/rag-specialist/src/campus_rag_specialist/service.py`
  - 捕获 restricted deny 并输出无证据、无标题、无 snippet 的安全 `no_answer`。
  - operator principal 走显式安全 deny copy；public path 保持不泄露存在性的 generic no-answer。
- `tests/retrieval/test_backend_qdrant.py`
- `tests/retrieval/test_service.py`
- `tests/specialist/test_rag_specialist.py`
  - 补齐 canonical-only filter、scoped restricted fail-close、targeted deny propagation、public/operator deny-path 无泄漏回归测试。

## Verification

- `UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m unittest tests.retrieval.test_backend_qdrant tests.retrieval.test_service tests.specialist.test_rag_specialist`
  - `121` tests passed
