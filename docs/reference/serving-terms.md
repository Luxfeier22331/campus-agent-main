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

对象存储固定键 `campus-docs/source.json` 中的 `campus_docs_source.v4`。它列出文档、版本和内容寻址
reader 引用，是 Campus Web 构建与检索 publisher 共享的控制清单。当前版本由同一文档内数值最大的
`versionSlug` 派生，清单本身不是可检索正文。

### Reader

`campus_docs_reader.v3` 是已经清洗的显示正文，按原始阅读顺序保存 heading、paragraph、list、
blockquote 和 table。Docs builder 只消费来源清单选中的当前 reader；统一 serving publisher 不直接读取
reader。

### Notice Chunk Run

已发布 Notice 的正文由 `notice-index-publisher` 生成 `notice_chunk_run.v1`。统一 publisher 只消费 Chunk
数据；title 取 `retrieval_text` 首行，citation 由 `noticeId` 固定生成 `/notices/<noticeId>`，不访问 live
Notices DB。`review-samples.ndjson` 和 `validation.json` 是离线诊断产物，不是 serving 输入。

## Agent 与离线知识数据

### 模型可见工具

当前运行中通过 `tools.v7.json` 和冻结准入策略向 Primary Agent 暴露的函数工具。当前机构知识通过只读
`campus_search` 按需检索；离线索引存在不表示模型已经获得知识上下文。

### 工具调用上限

一次 SDK run 允许的最大真实函数工具调用次数。它与检索候选数量、Temporal retry 和 SDK
`maxTurns` 分开计算。

## 索引与检索制品

### 阶段定义

Docs/Notice builder 分别维护各自的 Chunk Definition；统一 publisher 与 embedding runtime 维护共享的
`EMBEDDING_SPACE`，并由 `COLLECTION_DEFINITION` 固定 Qdrant dense/sparse 向量名、查询指令、距离和
point schema。provider、endpoint、API key、model alias、批大小和并发数属于执行连接或调用参数，不进入
内容寻址 manifest。

这些定义由离线制品构建和发布实现拥有；在线查询只消费当前 collection 及其 point 合同，不从
PostgreSQL 或环境变量读取第二份定义。

### Collection 身份

统一 Publisher 使用显式 Docs Embedding Set ID、Notice Embedding Set ID 和当前
`COLLECTION_DEFINITION` 的规范 JSON SHA-256 形成 Qdrant collection 名：`campus_docs_<sha256>`。该
摘要只用作 collection 后缀，不另行生成索引制品，也不维护第二套运行时 index ID、fingerprint 或数据库
历史记录。

### Chunk Set

`campus_docs_chunk_set.v2` manifest 与 `chunks.ndjson` 组成的内容寻址制品。manifest 记录当前文档
投影摘要、分块定义、Chunk 数据引用和数量；完整 `source.json` 摘要不参与身份。Chunk Set 是
Embedding 的显式输入，并由 Embedding Set 传递给 Publisher，不是当前指针。

### Embedding Set

`campus_docs_embedding_set.v3` 或 `notice_embedding_set.v1` manifest 与 `embeddings.ndjson` 组成的内容
寻址制品。manifest 分别记录 Docs Chunk Set 或 Notice Chunk Run、Model Target hash、向量数量、数据
引用及 `spaceId`/dimensions；每条记录以 `retrievalTextSha256` 标识唯一检索文本向量。各 Embedding Job
只能从操作者显式指定的同空间旧 Embedding Set 复用，不扫描 bucket 或 Qdrant。

### Section 与 Chunk

Docs section 由 reader heading 路径或标题前正文形成，并绑定文档、版本和可选 `anchor`。Notice section
由 Notice heading path 形成。两者的 chunk 都是离线 evidence 单元，不是公开 URL 或独立来源对象。

### Point

写入 Qdrant 的离线检索单元。point 使用按 source namespace 隔离的确定性 UUID，并保存统一
`campus_rag_point.v1` payload、`dense` 与 `sparse` named vector。Docs point 的 `source_kind` 为
`document`，携带文档/版本/section/root units；Notice point 的 `source_kind` 为 `notice`，携带
`notice_id`、`chunk_index`、标题、heading path 和 `/notices/<noticeId>` citation。UI 将 Notice source kind
映射为 `campus_notice`。

## 发布与激活

### 当前索引绑定

PostgreSQL `campus_docs_serving.current_index` 的单行记录，只保存当前 collection 名；该表名沿用历史
schema 命名。唯一写入者是 `jobs/campus-rag-index-publisher`，而不是 Docs 或 Notice builder。execution-control
不在在线 run 准入时读取它；`campus_search` 执行时读取当前绑定。数据库不保存索引历史、查询定义或
重复的不可变索引记录。

### 索引发布

统一 Publisher 读取显式 Docs/Notice Embedding Set，从各自 manifest 解析 Chunk Set/Chunk Run，构建包含
两类 point 的完整新 Qdrant collection，验证后原子替换当前 collection 指针。它不读取 reader、不连接
Notices DB、不调用 embedding provider，也不写入额外的索引制品。Docs 或 Notice 更新不会原地改写旧
collection；旧 collection 也不会在切换后立即删除。

Embedding Job 在新旧制品的 `spaceId`、dimensions 和 `retrievalTextSha256` 一致时，按显式旧 Embedding
Set 复用 dense vector，只为新检索文本调用 provider。统一 Publisher 不重新 embedding：始终从两个 Chunk
制品完整生成 payload 与 sparse vector。Qdrant 不承担 embedding 缓存职责。

## 常见混淆

- `source.json` 是 Docs 控制清单，不是检索正文；Notice Chunk Run 也不是 live Notice DB；
- 文档集合和 Notice 集合不等于在线路由范围或物理 collection；
- 文档静态交付与检索索引发布共享输入，但拥有独立产物和激活过程；
- 两套离线 Embedding Set 在统一 Publisher 中组装为一个当前 serving collection；Publisher 不重新 embedding；
- publisher、schema 或配置存在不代表某个环境已经激活当前索引；
- 通知采集产物必须先经过 notice-publisher 和 Notice builder，才可作为显式 Notice Embedding Set 输入；
- Langfuse 中存在 trace 不代表 Temporal workflow 已经成功结束。
