# 11-02 Summary

## Outcome

- restricted-document ingestion/data-plane 现在把 `entitlement_groups`、`visibility_scope`、`visibility_level`、`policy_projection_version` 作为 primary projection truth。
- `DocumentRegistryRecord`、`IndexableChunk` 与 shared import metadata 现在会把 legacy `acl_level` / `acl_groups` / `campus_scope` 收口为 canonical projection 的受控兼容镜像，不再允许同一条记录长期保留分叉语义。
- 这次执行只覆盖 Phase 11 的 data-plane migration；restricted retrieval fail-close 与 deny-path surface safety 仍留在 `11-03`。

## Main Changes

- `packages/ingestion-core/src/campus_ingestion_core/models.py`
  - `DocumentRegistryRecord` 在 canonical projection 存在时会强制把 `acl_groups` 和 `campus_scope` 归一为 mirror 字段。
- `packages/ingestion-core/src/campus_ingestion_core/process.py`
  - `IndexableChunk` 现在以 canonical `entitlement_groups` / `visibility_*` 为主语义，并把 legacy `acl_* / campus_scope` 统一成 mirror。
- `packages/ingestion-core/src/campus_ingestion_core/campusrag_ingestion_support.py`
  - `apply_authorization_projection_metadata()` 现在同步写入 legacy `acl_level` mirror，避免 document metadata 出现 `visibility_level=restricted` 但 `acl_level=public` 的分叉。
- `tests/ingestion/test_registry_models.py`
- `tests/ingestion/test_campusrag_ingestion_support.py`
- `tests/ingestion/test_processing_pipeline.py`
- `tests/ingestion/test_split_manifest.py`
  - 新增 canonical-first / mirror 语义回归测试，覆盖 registry、chunk 和 shared import metadata。

## Verification

- `UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m unittest tests.ingestion.test_registry_models tests.ingestion.test_campusrag_ingestion_support tests.ingestion.test_processing_pipeline tests.ingestion.test_split_manifest tests.ingestion.test_provider_result_replay_rebuild`
  - `80` tests passed
