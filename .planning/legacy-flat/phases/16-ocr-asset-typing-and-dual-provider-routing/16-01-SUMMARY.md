# 16-01 Summary: raw asset typing metadata 与 provider-neutral routing contract

## Outcome

Phase 16 的第一步已经落地：raw asset registration 不再假定“输入一定是 PDF”，而是把 typed metadata 收口到 raw layer。

这一步完成了三件事：

- `register_raw_asset` 入口改成通用 `file_path`
- raw asset registry 现在持久化 `content_type`、扩展名、字节数、基础图片尺寸/页数以及初始资产分类
- 历史 raw asset payload 仍可反序列化，不会因新增字段破坏既有 registry truth

## Key Changes

- `packages/ingestion-core/src/campus_ingestion_core/raw_asset_typing.py`
  - 新增轻量 raw asset typing helper
  - 基于扩展名、MIME 和 Pillow 图片头信息推断基础 metadata
- `packages/ingestion-core/src/campus_ingestion_core/models.py`
  - `RawAssetRecord` 新增 typed metadata 字段与基础校验/归一化
- `packages/ingestion-core/src/campus_ingestion_core/registry.py`
  - raw asset payload 反序列化支持新字段，同时兼容旧 payload 缺字段
- `apps/ingestion-worker/src/campus_ingestion_worker/register_raw_asset.py`
  - worker raw asset 注册切到 `file_path`
  - source bucket upload 不再硬编码 `application/pdf`
- `apps/ingestion-worker/README.md`
  - operator 文档切到 `--file-path`

## Verification

```bash
uv run --all-packages python -m unittest \
  tests.ingestion.test_register_raw_asset \
  tests.ingestion.test_registry_models \
  tests.ingestion.test_process_raw_ingestion_job \
  tests.test_environment_layout
```

Result:

- `Ran 84 tests`
- `OK`

## Remaining Gap

- 当前分类仍是 registration-stage 的轻量分类，只能稳定区分 PDF / image / office-document candidate / unknown
- `text-dominant PDF`、`simple table image`、`complex table image`、`spatial image` 这种更高层路由分类，仍要在 `16-02` 之后结合 compare/adjudication evidence 收口

## Next

- 执行 `16-02`
- 把现有 sidecar compare lane 升级成结构化 adjudication evidence
