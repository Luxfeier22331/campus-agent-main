# AGENTS.md

本文件补充根级 `AGENTS.md`，只描述 `packages/ingestion-core` 的局部规则。

## Role

这个 package 承载 ingestion / projection / materialization data plane。

- 负责 source truth、projection、document artifacts、chunking、index preparation
- 负责 authenticated notice、official web、curriculum、handbook 等 source-channel data-plane
  logic
- 不负责 online supervisor routing、agent answer shaping 或 Go tool read model

## Module Rules

- projection 主文件只保留 build/release orchestration 与领域映射
- DTO / Protocol 放到 `*_models.py`
- schema version、filename、source family 等常量放到 `*_constants.py`
- bundle validation 放到 `*_validation.py`
- query-time policy-like deterministic projection decisions 放到命名清晰的 domain helper
  module，不要堆回 projection facade
- source truth、projection、document-units、chunks / index 之间的层次不得合并

## Verification

优先使用这些命令验证本目录相关变更：

```bash
uv run --all-packages python -m unittest \
  tests.ingestion.ingestion_core_structure_suite \
  tests.ingestion.test_service_guide_projection \
  tests.ingestion.test_internal_notice_consumption_projection -q
uv run --all-packages ruff check packages/ingestion-core/src tests/ingestion
```
