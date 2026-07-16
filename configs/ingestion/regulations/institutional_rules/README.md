# institutional_rules 集合配置

本目录定义 `institutional_rules` knowledge target 使用的物理
`regulations/institutional_rules` collection。

## 文件

- `serving-config.json`：query-serving 与 Qdrant 合同；
- `canonical-profile.json`：document identity 与 provenance 字段；
- `chunk-profile.json`：canonical document chunk profile；
- `query-planning.json`：title-aware retrieval hint；
- `task-registry.v3.json`：可执行 ingestion task。

## 运行时

- `configs/runtime/query-serving-targets.v1.json` 将 `institutional_rules` target 映射到本
  collection；
- collection 状态为 `query_serving`，使用 `institutional_rules` Qdrant alias，可准入 public
  或 campus-restricted evidence；
- 在线查询要求 alias 已存在，且 dense/sparse vector 配置与当前 embedding profile 一致。

## 采集

当前 registry 从 canonical `document-units` 开始，只开放两个确定性 task：

- `document_units_validate`
- `chunk_prepare`

source materialization、indexing 与 alias publication 不属于本 collection registry，不保留
占位 promotion 声明。

canonical regulation identity 以 regulation work、issuer 与 semantic applicability 为依据，
不使用 wrapper notice id。promotion 保留 source notice provenance，同时区分
`source_notice_document_id` 与 `semantic_owner_document_id`。

display metadata 必须区分：

- `regulation_work_title`：稳定 work identity；
- `regulation_edition_label`：edition 或 revision label；
- `regulation_display_title`：渲染后的 work 与 edition title；
- `source_title_literal`：来源原始 title。

年度周期与限时规则属于 `regulations/scoped_rules`，不属于本 collection。
