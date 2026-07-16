# student_rules 集合配置

本目录定义 `student_rules` knowledge target 使用的物理 `regulations/student_rules`
collection。

## 文件

- `serving-config.json`：query-serving 与 Qdrant 合同；
- `split-manifest.v1.json`：公开 synthetic split-manifest fixture；
- `canonical-profile.json`：document identity 与 metadata 字段；
- `chunk-profile.json`：document chunk profile；
- `task-registry.v3.json`：可执行 ingestion task。

## 运行时

- `configs/runtime/query-serving-targets.v1.json` 将 `student_rules` target 映射到本
  collection；
- collection 状态为 `query_serving`，使用 `student_rules` Qdrant alias；
- 在线查询要求 alias 已发布，且 vector 配置与当前 embedding profile 一致。

## 采集

当前 registry 从 canonical `document-units` 开始，只开放两个确定性 task：

- `document_units_validate`
- `chunk_prepare`

source parsing、document materialization、indexing 与 alias publication 不属于本 collection
registry。仓库内 split manifest 是公开 synthetic fixture，部署数据来自私有 source artifact。

学生手册专用 normalization、identity、chunk budget、header handling 与 validation rule 见
`docs/policies/student-rules-chunking.md`。student rules 只包含规章文档与附件；电话目录与服务
目录属于各自产品领域。
