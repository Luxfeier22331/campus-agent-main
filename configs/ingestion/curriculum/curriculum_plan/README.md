# curriculum_plan 集合配置

本目录定义 `curriculum` knowledge target 使用的物理 `curriculum/curriculum_plan` collection。

## 文件

- `serving-config.json`：query-serving 与 Qdrant 合同；
- `split-manifest.v1.json`：公开 synthetic logical-document boundary；
- `chunk-profile.json`：section 与 table chunk profile；
- `query-planning.json`、`retrieval-profile.json`：retrieval 配置；
- `samples/`：synthetic document-unit sample；
- `task-registry.v3.json`：可执行 ingestion task。

## 运行时

- `configs/runtime/query-serving-targets.v1.json` 以 `curriculum` 暴露领域 target，并映射到本
  physical collection；
- collection 状态为 `query_serving`，使用 `curriculum_plan` Qdrant alias；
- 在线查询要求 alias 已发布，且 vector 配置与当前 embedding profile 一致。

## 采集

当前 registry 从 canonical `document-units` 开始，只开放两个确定性 task：

- `document_units_validate`
- `chunk_prepare`

source parsing、document materialization、indexing 与 alias publication 不属于本 collection
registry。真实 curriculum source 和已审查 split 数据来自私有 artifact；仓库内 manifest 与
sample 是公开 synthetic fixture。

curriculum `document-units` 必须保留重建 section 与 table 所需的 heading、reading order、
HTML/table cell、caption ownership 和 continuation group；删除这些字段违反合同。runtime
chunking 从 `serving-config.json` 与 `chunk-profile.json` 加载，section/table profile 由本
collection 拥有。
