---
doc_type: architecture
status: active
created: 2026-03-22
updated: 2026-03-24
---

# campus-agent 第一阶段 Ingestion 与存储架构

## 目标

在第一阶段就把长期 `regulations` corpus 的摄入与存储链路正式建好，不保留单机缓存式方案，也不把对象存储、document registry、stable ID 留到后续补齐。当前首批落地 collection 是 `student_handbook`，但它不再被建模为长期 corpus 根名。

当前阶段因为暂时无法使用云服务，对象存储先采用本机部署的 `MinIO` 作为替代实现；但上层 contract 仍然按 `S3-compatible object storage` 设计，不把本机目录当作真相源。

额外约束：

- raw layer 不按 corpus 前缀组织，因为同一份 raw asset 可能被多个 corpus 复用
- processed layer 才按 corpus 前缀组织；当前首批长期知识域为 `regulations`

## 结论

第一阶段采用如下数据平面：

- Crawler / Job 负责采集原始文档
- Queue 负责解耦与重试
- Ingestion Worker 负责去重、版本推进、解析、chunking 和索引写入
- Object Storage 负责原始文档和处理中间结果
  当前阶段实现为本机部署的 `MinIO`
- Raw Asset Registry 负责原始文件级真相元数据
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
- 供应商原始解析响应
- 抽取出的结构化 metadata
- parser 版本和处理时间

存储要求：

- 可放对象存储或结构化存储
- 必须能从 raw 重建 chunk
- 同一 `document_id + representation + version_id` 下允许保存多个 processed artifact
- 供应商原始响应、asset 级 `layout-elements.jsonl` 和文档级 `document-units.jsonl` 必须分层保存，不能互相替代
- 当前阶段优先仍放在本机 `MinIO` 中，与 raw layer 分 bucket 或分前缀管理

`regulations` corpus 在 processed 层固定采用以下命名空间：

- source-oriented artifacts 放在 `regulations/sources/...`
- document-oriented artifacts 放在 `{corpus}/documents/...`

首批 `student_handbook` collection 固定采用以下链路：

- asset-level `provider-response.jsonl`
- asset-level `layout-elements.jsonl`
- repo-tracked `split-manifest.v1.json`
- per-document `canonical.md` / metadata
- per-document `document-units.jsonl`

固定约束：

- handbook 的主输入是 provider 原始响应 `provider-response.jsonl`，不是历史外部存储导入的其他 OCR 形状
- `layout-elements.jsonl` 是 split 前唯一内部统一结构真相
- handbook 文档边界必须先通过 `split-manifest.v1.json` 恢复，再进入 document-level cleaning 和 chunking
- document registry 只登记逻辑文档，不把整本 handbook PDF 作为单一 document truth
- handbook 逻辑文档 identity 脱离 PDF 文件名；raw provenance 通过 `raw_asset_id/raw_version_id/page_start/page_end` 显式回链
- 第一阶段 handbook OCR ingest / replay 固定写入 `representation=source-faithful`

### Chunk / Index Layer

存储内容：

- chunk 文本
- chunk metadata
- embeddings
- vector index

存储要求：

- 第一阶段使用 Qdrant
- Qdrant 是在线检索所消费的 canonical chunk/index store
- 每个 chunk 带 stable `chunk_id`
- 每个 chunk 必须回链到 `document_id`、`representation` 和 `version_id`
- `processed` 必须能重建 chunk，但对象存储不承载 canonical chunk 集合
- 如果为了备份、审计或离线重建导出 chunk manifest，该导出物只能是派生副本，不能替代 Qdrant 中的在线检索数据

### `student_handbook` Collection Runtime Truth

第一阶段把 `student_handbook` 的 chunking / cleaning 策略直接冻结为 runtime truth，不通过环境变量做可变参数开关。

固定参数：

- `target_tokens = 240`
- `max_tokens = 360`
- `overlap_tokens = 48`
- `min_tokens = 40`
- `split_strategy = structure_first`
- `chunk_policy_version = student_handbook_semantic_v1`
- `cleaning_policy_version = student_handbook_cleaning_v1`

固定语义：

- 只支持 `article_body`、`policy_page`、`table`、`table_row` 四类 handbook 语义单元
- `article_body` / `policy_page` 先做 cleaning，再按 token guardrail split
- `table` / `table_row` 作为 evidence 单元保留，不在 phase-1 ingestion 内再次切分
- parent unit 中的原始 HTML table 必须移除，并替换为表格占位文本；细粒度表格事实由 `table` / `table_row` 承担
- oversize split 结果必须写出 `root_unit_id`、`segment_index`、`segment_total`、`split_reason`

### Document Registry

存储内容：

- `document_id`
- `representation`
- `version_id`
- `source_uri`
- `content_hash`
- `corpus`
- `collection`
- `acl_groups`
- `campus_scope`
- `status`
- `ingestion_timestamp`
- `parser_version`
- `embedding_model`
- `source_channel`
- `published_year`
- `effective_year`
- `is_current`
- `raw_asset.raw_asset_id`
- `raw_asset.raw_version_id`
- `raw_asset.page_start`
- `raw_asset.page_end`
- `document_units_object_key`
- `provider_response_object_key`
- `canonical_markdown_object_key`

作用：

- 作为文档元数据真相源
- 支撑增量更新、删除和审计
- 支撑 retrieval 前置过滤和 evidence 回链
- 不重复承载 raw 文件身份；raw 文件身份由 raw asset registry 独立维护
- 其中 `source_uri` 表达逻辑文档版本的 canonical source locator；对于 `curriculum_plan` 这类由 master PDF 拆分出的文档，它应由 `raw_asset_id + raw_version_id + page range` 派生，而不是伪造外部详情页 URL

### Raw Asset Registry

存储内容：

- `raw_asset_id`
- `raw_version_id`
- `raw_source_uri`
- `content_hash`
- `source_filename`
- `object_key`
- `ingestion_timestamp`
- `import_source`

作用：

- 作为原始文件级真相源
- 支撑同一份 PDF 被多个逻辑文档共享时只上传和登记一次
- 支撑 raw layer 审计、重处理和重建

## 第一阶段固定流程

### 摄入链路

`crawler/jobs -> raw layer -> raw asset registry -> ingestion worker -> processed layer -> document registry -> qdrant`

固定规则：

- crawler 不直接把本机文件作为长期数据源
- crawler 产物先进入对象存储，并在 raw asset registry 中登记稳定身份
- ingestion worker 通过 `raw_asset_id + raw_version_id` 消费已登记的 raw asset，而不是直接消费本地 PDF 路径或本地 placeholder job 文件
- ingestion worker 在早期做 hash 去重
- 无变化文档直接 skip
- 有变化文档生成新 `version_id`
- 文档删除通过 registry 状态和索引删除同步处理
- 当前阶段对象存储 endpoint 为本机 `MinIO`
- `student_handbook` collection 的 normalized ingestion 固定为 `provider-response -> layout-elements -> split-manifest -> cleanup/canonical.md -> document-units.jsonl -> qdrant`
- `student_handbook` 回放默认原始文件名为 `学生手册_2018.pdf`；兼容读取历史 `student-handbook.pdf` 仅用于迁移
- `provider_only` 只允许跳过 document-level registry，不允许跳过 canonical raw asset registry
- feature worktree 缺少 `.env` 时，ingestion worker CLI 允许显式回退到 main worktree `.env`；不允许因此改走本地 mock backend 或本地 file-registry 兼容路径

### 查询链路

`supervisor api -> supervisor core -> rag specialist -> retrieval core -> qdrant + registry -> evidence bundle`

固定规则：

- query-serving 默认开放 `regulations` corpus 中的 `student_handbook` collection
- `curriculum/curriculum_plan` 在第一阶段必须完成 raw/processed/registry 与清洗真相收口，但不改变查询面默认 collection 范围
- retrieval 返回的 source 必须能回链到 document registry
- retrieval 前置 ACL filter 必须基于 metadata 执行
- evidence source 必须显式带回 `representation`、`source_channel` 和 `is_current`

## 去重与版本策略

第一阶段采用：

- exact duplicate: `content_hash`
- stable identity: `document_id`
- semantic representation line: `representation`
- mutable version: `version_id`

规则：

- 同一 `document_id` 且 `content_hash` 不变：跳过重处理
- 同一 `document_id` 且 `content_hash` 变化：生成新 `version_id`
- chunk ID 基于 `document_id + representation + version_id + chunk_order`

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
  raw ingestion worker shell 与 rebuild shell
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
  - raw bucket: `{source_channel}/{source_asset_slug}/{year}/{raw_version_id}/{original_filename}`
  - processed bucket source artifact: `{corpus}/sources/{source_channel}/{source_asset_slug}/{year}/{ingest_id}/{artifact_filename}`
  - processed bucket document artifact: `{corpus}/documents/{collection}/{title_slug}--{docid8}/{representation}/{year}/{artifact_filename}`
- 在线 OCR 接入时，`processed/` 下至少允许：
  - `{corpus}/sources/pdf_ocr/{source_asset_slug}/{year}/{ingest_id}/provider-response.jsonl`
  - `{corpus}/sources/pdf_ocr/{source_asset_slug}/{year}/{ingest_id}/layout-elements.jsonl`
  - `{corpus}/documents/{collection}/{title_slug}--{docid8}/{representation}/{year}/canonical.md`
  - `{corpus}/documents/{collection}/{title_slug}--{docid8}/{representation}/{year}/document-units.jsonl`
- 逻辑 ID、来源 ID 和版本 ID 继续保留在 registry / metadata 中；object key 只承载稳定分组语义与人工可核对标签
- 不为 chunk 单独建立 canonical object storage 路径；chunk 的在线主存储保持在 `Qdrant`

详细约束见：

- `docs/decisions/adr-0002-local-minio-conventions.md`

实施拆分见：

- `docs/plans/agentic-rag-foundation.md`

当前实现入口：

- `apps/ingestion-worker/src/campus_ingestion_worker/process_raw_ingestion_job.py`
- `packages/ingestion-core/src/campus_ingestion_core/registry.py`
- `packages/ingestion-core/src/campus_ingestion_core/process.py`
- `packages/retrieval-core/src/campus_retrieval_core/backend_qdrant.py`

## 第一阶段不做的事

- 不做旧 `/api/search`、`/api/answer` 兼容层
- 不做本机目录长期存储
- 不做多知识域 corpus 并行
- 不做多 backend 并行
