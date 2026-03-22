---
doc_type: architecture
status: active
created: 2026-03-22
updated: 2026-03-22
---

# campus-agent 长期架构

## 目标

将 `campus-agent` 建成校园助理系统的长期入口仓库，核心形态是 supervisor 主导的编排层、specialist 子代理，以及带有独立 ingestion/data plane 的可替换 retrieval 栈。

当前阶段的目标不是做一个框架示例，也不是先选一个 HTTP runtime；目标是先把仓库边界和演进方向定清楚，避免后续再次整体推翻。

这份文档只保存长期架构边界、职责拆分和链路形态，不冻结具体实现、部署拓扑、供应商选型或第一阶段落地细节。

## 核心立场

- `campus-agent` 应该拥有编排、委派、运行时契约、评测，以及与查询路径配套的数据摄入边界。
- `campus-agent` 不应该被单一 HTTP 框架或单一 retrieval 库绑定。
- `campusRAG` 应该从“被入口 agent 调用的 tool”演进为“通过稳定委派契约消费的 specialist capability”。
- retrieval 底座应该是可替换的。LlamaIndex、直连向量基础设施，或其他检索实现，都应该藏在 specialist/retrieval 边界之后，而不是上升成仓库顶层架构。
- `crawler/job` 与 `queue` 在长期架构里保留为摄入链路占位符，用来表达解耦和异步边界，不在此文中冻结成具体产品或运行方式。
- 对象存储在架构上始终表示为独立存储边界；当前阶段即使先部署在本机，也不改变它在系统中的角色定义。

## 架构形态

长期目标查询链路如下：

`client/channel -> supervisor boundary -> supervisor core -> specialist agent -> retrieval core -> evidence bundle -> supervisor synthesis -> response`

长期目标摄入链路如下：

`crawler/job placeholder -> queue placeholder -> ingestion boundary -> raw layer + raw asset registry -> processed layer -> document registry -> vector index/chunk metadata`

当前 monorepo 的目录设计围绕这条链路展开：

- `apps/supervisor-api`
  对外服务边界，只负责 transport adapter。
- `packages/supervisor-core`
  supervisor 策略、路由、委派、答案组装和升级逻辑。
- `packages/rag-specialist`
  知识域 specialist 接口层。这是对旧 “RAG as a tool” 模式的主要替代。
- `packages/ingestion-core`
  ingestion/data plane 的逻辑消费层，承接队列后的文档标准化、去重、chunking、embedding 写入和 registry/index 更新编排。
- `packages/retrieval-core`
  retrieval kernel 抽象和证据抓取路径。它消费 document registry、chunk metadata 和 vector index。
- `packages/contracts`
  handoff、evidence bundle、状态和类型化载荷的运行时契约。
- `packages/evals`
  回归场景、离线评测、grader/runner 组合，以及未来 judge/e2e 评测入口。
- `packages/shared`
  只放少量共享常量，不承载业务逻辑。

摄入侧在长期架构上至少需要以下数据层：

- Raw Layer: 对象存储中的原始文档
- Raw Asset Registry: 原始文件身份、版本和存储定位
- Processed Layer: 清洗文本和结构化处理中间结果
- Document Registry: 文档版本、hash、ACL、状态等元数据
- Chunk Metadata + Vector Index: chunk 元数据和向量检索索引

## Runtime 边界

`apps/supervisor-api` 这个名字刻意表达的是 API 边界，不是对 FastAPI 的承诺。

runtime 选择应该延后。未来可以接受的实现包括：

- FastAPI，作为简单 Python HTTP 服务
- Agno AgentOS，如果最终服务模型原生落在 Agno 上
- 其他 transport/runtime，只要产品约束需要

当前真正重要的是边界清晰：

- transport 相关逻辑留在 `apps/`
- 编排策略留在 `packages/supervisor-core`
- specialist handoff contract 留在 `packages/contracts`
- ingestion/data consumption 逻辑留在 `packages/ingestion-core`
- ingestion、job、queue 和存储相关能力都保持在独立边界之后，不反向渗透进 supervisor

## Supervisor 与 Specialist 的职责

### Supervisor

supervisor 是这个仓库长期存在的顶层 agent 角色。

它应该拥有：

- 会话入口
- 意图框定
- 选择委派给哪个 specialist
- 在置信度或范围不足时发起澄清
- 组合一个或多个 specialist 的结果
- 未来的跨域协同

它不应该拥有：

- 直接 retrieval 实现细节
- index 构建细节
- 向量数据库特定代码

### RAG Specialist

RAG specialist 是被委派的知识域 worker，不是一个薄薄的 tool shim。

它应该拥有：

- 面向 retrieval 的 query rewriting
- retrieval strategy selection
- evidence collection
- evidence normalization
- 将置信度和证据返回给 supervisor

它未来可以封装：

- LlamaIndex pipeline
- 直连 retriever/reranker pipeline
- hybrid search 基础设施
- verification / refinement loop

第一阶段的 Agno 集成深度建议如下：

- `packages/supervisor-core` 直接使用 Agno 的 agent / team 语义
- `packages/rag-specialist` 可以使用 Agno specialist agent 包装层
- `packages/contracts` 保持纯 schema，不泄漏 Agno 类型
- `packages/retrieval-core` 保持纯 retrieval abstraction，不泄漏 Agno 或 LlamaIndex 类型

换句话说，Agno 应该进入编排层和运行时层，而不应该渗透到所有包。

### Ingestion Boundary

ingestion boundary 是长期存在的数据摄入边界。

在 package 级拆分下，`packages/ingestion-core` 是这个边界里的主要逻辑消费层；它消费队列承接后的摄入任务与原始文档输入，但自身不是对外查询入口。

它应该拥有：

- `crawler/job` 产物消费
- `queue` 解耦后的任务承接
- 对象存储写入
- hash / stable ID 去重
- 版本推进和删除标记
- 文本清洗、chunking、embedding 写入
- document registry 更新

它不应该拥有：

- 在线查询编排
- 面向用户的回答生成
- supervisor 决策逻辑

## Evals Boundary

`packages/evals` 是长期存在的质量控制边界，不是某个评测框架的薄包装。

它应该拥有：

- baseline 场景、golden dataset 和回归用例
- 分层评测协议
- expectations、grader 组合、runner 和 gate
- 面向 agent workflow 的 trace grading 与结果评测

它不应该拥有：

- supervisor、specialist、retrieval 或 ingestion 的正式运行时逻辑
- 业务主链路中的在线决策权
- 把某个第三方评测框架上升成仓库顶层架构绑定

长期约束如下：

- eval 的真相源优先是仓库自有的场景、期望值、trace 和评测协议，而不是某个外部库的默认数据结构
- agent 系统评测既看最终输出，也看中间 trace；黑盒结果评测不能替代 trace grading
- `ragas`、OpenAI graders 或其他 scorer 只应作为 `packages/evals` 边界后的可替换实现，而不是顶层架构承诺

详细治理规则见：`docs/decisions/adr-0003-golden-dataset-governance.md`
指标体系见：`docs/decisions/adr-0004-evaluation-metrics.md`

## Retrieval 真相源

长期“真相源”不应该按库品牌定义，而应该按分层数据模型和 evidence contract 定义。

也就是说：

- Raw 真相源是对象存储中的原始文档
- Metadata 真相源是 document registry
- Retrieval 真相源是 chunk metadata + vector index 产出的 evidence bundle
- 这些 contract 后面的具体实现可以随时间替换
- LlamaIndex 是一种处理和检索实现，不是顶层架构本身

这样可以保证：

- 需要时保留 LlamaIndex
- 只替换真正薄弱的底层部分
- 在相同 specialist contract 之后对比多种 retrieval backend

这层定义只约束“证据从哪来、如何回链”，不约束具体由哪套检索库、向量库或编排框架实现。

## 数据平面

长期数据平面采用 `Raw -> Processed -> Chunk/Index` 三层分离。

数据层职责固定为：

- Raw Layer
  保存原始 PDF、Word、Markdown 等源文件，长期保留以支持重处理和审计。
- Raw Asset Registry
  保存 `raw_asset_id`、`raw_version_id`、`content_hash`、`source_filename`、`raw_source_uri`、`object_key`。它表达“这份原始文件是什么”。
- Processed Layer
  保存清洗文本、OCR/解析结果、供应商原始解析响应、结构化 metadata。
- Chunk/Index Layer
  保存在线检索所需的 chunk 文本、chunk metadata、embeddings 和向量索引。
- Document Registry
  保存 `document_id`、`version_id`、`content_hash`、`source_uri`、`corpus`、`acl_groups`、`campus_scope`、`status`、`ingestion_timestamp`，以及指向 raw asset 的引用。它表达“当前逻辑文档版本是什么”，不重复承载 raw 文件身份。

其中 `packages/ingestion-core` 主要负责把 raw/processed 输入推进成可追踪的 registry 与 chunk/index 产物，`packages/retrieval-core` 则负责消费这些产物形成 evidence bundle。

额外约束：

- `processed` 是 chunk 的可重建来源，不是对象存储中的 chunk 文件集合
- 在线查询所消费的 canonical chunk store 是 `Chunk/Index Layer`，第一阶段具体为 `Qdrant`
- 如需把 chunk 额外导出到对象存储，该副本只能用于备份、审计或离线重建，不能成为主消费路径或第二真相源

第一阶段固定约束：

- 不长期依赖本机文件系统作为数据真相源
- 所有 crawler 产物先进入队列和对象存储
- 去重在摄入早期完成
- stable document ID / version ID / chunk ID 在第一阶段建立
- online query path 和 offline ingestion path 必须分离
- 当前阶段对象存储可以先部署在本机，但在架构语义上仍按对象存储边界对待，而不是退化成“本机目录方案”

## 从旧 bootstrap 迁移

旧 bootstrap 只作为历史实现参考，现已不保留在主工作树中；如需追溯请查看 git 历史。

概念上保留的内容：

- 入口 agent 的责任边界
- 显式 contract
- 清晰的下游边界

v2 真正变化的地方：

- `campusRAG` 不再主要作为扁平 tool adapter 的目标
- supervisor / sub-agent 编排成为默认模型
- retrieval 被表示为一个具有稳定 handoff contract 的 specialist capability
- framework 选择与架构选择解耦
- ingestion/data plane 被正式提升为长期架构的一部分
- `crawler/job` 与 `queue` 在长期图中作为摄入占位边界存在

## 与实现文档的关系

这份文档只回答以下问题：

- 长期有哪些边界
- 查询链路和摄入链路如何分层
- 哪些职责属于 supervisor，哪些属于 specialist，哪些属于 ingestion/data plane

以下内容不在此文中冻结：

- 具体 runtime 选型
- 具体 queue / crawler / object storage / vector store 产品
- repo 中是否新增某个 app 或 package
- 第一阶段部署形态和实施顺序

## 设计约束

- 优先保证仓库边界，而不是优先依赖框架能力。
- 优先保证稳定 contract，而不是优先做方便的临时集成。
- 优先保证 retrieval 内核可替换，而不是把某个库硬编码成顶层架构。
- 优先把 eval protocol 设计成仓库自有边界，而不是把某个评测框架提升为顶层依赖。
- 优先明确 ingestion/data plane 的长期边界，而不是把它混进在线查询路径。
- 在 supervisor、specialist contract、evals 和 retrieval abstraction 仍在一起演进时，优先保持 monorepo。

## 治理边界

ACL、审计和 traceability 在第一阶段按“够上线的最小闭环”建设，不按“最终硬化形态”一次做满。

系统治理至少需要覆盖：

- API 边界鉴权真实可用
- 请求级 identity、session 和 trace_id 可以透传
- retrieval 前置过滤，异常时 fail-closed
- 回答返回最小可追溯 source 信息
- 多 agent / 多存储链路有集中 tracing
- 审计日志至少记录用户、路由、sources 和最终状态
- ingestion 日志至少记录 `document_id`、`version_id`、`content_hash`、处理状态和索引写入结果
- 文档层和 chunk 层都带 ACL metadata

可在后续阶段继续强化的内容：

- chunk-level 或 field-level ACL
- 完整 ABAC / policy engine
- 不可变审计账本
- 强 replayable evidence bundle
- 全量 HITL / approval flow
- 发布审计和回放工具链

## 决策索引

- 第一阶段架构决策记录：`docs/decisions/adr-0001-phase1-architecture.md`
- Golden dataset 治理规则：`docs/decisions/adr-0003-golden-dataset-governance.md`
- 评测指标体系：`docs/decisions/adr-0004-evaluation-metrics.md`
- 第一阶段 ingestion 与存储架构：`docs/architecture/phase1-ingestion-and-storage-architecture.md`
