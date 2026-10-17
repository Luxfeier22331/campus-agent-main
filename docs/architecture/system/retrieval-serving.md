---
doc_type: architecture
owner_boundary: retrieval-serving
status: active
---

# 检索服务

## 边界

本文定义 Campus Web 当前文档和已发布 Notices 如何形成统一的 Campus RAG serving index，
以及发布器如何验证和激活索引。它不负责来源采集、文档清洗、Campus Web 页面构建、在线答案生成或
个人记忆。

发布链把纳入范围的文档和已发布通知写入固定 Qdrant collection `campus_rag`，不按来源类型拆分物理
collection。在线 Agent 不直接选择 collection、索引版本或查询配置；Campus Search service 在请求时读取当前
绑定并执行固定查询。`agent-runtime` 的工具 Activity 通过内部 HTTP 调用该服务，Runtime 按工具执行顺序分配 citation，
agent-control 保存并校验 run 的索引修订绑定。

## 输入与索引身份

对象存储固定键 `campus-docs/source.json` 保存规范化的 `campus_docs_source.v4` 完整当前文档集合。
Campus Web 静态构建和 Docs Chunk/Embedding builder 共享这份清洗后输入，但分别产生静态站候选和
RAG 制品，不共享发布状态。Notice builder 从 `notice-publisher` 已发布正文的 repeatable-read 快照
生成自己的 Chunk 数据与 Embedding Set；统一 publisher 不连接 Notices 数据库。

Docs serving 输入是清单中每份文档的当前 `campus_docs_reader.v3`。reader 引用由 `key`、`byteSize` 和
`sha256` 固定；历史版本 reader、校历和其他补充资产不进入当前 Docs 索引。Notice serving 输入是显式
`notice_embedding_set.v2` 及其直接引用的 chunks 对象；已有 v1 set 仍可读取。Chunk 记录保留来源通知的
RFC3339 UTC `releasedAt`；统一 publisher 只读取 serving 所需的 Chunk 数据和
Embedding 数据，不自动发现 bucket 中的对象；title 从 `retrievalText` 首行生成，citation 由
`noticeId` 固定为 `/notices/<noticeId>`。

Docs 和 Notice 的 Chunk/Embedding 制品都使用内容寻址身份。`campus_docs_chunk_set.v2` 只把当前文档
投影摘要、分块定义和实际 Chunk 数据纳入身份，完整 `source.json` 摘要只作为诊断输出。物理 collection 固定为 `campus_rag`；两份 Embedding Set 与 Collection Definition 的规范 JSON 摘要
形成独立 revision，保留 Agent run 的索引一致性判断。revision 不进入 point，不建立多版本存储。

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

Notice 使用独立的 `notice_text_structure.v10` 分块定义（软目标 800、硬上限 1200、无 overlap）；完整规则和
当前 schema 见[通知数据](../../data/notices.md#检索分块与制品)。其 `retrievalText` 由通知标题、heading path 和正文构成。
统一 publisher 使用 Chunk 的 `retrievalText` 首行生成 title，并由 `noticeId` 生成 citation；`released_at` 只作为通知发布时间
证据，不参与 embedding、适用期推断或通知过滤。生产 serving 直接读取内容寻址的 Chunk 数据对象，builder 的 review、
validation 和本地 `notice_chunk_run.v2` 只用于离线诊断和评测，不进入 serving 读取路径。

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

`jobs/retrieval-index` 的同一镜像提供 build、apply、cleanup 三个一次性命令，由运维显式触发。
通知 Temporal Worker 只负责采集、分类、正文发布，不再自动构建制品或刷新索引。

Build 读取 Docs 来源清单与逐篇 reader、Notice 已发布正文快照，复用各自分块算法并批量生成向量。
已有 Chunk/Embedding 制品格式及内容寻址规则保留；旧向量仅从显式指定的同模型 Embedding Set 复用。
NDJSON 流式读写，SQLite 工作区承载去重、关联、规范排序和 point 差异比较；生产流程不构造完整向量 Map
或完整 points 数组。工作区属于 Job，可删除，不是另一份持久化业务状态。

Apply 不读来源数据库、不调用 Embedding provider，只读取显式的 Docs 与 Notice Embedding Set。
每个 revision 对应一个不可变 collection `campus_docs_<revision>`。Apply 写入新 collection 并校验 point 数、
payload 与双向量，然后在一个事务中更新 `current_index`，再等待宽限期后删除上一个 collection。
Search 每个请求读取一次指针，不持锁；切换前后的请求分别读取完整的旧、新 collection，检索不中断。
失败发生在切换前时，旧 collection 继续服务，重跑同一组制品即可；相同输入不做写入。
Qdrant dense、sparse、HNSW 和 payload 使用磁盘配置，写入按数量和字节大小分批；切换期间短暂存在两份
collection。

`campus_docs_serving.current_index` 是唯一发布状态，保存 collection 与 Docs/Notice Embedding Set 引用，
collection 名由两者和 collection 定义推导。没有回滚入口；需要旧内容时用旧 Embedding Set 再次 Apply。

Cleanup 只删除显式指定的退休制品，并保护当前及其他保留 manifest 引用的对象；不重组 point、不清理共享
缓存或自动删除未完成构建。三个 Job 由 publisher advisory lock 互斥，由运维按需触发。

唯一发布写 owner 是 `retrieval-index`，复用 `agent_control` 数据库身份；Campus Search 使用独立只读
`campus_search` role。部署参数、执行顺序与失败处理见[操作手册](../../runbooks/ingestion/campus-docs.md#检索索引-job)。

## 在线消费边界

`campus_docs_serving.current_index` 是统一 Publisher 维护的单一当前绑定，不是当前在线 Agent 的准入输入。
`campus_search` 被 Solve/Executor 按需调用后，agent-runtime 工具 Activity 通过内部 Campus Search service 请求检索。
该 service 从 Campus Search 专属只读数据库连接读取绑定，从 Model Config 读取 `campus_docs_embedding` 和
`campus_docs_reranker` 连接，向对应 collection 发起 dense/sparse hybrid 查询。工具不接受客户端或模型传入
collection、provider、vector name、top-k 或版本字段。

在线 Campus Search service 只读取 `current_index`；它不执行 publisher 的激活流程。Publisher 的写权限与
Campus Search 的只读权限通过独立数据库 role 和 Secret 分离。

Runtime 收到合法搜索响应后，包括 `no_match` 响应，通过 `collection/bind` 将返回的
collection 交给 agent-control 保存到 run metadata，后续响应必须匹配该绑定，否则拒绝本次工具结果。搜索服务仍在每次调用时
读取当前索引；内部请求不携带已绑定 collection，也不会在发布切换后自动改查旧索引。因此运行中切换索引
可能导致后续检索被拒绝，而不是让同一回答混用两个 collection。该绑定不冻结 embedding 或 reranker 配置。
读取入口见[Search service](../../../apps/campus-search/internal/service/service.go)，绑定与拒绝逻辑见
[CampusSearchToolService](../../../apps/agent-runtime/src/domain-tools.ts)。

当前查询先根据问题中的版本意图生成检索范围：默认只允许 Docs 的当前版本；培养方案可按入学年份选择适用版本；明确历史或版本问题只有在索引中存在对应版本时才可能命中。对通知问题，`今年`、`去年`、`前年` 会基于同一 run 冻结的创建日期归一化为具体年份，并把同一结果用于召回和 rerank；其他相对时间不作推断。该范围作为 Qdrant payload filter 同时应用到 dense/sparse hybrid RRF 的两个 prefetch。随后最多取得 24 个候选，再使用当前 `campus_docs_reranker`
连接调用固定的 rerank 模型对候选排序，只保留 `relevance_score >= 0.5` 的候选。数量和字符预算前
排除本轮已返回的 `result_ref`；同一通知的不同片段仍可返回，不按通知来源折叠互补章节，
也不按通知发布时间自动排除旧通知。结果中的 `released_at` 只能证明通知发布时间，不能证明截止日期、适用年度、学期、申请窗口或当前有效性；正文没有适用信息时，答案必须说明无法确认。版本过滤不改变 Notices 的已发布通知范围。最终返回
每次最多 5 条候选结果，正文总字符预算为 4000。agent-control 校验 point schema、文本 hash、section
URL、版本字段和 `root_unit_ids` 后才把结果交给 Agent。reranker 响应的 index 必须覆盖候选且唯一，
score 必须是有限数值；调用或校验失败直接使检索失败，不回退到未重排候选。过滤后无结果返回成功的
`no_match`。该阈值只判断查询与候选文本的相关性，不判断学校、人群或规则适用主体。
当前 collection 包含纳入候选的中央民族大学 Campus Web 文档和已发布 Notices；point 的 `source_kind`
和 citation 由统一 publisher 固定，UI 将 Notice 结果映射为 `campus_notice`。Solve/Executor 根据问题
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

## 索引生命周期

通知正文发布和索引应用独立。通知发布/重新发布后，检索在下次成功 Apply 才反映变化。
职责取舍见[检索 Job 决策](../../../.agents/notes/implemented/architecture/2026-10-14-retrieval-index-jobs.md)。
