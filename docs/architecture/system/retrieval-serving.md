---
doc_type: architecture
owner_boundary: retrieval-serving
status: active
---

# 检索服务

## 边界

本文定义 Campus Web 当前文档和已发布 Notices 如何形成统一的不可变 Campus RAG serving index，
以及发布器如何验证和激活索引。它不负责来源采集、文档清洗、Campus Web 页面构建、在线答案生成或
个人记忆。

发布链把纳入范围的文档和已发布通知写入同一个不可变 Qdrant collection，不按来源类型拆分物理
collection。在线 Agent 不直接选择 collection、索引版本或查询配置；`campus_search` handler 在工具
调用时读取当前绑定并执行固定查询。

## 输入与索引身份

对象存储固定键 `campus-docs/source.json` 保存规范化的 `campus_docs_source.v4` 完整当前文档集合。
Campus Web 静态构建和 Docs Chunk/Embedding builder 共享这份清洗后输入，但分别产生静态站候选和
RAG 制品，不共享发布状态。Notice builder 从 `notice-publisher` 已发布正文的 repeatable-read 快照
生成自己的 Chunk Run 与 Embedding Set；统一 publisher 不连接 Notices 数据库。

Docs serving 输入是清单中每份文档的当前 `campus_docs_reader.v3`。reader 引用由 `key`、`byteSize` 和
`sha256` 固定；历史版本 reader、校历和其他补充资产不进入当前 Docs 索引。Notice serving 输入是显式
`notice_chunk_run.v2` 与 `notice_embedding_set.v1`。Chunk 记录保留来源通知的 RFC3339 UTC `released_at`；统一 publisher 只读取 serving 所需的 Chunk 数据和
Embedding 数据，不自动发现 bucket 中的对象；title 从 `retrievalText` 首行生成，citation 由
`noticeId` 固定为 `/notices/<noticeId>`。

Docs 和 Notice 的 Chunk/Embedding 制品都使用内容寻址身份。`campus_docs_chunk_set.v2` 只把当前文档
投影摘要、分块定义和实际 Chunk 数据纳入身份，完整 `source.json` 摘要只作为诊断输出。物理 collection
名由两个显式 Embedding Set ID 与当前 Collection Definition 的规范 JSON 摘要形成：

```text
campus_docs_<sha256>
```

代码分别以各 builder 的 Chunk Definition、共享 `EMBEDDING_SPACE` 和 `COLLECTION_DEFINITION` 固定
reader/分块、space/dimensions，以及 Qdrant point、dense/sparse 向量和查询定义。provider、Base URL、
API key、provider-specific model alias 与调用参数不进入内容寻址 manifest。Docs point 的 `source_kind`
为 `document`，Notice point 的 `source_kind` 为 `notice`；在线 UI 将后者映射为 `campus_notice`。

## 分块定义

Docs 当前 `campus_docs_reader_elements.v5` 使用 Unicode 字符数，不依赖模型 tokenizer：软目标为 800
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

Notice 使用独立的 `notice_text_structure.v8` 分块定义（软目标 800、硬上限 1200、无 overlap）。其
`retrievalText` 由通知标题、heading path 和正文构成。统一 publisher 使用 Chunk 的 `retrievalText` 首行
生成 title，并由 `noticeId` 生成 citation；`released_at` 只作为通知发布时间证据，不参与 embedding、适用期推断或
通知过滤。builder 的 review 和 validation 文件只用于离线诊断，不进入 serving 读取路径。

## Chunk 策略治理

Chunk 策略治理与生产分块实现同属 `campus-docs-index-publisher`。它读取显式 Chunk Set，提供结构
审阅、人工标签、真实 Embedding 评测及同题集比较；结果不自动改写生产分块定义、制品或当前绑定。
候选信号用于定位人工审阅对象，不是自动拆分或合并规则；评价须结合结构、抽样与 evidence placement，
不能只看短块数量。

该能力属于本地人工/研究验证，不是 PR 阻断检查，也不等于在线 hybrid 与 reranker 的最终效果。
[操作手册](../../runbooks/ingestion/campus-docs.md#chunk-策略治理验证)维护输入、命令、比较条件与结果解释，
本地正文和向量制品留在 worktree 的 `var/`，不提交 Git。Notice 的独立操作由
[Notice builder](../../../jobs/notice-index-publisher/README.md)维护，v8 的历史选择与验证范围见
[通知结构分块决策](../../../.agents/notes/implemented/architecture/2026-08-31-notice-chunk-strategy.md)。

## 构建与发布

索引流程由 Docs、Notice 各自的 Chunk/Embedding builder 和一个统一 Publisher 承载；所有 Kubernetes
Job 模板保持暂停，并由操作者分别触发：

```text
Docs Chunk Job: source.json + 当前 reader
  -> Docs Chunk Set
Docs Embedding Job: Docs Chunk Set + Model Config 完整配置
  -> Docs Embedding Set
Notice Chunk Job: 已发布 Notice 快照
  -> Notice Chunk Run v2
Notice Embedding Job: Notice Chunk Run + Model Config 完整配置
  -> Notice Embedding Set
Unified Publisher Job: Docs Embedding Set + Notice Embedding Set
  -> 不可变 Qdrant collection
  -> 原子替换 campus_docs_serving.current_index
```

本地分块和评测与正式 Job 复用领域实现，使用各自的 Store 与连接组装。
本地 Docs Chunk/Embedding 与 Notice Chunk/评测写入 worktree `var/`；正式 builder 写入 derived bucket。
Notice Embedding Set 从对象存储中的 Chunk Run 构建，不直接消费本地评测目录。Chunk 构建在写入前校验
来源覆盖、section、root unit、`retrievalText`、字符上限和表格单元格覆盖。所有阶段输出都按实际内容
寻址，本地制品不自动晋升；Notice Embedding cache 的显式校验导入见
[通知制品手册](../../runbooks/ingestion/notice-indexing.md#导入本地-embedding-cache)。

阶段之间只传递显式 `sha256:<id>`。`notice-pipeline-worker` 在独立 Temporal 队列串联 Notice 构建和统一发布，
沿用当前 Docs Embedding Set；手动维护仍可显式执行各阶段，不维护 `latest` 制品指针。manifest 和
NDJSON 使用规范序列化、最终换行和内容寻址对象键，不可变写入采用 create-or-verify。两个 Embedding
Job 都从 Model Config 读取一次当前 Embedding 连接；在同空间、同 dimensions 且 retrieval text 未变时，
可从操作者显式指定的旧 Embedding Set 复用向量，但不扫描 bucket，也不把 Qdrant 当作复用缓存。统一
Publisher 不重新 embedding：只读取两个 Embedding Set，从 manifest 解析各自 Chunk 制品，组装 Docs/Notice
points 和 sparse vectors。

Publisher 在激活前完整核对 collection 配置、point 数、point 身份、payload 和向量。只有验证成功才替换
PostgreSQL `campus_docs_serving.current_index` 的单一当前绑定；组装或 Qdrant 校验失败不改变现有绑定。

目标 collection 已存在时只做完整校验，内容不匹配不会删除；本次新建 collection 在写入或校验失败时
删除。数据库激活失败时保留已验证 collection，以便使用相同制品重跑。

`current_index` 的逻辑 owner 是统一 Campus RAG serving；唯一的 current pointer writer 是
`jobs/campus-rag-index-publisher`。`campus_docs_serving` 是沿用的 schema/table 名，不表示 Docs builder
仍拥有发布职责。Publisher 当前复用 `execution_control` 数据库身份完成读取和激活；该身份是部署层共享
的技术 writer，不是 execution-control 在线服务的逻辑写入职责。数据库 ACL 因此授予该身份
`SELECT`、`INSERT`、`UPDATE`，并拒绝 `DELETE`、`TRUNCATE`、`REFERENCES` 和 `TRIGGER`。

源码包含 Job、schema、制品或 collection 只能证明发布链可执行，不能证明任一环境已经运行这些 Job
或激活当前索引。操作步骤和清理条件见 [Campus Docs 与 Notices 维护及统一 RAG 发布](../../runbooks/ingestion/campus-docs.md)。

## 在线消费边界

`campus_docs_serving.current_index` 是统一 Publisher 维护的单一当前绑定，不是当前在线 Agent 的准入输入。
`campus_search` 被 Primary Agent 按需调用后，execution-control 从同一个 execution-control 数据库读取
该绑定，从 Model Config 读取 `campus_docs_embedding` 和 `campus_docs_reranker` 连接，向对应 collection 发起 dense/sparse hybrid
查询。工具不接受客户端或模型传入 collection、provider、vector name、top-k 或版本字段。

在线 execution-control 只读取 `current_index`；它不执行 publisher 的激活流程。由于两条路径当前共享
`execution_control` 技术身份，数据库权限不能单独表达这一进程级区分，代码行为和 ACL 需要分别验证。

当前查询先根据问题中的版本意图生成检索范围：默认只允许 Docs 的当前版本；培养方案可按入学年份选择适用版本；明确历史或版本问题只有在索引中存在对应版本时才可能命中。对通知问题，`今年`、`去年`、`前年` 会基于同一 run 冻结的创建日期归一化为具体年份，并把同一结果用于召回和 rerank；其他相对时间不作推断。该范围作为 Qdrant payload filter 同时应用到 dense/sparse hybrid RRF 的两个 prefetch。随后最多取得 24 个候选，再使用当前 `campus_docs_reranker`
连接调用固定的 rerank 模型对候选排序，只保留 `relevance_score >= 0.5` 的候选。数量和字符预算前
排除本轮已返回的 `result_ref`；同一通知的不同片段仍可返回，不按通知来源折叠互补章节，
也不按通知发布时间自动排除旧通知。结果中的 `released_at` 只能证明通知发布时间，不能证明截止日期、适用年度、学期、申请窗口或当前有效性；正文没有适用信息时，答案必须说明无法确认。版本过滤不改变 Notices 的已发布通知范围。最终返回
每次最多 5 条候选结果，正文总字符预算为 4000。execution-control 校验 point schema、文本 hash、section
URL、版本字段和 `root_unit_ids` 后才把结果交给 Agent。reranker 响应的 index 必须覆盖候选且唯一，
score 必须是有限数值；调用或校验失败直接使检索失败，不回退到未重排候选。过滤后无结果返回成功的
`no_match`。该阈值只判断查询与候选文本的相关性，不判断学校、人群或规则适用主体。
当前 collection 包含纳入候选的中央民族大学 Campus Web 文档和已发布 Notices；point 的 `source_kind`
和 citation 由统一 publisher 固定，UI 将 Notice 结果映射为 `campus_notice`。Primary Agent 根据问题
所需事实与工具声明范围决定是否检索，不通过实体名称特判、Qdrant filter、rerank 阈值或 collection 字段
实现路由。

同一 run 的 `campus_search` 结果使用全局递增的 `citation_index`，失败和 `no_match` 不占编号。
后续调用排除本轮已经返回的 `result_ref`，但保留同一通知的互补章节；Finalization 保留编号映射，
按正文引用将相同稳定来源的相同段落合并为一份来源卡。
Agent 正文只引用实际采用的候选；当前 Campus Docs 来源由 `campus_search` adapter 校验。Finalization
拒绝未知、零或越界编号，忽略未引用候选，并从有效引用派生公开 source cards。检索失败不会回退到
其他数据源，也不会改变当前索引绑定。

## 相关文档

- [Agent 的机构知识边界](./agentic-retrieval.md)
- [文档站架构](./document-site.md)
- [文档阅读器数据模型](../../data/document-reader.md)
- [Campus Docs 与 Notices 维护及统一 RAG 发布](../../runbooks/ingestion/campus-docs.md)
- [Qdrant 托管方式](../../../.agents/notes/implemented/architecture/2026-07-16-qdrant-hosting.md)
- [Artifact 身份的规范排序](../../../.agents/notes/implemented/architecture/2026-09-26-canonical-artifact-ordering.md)

## 自动通知索引生命周期

Ops `/tasks` 直接管理 `notice-pipeline` Schedule，默认暂停、周期 15 分钟、可调整为 30 或 60 分钟，重叠 SKIP。
Schedule 入口启动固定 ID `notice-pipeline-workflow` 的刷新子工作流；手动刷新与回滚使用同一
执行 ID，运行中冲突由 Temporal 原子拒绝。Schedule action 自身的时间戳 ID 不承担互斥。
工作流保持制品引用和计数，活动复用 builder 与唯一 publisher；每次读取已发布通知快照。
Chunk Run 未变化时跳过 embedding 和激活，仍执行清理。

`campus_docs_serving.index_versions` 登记真实制品引用、生产者、验证与激活/退休时间。
候选先登记再创建 collection；未验证且从未激活的中断候选可在 publisher 锁下重建。
激活检查预期当前值，重复确认已激活版本不移动 previous。保留当前与上一版本，自动版本退休至少
一小时后清理；无引用自动产物与未完成产物按所有权和活动工作流保护，后者额外保留 24 小时。
共享缓存、来源和未认领手动制品不自动删除。清理错误不撤销索引切换。

回滚先读取已验证的上一版本，无目标时返回 409；有目标时暂停调度，将制品引用与预期当前值固定为
Workflow 输入，再以同一 publisher 激活。活动刷新冲突返回 409 并保持暂停，结束后可重新请求；
回滚重试不会重新选择上一版本。Ops 运行记录按 Run ID 区分，详情不受最近运行列表条数限制。
