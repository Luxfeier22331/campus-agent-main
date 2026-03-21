# 本地 MinIO 约束与迁移不变量

日期：2026-03-22

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
  保存清洗文本、OCR/解析结果、结构化 metadata 和其他中间产物

第一阶段不新增第三个专门 chunk bucket；chunk 文本和 embeddings 仍分别由 Qdrant 与 registry/index 层管理。

## Object Key 规范

第一阶段 object key 采用稳定层级：

- `student_handbook/{document_id}/{version_id}/raw/...`
- `student_handbook/{document_id}/{version_id}/processed/...`

不变量：

- 第一层固定为 `corpus`
- 第二层固定为 `document_id`
- 第三层固定为 `version_id`
- `raw` / `processed` 作为层级语义而不是业务字段

禁止做法：

- 不以临时文件名作为 object key 主标识
- 不把主机路径写进 object key
- 不把 chunk 顺序直接当作 document identity

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

换句话说：

- object storage 负责承载文件
- document registry 负责承载真相元数据
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
- ingestion / retrieval contract
- raw / processed 分层

允许变化的内容：

- endpoint
- credentials
- 生命周期策略
- 备份/容灾策略
- provider-specific IAM 配置

## 第一阶段明确不做

- 不支持直接从本机目录读取作为正式真相源
- 不支持绕过 MinIO 直接落 raw/processed 文件
- 不把 MinIO 管理控制台配置写进架构 contract
- 不为未来云厂商对象存储预留多套 key 规范
