---
doc_type: decision
decision_id: ADR-0002
status: accepted
created: 2026-03-22
updated: 2026-03-22
---

# ADR-0002 本地 MinIO 约束与迁移不变量

适用范围：`campus-agent` v2 第一阶段在暂时无法使用云对象存储时的本地替代实现

## 目标

在第一阶段使用本机部署的 `MinIO` 作为对象存储替代实现，同时确保上层 contract、bucket 语义和 object key 体系不依赖本机目录路径，避免未来迁移云对象存储时重写数据面规则。

## 决策

- 当前阶段对象存储实现为本机部署的 `MinIO`
- 上层始终按 `S3-compatible object storage` 接口接入
- 不把本机目录、挂载路径或 MinIO 内部实现细节写入 contracts
- MinIO 只是当前替代实现，不上升为长期架构绑定

## Bucket 约定

第一阶段固定至少两个 bucket：

- `campus-rag-raw`
- `campus-rag-processed`

职责：

- `campus-rag-raw`
  保存原始 PDF、Word、Markdown、HTML 等源文件
- `campus-rag-processed`
  保存清洗文本、OCR/解析结果、供应商原始解析响应、结构化 metadata 和其他中间产物

第一阶段不新增第三个专门 chunk bucket；chunk 文本和 embeddings 仍分别由 Qdrant 与 registry/index 层管理。
如果为了备份、审计或离线重建额外导出 chunk manifest，该导出物也不能上升为 canonical chunk store。

## Object Key 规范

第一阶段 object key 采用稳定层级：

- raw bucket: `{corpus}/assets/{raw_asset_kind}/{raw_asset_slug}/{hash_algorithm}/{hash_value}/{original_filename}`
- processed bucket: `{corpus}/documents/{document_kind}/{document_slug}/{version_kind}/{version_slug}/{artifact_filename}`

在线 OCR 的 processed artifact 约定：

- `{corpus}/documents/{document_kind}/{document_slug}/{version_kind}/{version_slug}/provider-result.jsonl`
- `{corpus}/documents/{document_kind}/{document_slug}/{version_kind}/{version_slug}/structured.jsonl`
- 当一个 raw asset 需要 fan-out 成多个逻辑文档时，允许保留 asset 级 processed artifact：
  `{corpus}/assets/{raw_asset_kind}/{raw_asset_slug}/{hash_algorithm}/{hash_value}/provider-result.jsonl`
  `{corpus}/assets/{raw_asset_kind}/{raw_asset_slug}/{hash_algorithm}/{hash_value}/structured-full.jsonl`

说明：

- `provider-result.jsonl` 保存供应商返回的原始响应，供审计、重放和排障使用
- `structured.jsonl` 保存内部统一的归一化结果，供 registry、chunking 和去重使用
- `provider-result.jsonl` 不得冒充 raw layer 真相源

不变量：

- 第一层固定为 `corpus`
- raw 第二层固定为 `assets`
- processed 第二层固定为 `documents`
- identity segment 不直接把 `:` 放进 object key，而是按语义拆成多级路径
- 例如 `asset:student-handbook-pdf` 展开为 `asset/student-handbook-pdf`
- 例如 `sha256:b618...` 展开为 `sha256/b618...`
- 例如 `handbook:00e...` 展开为 `handbook/00e...`
- 例如 `v1:2fba...` 展开为 `v1/2fba...`
- raw / processed 层级语义由 bucket 表达，不在 key 内重复编码

禁止做法：

- 不以临时文件名作为 object key 主标识
- 不把主机路径写进 object key
- 不把 chunk 顺序直接当作 document identity
- 不把 raw 文件身份绑到 `document_id/version_id`
- 不允许同一份 raw PDF 因为多个逻辑文档而在 raw bucket 重复保存

## 元数据与 Registry 对齐

以下字段不依赖 object key 推断，必须在 document registry 中显式存在：

- `document_id`
- `version_id`
- `source_uri`
- `content_hash`
- `corpus`
- `acl_groups`
- `campus_scope`
- `status`
- `ingestion_timestamp`
- `parser_version`
- `embedding_model`
- `raw_asset.raw_asset_id`
- `raw_asset.raw_version_id`
- `raw_asset.page_start`
- `raw_asset.page_end`

以下字段必须在 raw asset registry 中显式存在：

- `raw_asset_id`
- `raw_version_id`
- `raw_source_uri`
- `content_hash`
- `source_filename`
- `object_key`

换句话说：

- object storage 负责承载文件
- raw asset registry 负责承载 raw 文件级真相元数据
- document registry 负责承载逻辑文档级真相元数据
- 不允许把 MinIO bucket/object 命名当成 registry 的替代品

## 部署约束

第一阶段的 MinIO 约束如下：

- 只作为本机对象存储服务使用
- 不退化成直接写宿主机目录
- 通过标准 S3 endpoint、access key、secret key 接入
- bucket 创建和权限初始化由部署脚本或运维步骤完成，不由业务代码隐式创建

## 迁移不变量

未来从本机 MinIO 迁移到云对象存储时，以下内容必须保持不变：

- bucket 语义
- object key 结构
- `source_uri` 生成规则
- document registry 字段
- raw asset registry 字段
- ingestion / retrieval contract
- raw / processed 分层

允许变化的内容：

- endpoint
- credentials
- 生命周期策略
- 备份/容灾策略
- provider-specific IAM 配置

补充说明：

- `source_uri` 不要求等于外部官网 URL。
- 当正式来源只有 raw asset（例如一份 master PDF）时，`source_uri` 应表示 document registry 可稳定回链的内部 canonical locator。
- `curriculum_plan` 的 split manifest 只提供 page range truth；其 `source_uri` 由 ingestion 基于 `raw_asset_id`、`raw_version_id`、`page_start`、`page_end` 派生。

## 第一阶段明确不做

- 不支持直接从本机目录读取作为正式真相源
- 不支持绕过 MinIO 直接落 raw/processed 文件
- 不把 MinIO 管理控制台配置写进架构 contract
- 不为未来云厂商对象存储预留多套 key 规范
