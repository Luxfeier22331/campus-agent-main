# 11-05 Summary

## Outcome

- `RetrievalRequest` 不再暴露顶层 `acl_groups` / `campus_scope` 过渡载体；query path 只继续消费 app-owned `AuthorizedRetrievalFilter` 作为 canonical authz 输入。
- supervisor audit 现在会持久化最小 authz / personalization 摘要：`principal_type`、`authorization_projection_source`、`entitlement_snapshot_id`、`policy_projection_version`、`personalization_mode`，同时继续禁止落盘 raw entitlement、visibility scope、memory item 和 session payload。
- retrieval benchmark / qrels validator 现已切到 canonical restricted 词汇，并补上 program-family alias collapse 与 soft-personalization single-doc truth 的回归拦截。

## Main Changes

- `packages/retrieval-core/src/campus_retrieval_core/models.py`
  - 删除 `RetrievalRequest` 顶层 `acl_groups` / `campus_scope`
  - 保留 canonical `authorized_filter` + `entitlement_groups` / `visibility_*` 路径
- `packages/supervisor-core/src/campus_supervisor_core/audit.py`
  - `SupervisorAuditRecord` 新增最小 authz / personalization 摘要字段
  - success / error audit path 都会投影这些字段
- `packages/evals/src/campus_evals/benchmark.py`
  - hybrid restricted category 规范化为 `restricted_entitlement_filter` / `restricted_visibility_scope_filter`
  - legacy fixture category / scope key 仍会在 loader 中被兼容映射，但不再作为 canonical vocabulary
  - qrels validator 新增 program-family alias collapse 与 soft-personalization collapse 拦截
- tests
  - retrieval / supervisor / api / eval benchmark 全部补齐对应红绿回归

## Verification

- `UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m unittest tests.retrieval.test_service tests.supervisor.test_supervisor_core tests.api.test_supervisor_api tests.evals.test_retrieval_benchmark`
- `UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m unittest tests.retrieval.test_backend_qdrant tests.retrieval.test_service tests.supervisor.test_supervisor_core tests.api.test_supervisor_api tests.evals.test_retrieval_benchmark`
- `git diff --check -- packages/retrieval-core/src/campus_retrieval_core/models.py packages/supervisor-core/src/campus_supervisor_core/audit.py packages/evals/src/campus_evals/benchmark.py tests/retrieval/test_service.py tests/supervisor/test_supervisor_core.py tests/api/test_supervisor_api.py tests/evals/test_retrieval_benchmark.py`

## Notes

- 更宽的 dirty-worktree 回归里，`tests.specialist.test_rag_specialist` 与 `tests.evals.test_golden_cases` 仍有当前分支已有的未收口失败，不属于这次 `11-05` 修改引入的新问题。
