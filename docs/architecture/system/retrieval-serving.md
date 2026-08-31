---
doc_type: architecture
owner_boundary: retrieval-serving
status: active
---

# 检索服务

## 边界

本文定义 Campus Web 当前文档如何形成不可变 Campus Docs 索引，以及发布器如何验证和激活索引。
它不负责来源采集、文档清洗、Campus Web 页面构建、在线答案生成、个人记忆或通知检索。

发布链把所有纳入清单的文档写入不可变 Qdrant collection，不按领域 scope 拆分。在线 Agent 不直接
选择 collection、索引版本或查询配置；`campus_search` handler 在工具调用时读取当前绑定并执行
固定查询。

## 输入与索引身份

对象存储固定键 `campus-docs/source.json` 保存规范化的 `campus_docs_source.v3` 完整当前集合。
Campus Web 静态构建和 Campus Docs 索引发布共享这份清洗后输入，但分别产生静态站候选和 RAG 制品，
不共享发布状态。

索引发布只读取清单中每份文档的当前 `campus_docs_reader.v3`。reader 引用由 `key`、`byteSize` 和
`sha256` 固定；历史版本 reader、通知、校历和其他补充资产不进入当前索引。bucket 中存在但未被当前
清单引用的对象不会被自动发现。

Chunk Set 和 Embedding Set 使用内容寻址身份。`campus_docs_chunk_set.v2` 只把当前文档投影摘要、
分块定义和实际 Chunk 数据纳入身份，完整 `source.json` 摘要只作为诊断输出。物理 collection 名由
显式 Embedding Set ID 与当前 Collection Definition 的规范 JSON 摘要形成：

```text
campus_docs_<sha256>
```

代码分别以 `CHUNK_SET_DEFINITION`、`EMBEDDING_SPACE` 和 `COLLECTION_DEFINITION` 固定 reader/分块、
space/dimensions，以及 Qdrant point、dense/sparse 向量和查询定义。provider、Base URL、API key、
provider-specific model alias 与调用参数不进入内容寻址 manifest。

## 分块定义

当前 `campus_docs_reader_elements.v5` 使用 Unicode 字符数，不依赖模型 tokenizer：软目标为 800
字符，单个 Chunk 硬上限为 1600 字符，不做通用重叠。

- heading 只维护按 level 收敛的标题路径，不进入 evidence 正文，也不单独生成 point；标题前正文作为
  preamble 使用当前版本固定链接；
- paragraph、list 和 blockquote 保持 reader 元素完整并按原顺序合并；超长元素优先在空行、列表项、
  句末和子句边界切分，没有可用边界时才在硬上限切分；
- 同一 section 的相邻 Chunk 任一侧短于 200 字且合并后不超过 1600 字时回并；不跨 heading、section、
  table 或独立短段落“<专业名>专业毕业要求：”硬边界，普通冒号结尾段落不形成硬边界；
- 独立的 `> Source URL: https://...` 段落不进入 evidence；文档开头连续审批/修订日期和文号附着到
  同一 preamble 的首个正文 Chunk，后续直接进入 heading 时不跨 section 附着；
- table 保持逻辑行和多级列路径，会携带紧邻且高置信相关的有界正文上下文。上下文最多 400 字，表格
  拆成多个 Chunk 时重复该上下文和列名，不附着无关相邻段落；
- `root_unit_ids` 按正文元素首次出现顺序去重，覆盖 evidence 实际包含的全部 reader 根单元。

字符硬上限之外仍保留 16000 UTF-8 byte 传输限制。dense embedding 和 sparse vector 使用由文档
标题、完整 heading 路径和 evidence 正文组成的 `retrieval_text`；point 分别保存正文和检索文本摘要。

## Chunk 策略治理

Chunk 策略治理与生产分块实现同属 `campus-docs-index-publisher`，但治理只读取显式 Chunk Set，不修改
`campus_docs_reader_elements.v5`、Embedding Set、Qdrant collection 或当前在线绑定。review 对完整
Chunk Set 生成全量 census、150 份文档的确定性覆盖样本、候选信号和 450 个 Chunk 级审阅项。Chunk
审阅项包含正文、heading 路径、reader root units、前后边界和全部候选信号；关联既有 embedding
evaluation 时还全量纳入 evidence Chunk 及其 question/rank。普通分层执行每文档上限，元数据、near-max
和 embedding evidence 为避免漏检而全量进入。候选信号只定位人工审阅对象，不是自动改写 Chunk 的
规则。

人工标签只表达 `keep` 或带 `drop`、`attach`、`merge`、`split`、`upstream-reader` action 的
`change`。标签汇总按 primary stratum 和 candidate signal 报告 change rate，但不会据此生成候选 Chunk
Set；对照组用于估计候选信号之外的 Reader/Chunker 问题率。

真实 embedding 评测使用固定问题文件、Chunk 的 `retrieval_text` 和当前 canonical dense embedding
定义，分别报告 target Chunk、全部 evidence、文档和 single-chunk answer 的排名指标。比较 baseline
与 candidate 时，评测必须分别引用对应 Chunk Set，并使用相同模型 target、问题文件摘要、embedding
定义和问题顺序；来源投影不同时不比较 evidence placement。逐文本 embedding 缓存和所有治理制品只
保存在 worktree 的 `var/campus-docs/chunk-governance/`，不进入 Git 或生产制品 Store。

该能力属于本地人工/研究验证，不是 PR 阻断检查，也不等价于在线 dense/sparse hybrid 加 reranker 的
最终效果。治理结果不会自动生成、发布或激活新的生产 Chunk Set；是否调整生产定义需综合结构 census、
广泛抽样、evidence placement 和真实 embedding 对比后另行决定。

## 构建与发布

索引流程由三个保持暂停的 Kubernetes Job 模板承载，并由操作者分别触发：

```text
Chunk Job: source.json + 当前 reader
  -> 显式 chunk set
Embedding Job: 显式 chunk set + Model Config 完整配置
  -> 显式 embedding set
Publisher Job: 显式 embedding set -> manifest 中的 chunk set
  -> 不可变 Qdrant collection
  -> 原子替换 campus_docs_serving.current_index
```

本地 Chunk/Embedding CLI 与对应集群 Job 共用领域实现，只替换制品 Store 和 Embedding 连接组装。本地
Chunk CLI 只读对象存储来源，本地 Embedding CLI 直接调用显式 OpenAI-compatible endpoint，二者都写入
worktree `var/`；集群写入 derived bucket。Chunk 构建在写入前校验来源覆盖、section、root unit、
`retrievalText`、字符上限和表格单元格覆盖。所有阶段输出都按实际内容寻址，本地制品不上传或晋升。

阶段之间只传递显式 `sha256:<id>`，不自动串联，不维护 `latest` 制品指针或构建状态机。manifest 和
NDJSON 使用规范序列化、最终换行和内容寻址对象键，不可变写入采用 create-or-verify。Embedding Job
从 execution-control 读取一次当前 Embedding 连接；它可以从操作者显式指定的旧 embedding set 按
`spaceId + dimensions + retrievalTextSha256` 复用向量，但不扫描 bucket，也不把 Qdrant 当作复用缓存。
Embedding Set 不保存 provider、endpoint、model alias 或调用参数。Publisher 只接收 Embedding Set，
从 manifest 解析 Chunk Set；它不读取 reader，也不调用 provider。

Publisher 在激活前完整核对 collection 配置、point 数、point 身份、payload 和向量，并在末次写入前
重新确认当前文档投影未变化。只有验证成功才替换 PostgreSQL
`campus_docs_serving.current_index` 的单一当前绑定；构建失败不改变现有绑定。

源码包含 Job、schema、制品或 collection 只能证明发布链可执行，不能证明任一环境已经运行这些 Job
或激活当前索引。操作步骤和清理条件见 `../../runbooks/campus-docs.md`。

## 在线消费边界

`campus_docs_serving.current_index` 是发布器维护的单一当前绑定，不是当前在线 Agent 的准入输入。
`campus_search` 被 Primary Agent 按需调用后，execution-control 从同一个 execution-control 数据库读取
该绑定，从 Model Config 读取 `campus_docs_embedding` 和 `campus_docs_reranker` 连接，向对应 collection 发起 dense/sparse hybrid
查询。工具不接受客户端或模型传入 collection、provider、vector name、top-k 或版本字段。

当前查询先从 dense/sparse hybrid RRF 取得最多 24 个候选，再使用当前 `campus_docs_reranker`
连接调用固定的 rerank 模型对候选排序，只保留 `relevance_score >= 0.5` 的候选，最终返回
每次最多 5 条候选结果，正文总字符预算为 4000。execution-control 校验 point schema、文本 hash、section
URL、版本字段和 `root_unit_ids` 后才把结果交给 Agent。reranker 响应的 index 必须覆盖候选且唯一，
score 必须是有限数值；调用或校验失败直接使检索失败，不回退到未重排候选。过滤后无结果返回成功的
`no_match`。该阈值只判断查询与候选文本的相关性，不判断学校、人群或规则适用主体。
当前 collection 只包含中央民族大学 Campus Web 文档。Primary Agent 根据问题所需事实与工具声明范围
决定是否检索，不通过实体名称特判、Qdrant filter、rerank 阈值或 collection 字段实现路由。

同一 run 的 `campus_search` 结果使用全局 `citation_index` `1..10`，失败和 `no_match` 不占编号。
Agent 正文只引用实际采用的候选；当前 Campus Docs 来源由 `campus_search` adapter 校验。Finalization
拒绝未知、零或越界编号，忽略未引用候选，并从有效引用派生公开 source cards。检索失败不会回退到
其他数据源，也不会改变当前索引绑定。

## 相关文档

- `agentic-retrieval.md`
- `document-site.md`
- `../../data/document-reader.md`
- `../../runbooks/campus-docs.md`
- `../../decisions/adr-0052-qdrant-hosting.md`
