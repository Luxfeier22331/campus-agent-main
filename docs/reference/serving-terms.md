---
doc_type: reference
owner_boundary: docs/reference
status: active
---

# 服务术语

## 边界

本文统一 Campus Web 文档、检索发布和 Agent 运行中的名称。实现状态仍以 schema、配置、数据库
migration 和代码为准。

## 文档输入

### 阅读器固定链接

面向用户的稳定文档 URL，例如 `/docs/:corpus/:collection/:docSlug`。链接中不包含 chunk、Qdrant
collection 或对象存储位置。

### 语料域与集合

`corpus` 和 `collection` 是 Campus Web 来源清单中的文档所有权与公开目录 metadata，例如
`regulations/student_rules`。它们可以用于评测结果分类，但不是模型参数、在线路由范围或独立向量
collection。

### Campus Docs 来源清单

对象存储固定键 `campus-docs/source.json` 中的 `campus_docs_source.v3`。它列出文档、版本、唯一当前
版本和内容寻址 reader 引用，是 Campus Web 构建与检索 publisher 共享的控制清单。清单本身不是可
检索正文。

### Reader

`campus_docs_reader.v3` 是已经清洗的显示正文，按原始阅读顺序保存 heading、paragraph、list、
blockquote 和 table。publisher 只消费来源清单选中的当前 reader。

## Agent 与离线知识数据

### 模型可见工具

当前运行中通过 `tools.v6.json` 和冻结准入策略向 Primary Agent 暴露的函数工具。当前没有机构知识
检索工具；离线索引存在不表示模型已经获得知识上下文。

### 工具调用上限

一次 SDK run 允许的最大真实函数工具调用次数。它与检索候选数量、Temporal retry 和 SDK
`maxTurns` 分开计算。

## 索引与检索制品

### 阶段定义

publisher 代码内分别维护 `CHUNK_SET_DEFINITION`、`EMBEDDING_SPACE` 和
`COLLECTION_DEFINITION`。三者依次拥有 reader/分块定义、space ID/dimensions，以及 Qdrant dense/sparse
向量名、查询指令、距离和 point schema。provider、endpoint、API key、model alias、批大小和并发数
属于执行连接或调用参数，不进入内容寻址 manifest。

当前没有在线查询消费者；上述定义只由离线制品构建和发布实现使用，不从 PostgreSQL 或环境变量读取
第二份定义。

### Collection 身份

Qdrant collection 名由显式 Embedding Set ID 与当前 `COLLECTION_DEFINITION` 的规范 JSON SHA-256
形成：`campus_docs_<sha256>`。该摘要只用作 collection 后缀，不另行生成索引制品，也不维护第二套
运行时 index ID、fingerprint 或数据库历史记录。

### Chunk Set

`campus_docs_chunk_set.v2` manifest 与 `chunks.ndjson` 组成的内容寻址制品。manifest 记录当前文档
投影摘要、分块定义、Chunk 数据引用和数量；完整 `source.json` 摘要不参与身份。Chunk Set 是
Embedding 的显式输入，并由 Embedding Set 传递给 Publisher，不是当前指针。

### Embedding Set

`campus_docs_embedding_set.v3` manifest 与 `embeddings.ndjson` 组成的内容寻址制品。manifest 记录 Chunk
Set、Model Target hash、向量数量、数据引用及 `spaceId`/dimensions；每条记录以 `retrievalTextSha256` 标识唯一检索文本
向量。Embedding Job 只能从操作者显式指定的同空间旧 embedding set 复用，不扫描 bucket 或 Qdrant。

### Section 与 Chunk

section 由 reader heading 路径或标题前正文形成，并绑定文档、版本和可选 `anchor`。chunk 在同一
section 内按 reader 正文元素或表格逻辑行形成，记录覆盖的全部 `root_unit_ids`；它不是公开 URL 或
独立来源对象。

### Point

写入 Qdrant 的离线检索单元。point 使用确定性 UUID，payload 只包含 schema、chunk、document、section、
版本 ID/slug/label、`root_unit_ids`、正文、正文 SHA-256 和检索文本 SHA-256，并同时保存 `dense` 与
`sparse` named vector。检索文本由文档标题、完整 heading 路径和正文组成。

## 发布与激活

### 当前索引绑定

PostgreSQL `campus_docs_serving.current_index` 的单行记录，只保存当前 collection 名。execution-control
当前不在在线 run 准入时读取它；数据库不保存索引历史、查询定义或重复的不可变索引记录。

### 索引发布

Publisher 读取显式 embedding set，并从其 manifest 解析唯一 chunk set，构建完整新 Qdrant
collection，验证后原子替换当前 collection 指针。它不读取 reader、调用 embedding provider 或写入
额外的索引制品。
文档更新不会原地改写旧 collection；旧 collection 也不会在切换后立即删除。

Embedding Job 在新旧制品的 `spaceId` 和 dimensions 一致时，按
`retrievalTextSha256` 复用显式旧 embedding set 的 dense vector，只为新检索文本调用 provider。
Publisher 始终从 chunk set 完整生成 payload 与 sparse vector。Qdrant 不承担 embedding 缓存职责。

## 常见混淆

- `source.json` 是控制清单，不是检索正文；
- 文档集合不等于在线路由范围或物理 collection；
- 文档静态交付与检索索引发布共享输入，但拥有独立产物和激活过程；
- 离线 Campus Docs 制品不属于当前工具轨迹；
- publisher、schema 或配置存在不代表某个环境已经激活当前索引；
- 通知采集产物不属于当前 Campus Docs 索引输入；
- Langfuse 中存在 trace 不代表 Temporal workflow 已经成功结束。
