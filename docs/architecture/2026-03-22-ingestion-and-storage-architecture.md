# campus-agent 第一阶段 Ingestion 与存储架构

## 目标

在第一阶段就把 `student_handbook` 的摄入与存储链路正式建好，不保留单机缓存式方案，也不把对象存储、document registry、stable ID 留到后续补齐。

当前阶段因为暂时无法使用云服务，对象存储先采用本机部署的 `MinIO` 作为替代实现；但上层 contract 仍然按 `S3-compatible object storage` 设计，不把本机目录当作真相源。

## 结论

第一阶段采用如下数据平面：

- Crawler / Job 负责采集原始文档
- Queue 负责解耦与重试
- Ingestion Worker 负责去重、版本推进、解析、chunking 和索引写入
- Object Storage 负责原始文档和处理中间结果
  当前阶段实现为本机部署的 `MinIO`
- Document Registry 负责文档级真相元数据
- Qdrant 负责 chunk metadata payload 和向量索引
- Retrieval Core 通过 LlamaIndex 直连 Qdrant，并结合 registry 信息返回 evidence bundle

## 分层模型

### Raw Layer

存储内容：

- PDF、Word、Markdown、HTML 等原始文件
- 原始抓取来源 URI
- 原始文件 hash

存储要求：

- 使用对象存储
- 允许版本保留
- 不以本机文件系统作为长期真相源
- 当前阶段由本机 `MinIO` bucket 承载

### Processed Layer

存储内容：

- 清洗后的正文文本
- OCR / 结构解析结果
- 抽取出的结构化 metadata
- parser 版本和处理时间

存储要求：

- 可放对象存储或结构化存储
- 必须能从 raw 重建 chunk
- 当前阶段优先仍放在本机 `MinIO` 中，与 raw layer 分 bucket 或分前缀管理

### Chunk / Index Layer

存储内容：

- chunk 文本
- chunk metadata
- embeddings
- vector index

存储要求：

- 第一阶段使用 Qdrant
- 每个 chunk 带 stable `chunk_id`
- 每个 chunk 必须回链到 `document_id` 和 `version_id`

### Document Registry

存储内容：

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

作用：

- 作为文档元数据真相源
- 支撑增量更新、删除和审计
- 支撑 retrieval 前置过滤和 evidence 回链

## 第一阶段固定流程

### 摄入链路

`crawler/jobs -> queue -> ingestion worker -> raw layer -> processed layer -> document registry -> qdrant`

固定规则：

- crawler 不直接把本机文件作为长期数据源
- crawler 产物先进入对象存储和队列
- ingestion worker 在早期做 hash 去重
- 无变化文档直接 skip
- 有变化文档生成新 `version_id`
- 文档删除通过 registry 状态和索引删除同步处理
- 当前阶段对象存储 endpoint 为本机 `MinIO`

### 查询链路

`supervisor api -> supervisor core -> rag specialist -> retrieval core -> qdrant + registry -> evidence bundle`

固定规则：

- retrieval 只支持 `student_handbook`
- retrieval 返回的 source 必须能回链到 document registry
- retrieval 前置 ACL filter 必须基于 metadata 执行

## 去重与版本策略

第一阶段采用：

- exact duplicate: `content_hash`
- stable identity: `document_id`
- mutable version: `version_id`

规则：

- 同一 `document_id` 且 `content_hash` 不变：跳过重处理
- 同一 `document_id` 且 `content_hash` 变化：生成新 `version_id`
- chunk ID 基于 `document_id + version_id + chunk_order`

## ACL 与 Traceability

第一阶段必须做到：

- 文档级 ACL metadata
- chunk 级 ACL metadata 继承文档 metadata
- evidence bundle 返回最小 source locator 字段
- ingestion 和 query 都写结构化日志
- object key 从第一天起带稳定路径语义，避免未来迁移云对象存储时重写 key 体系

第一阶段不做到：

- chunk-level field masking
- 完整 ABAC policy engine
- 不可变审计账本

## 与仓库结构的对应关系

- `apps/ingestion-worker`
  队列消费和 ingestion runtime
- `packages/ingestion-core`
  去重、解析、chunking、embedding 写入逻辑
- `packages/retrieval-core`
  基于 registry + Qdrant 的 retrieval 抽象
- `packages/contracts`
  document / chunk / evidence 相关 schema

## 当前阶段对象存储约束

第一阶段的对象存储实现约束固定为：

- 使用本机部署的 `MinIO`
- 上层一律按 `S3-compatible` 接口接入
- 不直接依赖本机目录路径
- 不把 `MinIO` 内部路径语义泄漏到 contracts
- bucket 至少拆成：
  - `campus-rag-raw`
  - `campus-rag-processed`
- object key 建议采用：
  - `student_handbook/{document_id}/{version_id}/raw/...`
  - `student_handbook/{document_id}/{version_id}/processed/...`

详细约束见：

- `docs/decisions/2026-03-22-local-minio-conventions.md`

实施拆分见：

- `docs/plans/2026-03-22-agentic-rag-foundation.md`

## 第一阶段不做的事

- 不做旧 `/api/search`、`/api/answer` 兼容层
- 不做本机目录长期存储
- 不做多 corpus 并行
- 不做多 backend 并行
