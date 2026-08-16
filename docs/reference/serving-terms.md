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

## Agent 与检索

### 模型可见工具

当前运行中通过 `tools.v6.json` 和本轮授权向 Primary Agent 暴露的函数工具。Campus Docs 检索不是模型工具。

### Campus Docs Retrieval Admission

execution-control 在 workflow 创建前为每个有效请求冻结的检索输入，包含当前 collection 的查询绑定、
查询 hash 和 embedding 配置 hash。它不表达“是否检索”，也不选择文档类别、collection 或版本。

### Campus Docs Retrieval Result

`CampusDocsRetrievalResult` 是 `RetrieveCampusDocsEvidenceActivity` 的有界结果，只包含 evidence
数组。空数组表示没有选出证据，非空数组表示有可引用证据；不另设 mode 或 status。完整正文进入
Temporal history，普通投影只携带 hash、collection、计数和阶段耗时。

### Evidence 引用

`evidence://` 标识本轮 Campus Docs 检索结果中的一条已验证依据。Primary Agent 只能引用传入的
`campus_docs_evidence` 中出现的标识；Finalization 用 workflow 独立传入的检索结果校验并派生公开来源。

### 工具调用上限

一次 SDK run 允许的最大真实函数工具调用次数。它与检索候选数量、Temporal retry 和 SDK
`maxTurns` 分开计算。

## 索引与检索

### 索引定义

publisher 代码内的 `INDEX_DEFINITION` 固定 reader 分块、embedding space ID/dimensions、查询指令
和本地 sparse 向量身份，并包含 point schema。provider、endpoint、API key 和 model alias 属于连接
属性，不参与索引身份。改变索引定义中的任一项都会生成新的 collection。

### Collection 身份

Qdrant collection 名由 `campus_docs_index.v1` manifest 的规范 JSON SHA-256 形成：
`campus_docs_<manifest-sha256>`。manifest 显式引用 chunk set、embedding set、索引定义、point 数和当前
文档投影摘要。manifest 摘要同时是对象存储制品 ID 和 collection 后缀，不再维护第二套运行时 index
ID、fingerprint 或数据库历史记录。

### Chunk Set

`campus_docs_chunk_set.v1` manifest 与 `chunks.ndjson` 组成的内容寻址制品。它记录来源对象、当前文档
投影摘要、分块定义和数量，是 Embedding 与 Publisher 的显式输入；它不是当前指针。

### Embedding Set

`campus_docs_embedding_set.v1` manifest 与 `embeddings.ndjson` 组成的内容寻址制品。每条记录以
`retrievalTextSha256` 标识唯一检索文本向量。Embedding Job 只能从操作者显式指定的旧 embedding set
复用，不扫描 bucket 或 Qdrant。

### Section 与 Chunk

section 由 reader heading 路径或标题前正文形成，并绑定文档、版本和可选 `anchor`。chunk 在同一
section 内按 reader 正文元素或表格逻辑行形成，记录覆盖的全部 `root_unit_ids`；它不是公开 URL 或
独立来源对象。

### Point

写入 Qdrant 的检索单元。point 使用确定性 UUID，payload 只包含 schema、chunk、document、section、
版本 ID/slug/label、`root_unit_ids`、正文、正文 SHA-256 和检索文本 SHA-256，并同时保存 `dense` 与
`sparse` named vector。检索文本由文档标题、完整 heading 路径和正文组成；公开 evidence 只使用正文。

### 候选结果

Qdrant 返回且带查询分数、尚未经过 payload 校验、chunk 去重和总预算裁剪的内部 point。混合查询的
分数来自 RRF，dense-only 查询使用向量相似度；候选不会自动成为答案依据，有效候选保持分数顺序，
不按 section 重新排序。

### 混合检索

在冻结的物理 collection 中分别使用 dense query vector 和 `fnv1a_log_tf.v1` sparse query vector，
由 Qdrant 以 RRF 融合。合法问题无法生成 sparse token 时直接执行 dense 查询。两种模式的查询分数
都只用于排序，不是答案置信度或充分性证明。当前 JSON evidence 字段不暴露该分数，也没有外部
reranker。

## 发布与激活

### 当前索引绑定

PostgreSQL `campus_docs_serving.current_index` 的单行记录，保存当前 collection 及实际查询所需的
dense、embedding 和 sparse 绑定。execution-control 在 run 准入时读取并冻结它，运行中不跟随后续
变化。数据库不保存索引历史或重复的不可变索引记录。

### 索引发布

Publisher 读取显式 chunk set 和 embedding set，生成 index manifest 并构建完整新 Qdrant collection，
验证后原子替换当前索引绑定。它不读取 reader 或调用 embedding provider。文档更新不会原地改写旧
collection；旧 collection 也不会在切换后立即删除。

Embedding Job 在新旧制品的 `embedding_space_id` 和 dimensions 一致时，按
`retrievalTextSha256` 复用显式旧 embedding set 的 dense vector，只为新检索文本调用 provider。
Publisher 始终从 chunk set 完整生成 payload 与 sparse vector。Qdrant 不承担 embedding 缓存职责。

## 常见混淆

- `source.json` 是控制清单，不是检索正文；
- 文档集合不等于在线路由范围或物理 collection；
- 文档静态交付与检索索引发布共享输入，但拥有独立产物和激活过程；
- Campus Docs 检索不属于工具轨迹；
- publisher、schema 或配置存在不代表某个环境已经激活当前索引；
- 通知采集产物不属于当前 Campus Docs 索引输入；
- Langfuse 中存在 trace 不代表 Temporal workflow 已经成功结束。
