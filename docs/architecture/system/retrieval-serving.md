---
doc_type: architecture
owner_boundary: retrieval-serving
status: active
---

# 检索服务

## 边界

本文定义 Campus Web 当前文档如何形成不可变 Campus Docs 索引，以及 execution-control 如何准入、
查询和交付本轮 evidence。它不负责来源采集、文档清洗、Campus Web 页面构建、答案生成、个人记忆或
通知检索。

当前链路把所有获准文档发布到一个不可变 Qdrant collection，不按领域 scope 拆分，也不让浏览器或
模型选择 collection、索引版本或查询配置。

## 输入与索引身份

对象存储固定键 `campus-docs/source.json` 保存规范化的 `campus_docs_source.v3` 完整当前集合。
Campus Web 静态构建和 Campus Docs 索引发布共享这份清洗后输入，但分别产生静态站候选和 RAG 制品，
不共享发布状态。

索引发布只读取清单中每份文档的当前 `campus_docs_reader.v3`。reader 引用由 `key`、`byteSize` 和
`sha256` 固定；历史版本 reader、通知、校历和其他补充资产不进入当前索引。bucket 中存在但未被当前
清单引用的对象不会被自动发现。

Chunk、Embedding 和 Index manifest 都使用内容寻址身份。`campus_docs_chunk_set.v2` 只把当前文档
投影摘要、分块定义和实际 Chunk 数据纳入身份，完整 `source.json` 摘要只作为诊断输出。Index manifest
摘要同时形成物理 collection 名：

```text
campus_docs_<index-manifest-sha256>
```

publisher 的索引定义固定 reader/point schema、分块算法、dense 与 sparse 向量名、Embedding space、
dimensions、查询指令和 sparse 算法。provider、Base URL、API key 和 provider-specific model alias
是连接属性，不进入索引身份。

## 分块定义

当前 `campus_docs_reader_elements.v4` 使用 Unicode 字符数，不依赖模型 tokenizer：软目标为 800
字符，单个 Chunk 硬上限为 1600 字符，不做通用重叠。

- heading 只维护按 level 收敛的标题路径，不进入 evidence 正文，也不单独生成 point；标题前正文作为
  preamble 使用当前版本固定链接；
- paragraph、list 和 blockquote 保持 reader 元素完整并按原顺序合并；超长元素优先在空行、列表项、
  句末和子句边界切分，没有可用边界时才在硬上限切分；
- table 保持逻辑行和多级列路径，会携带紧邻且高置信相关的有界正文上下文。上下文最多 400 字，表格
  拆成多个 Chunk 时重复该上下文和列名，不附着无关相邻段落；
- `root_unit_ids` 按正文元素首次出现顺序去重，覆盖 evidence 实际包含的全部 reader 根单元。

字符硬上限之外仍保留 16000 UTF-8 byte 传输限制。dense embedding 和 sparse vector 使用由文档
标题、完整 heading 路径和 evidence 正文组成的 `retrieval_text`；point 分别保存正文和检索文本摘要。

## 构建与发布

索引流程由三个保持暂停的 Kubernetes Job 模板承载，并由操作者分别触发：

```text
Chunk Job: source.json + 当前 reader
  -> 显式 chunk set
Embedding Job: 显式 chunk set + 一次性 Embedding provider snapshot
  -> 显式 embedding set
Publisher Job: 显式 chunk set + embedding set
  -> index manifest -> 不可变 Qdrant collection
  -> 原子替换 campus_docs_serving.current_index
```

本地 Chunk CLI 和集群 Chunk Job 共用同一个命令输出合同与领域实现，只替换制品 Store：本地只读对象
存储来源并写入 worktree `var/`，集群写入 derived bucket。相同有效来源必须生成相同 Chunk Set ID；
本地制品不上传或晋升。只读 `eval-chunks` 是独立本地评测入口，不进入集群镜像。

阶段之间只传递显式 `sha256:<id>`，不自动串联，不维护 `latest` 制品指针或构建状态机。manifest 和
NDJSON 使用规范序列化、最终换行和内容寻址对象键，不可变写入采用 create-or-verify。Embedding Job
从 execution-control 读取一次当前 Embedding 连接；它可以从操作者显式指定的旧 embedding set 按
`embedding_space_id + retrievalTextSha256` 复用向量，但不扫描 bucket，也不把 Qdrant 当作复用缓存。
Publisher 不读取 reader，也不调用 provider。

Publisher 在激活前完整核对 collection 配置、point 数、point 身份、payload 和向量，并在末次写入前
重新确认当前文档投影未变化。只有验证成功才替换 PostgreSQL
`campus_docs_serving.current_index` 的单一当前绑定；构建失败不改变现有绑定。

源码包含 Job、schema、制品或 collection 只能证明发布链可执行，不能证明任一环境已经运行这些 Job
或激活当前索引。操作步骤和清理条件见 `../../runbooks/campus-docs.md`。

## 运行准入

execution-control 在创建 workflow 前读取并冻结：

- `campus_docs_serving.current_index` 中的物理 collection、dense/sparse 向量名、Embedding
  dimensions、space、查询指令和 sparse 算法；
- 当前 Embedding 设置 hash；
- 本轮规范化查询的 SHA-256；
- 其余 Agent 运行限制和获准能力。

dimensions 和 space 属于已准入索引，不属于可编辑 Provider Config。Embedding 设置只保存连接；
在线 Activity 按冻结 hash 解析该连接并以索引 dimensions 请求、校验查询向量。缺少当前索引、设置
无效、hash 不一致或索引绑定不兼容时拒绝准入，不回退到旧 collection、旧配置或模型记忆。

准入快照不含凭据、文档正文或 provider 响应。整个 run 使用同一快照，不跟随后续索引发布或模型
设置变化。

## 查询与 evidence

`RetrieveCampusDocsEvidenceActivity` 在 Primary Agent Activity 前执行一次：

```text
冻结问题
-> 按 admitted query instruction 生成一次 dense embedding
-> 本地生成 sparse query vector
-> 查询唯一 admitted collection，并由 Qdrant 对 dense+sparse 候选做 RRF fusion
-> 校验 point schema、公开版本链接和正文 hash
-> 去重、排序并按数量与 Unicode 字符预算裁剪
-> 返回本轮 campus_docs_evidence
```

Qdrant point 保存 Agent 和来源卡片需要的 evidence 正文、文档/版本/section 身份及引用元数据；在线
查询不回 PostgreSQL 或对象存储读取正文。Qdrant 分数只用于候选排序和预算选择，不是答案正确性或
置信度证明。当前没有外部 reranker、远程查询改写、模型 scope 路由或迭代检索。

完整 evidence 作为有界 Activity result 经 Temporal history 传给 Agent 和 Finalization。Agent Runtime
只获得 `campus_docs_evidence` 与独立的 `conversation_context`，生成的 terminal envelope 只返回实际
使用的 `evidence://` 引用，不复制检索正文。Finalization 使用原始 Activity result 校验引用并生成
公开来源，防止跨 run 或伪造引用；普通运行投影和产品响应只保存有界摘要、计数、hash 与公开来源。

检索失败会使当前执行失败关闭，不返回部分依赖结果，也不形成隐藏 fallback。没有选出 evidence 时
仍可回答不依赖机构文档的普通问题；机构事实主张必须由本轮 evidence 支持。

## 当前限制

- 只查询 `campus_docs_serving.current_index` 指向的当前不可变 collection，不提供历史索引查询；
- Campus Docs 检索不是模型工具，不进入 SDK 工具轨迹；
- 通知、校历、Dining 和实时网页搜索不属于当前索引；
- 任务、schema、制品和发布模板存在不表示环境已经激活该能力。

## 相关文档

- `agentic-retrieval.md`
- `document-site.md`
- `../../data/document-reader.md`
- `../../runbooks/campus-docs.md`
- `../../decisions/adr-0007-retrieval-strategy.md`
- `../../decisions/adr-0052-qdrant-hosting.md`
