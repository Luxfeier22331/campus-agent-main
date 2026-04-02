---
doc_type: architecture
status: active
created: 2026-03-22
updated: 2026-04-02
---

# campus-agent 长期架构

## 目标

将 `campus-agent` 建成校园助理系统的长期入口仓库，核心形态是 supervisor 主导的 `hybrid orchestration`、specialist 子代理，以及带有独立 ingestion/data plane 的可替换 retrieval 栈。

当前阶段的目标不是做一个框架示例，也不是先为所有边界选一个统一 HTTP runtime；目标是先把仓库边界和演进方向定清楚，避免后续再次整体推翻。

这份文档只保存长期架构边界、职责拆分和链路形态，不冻结具体实现、部署拓扑、供应商选型或某一轮历史实施细节。

当前 retrieval strategy 的运行真相不由本文维护；accepted baseline 以 `docs/architecture/retrieval-query-strategy.md` 与相关 ADR 为准。

## 核心立场

- `campus-agent` 应该拥有编排、委派、运行时契约、评测，以及与查询路径配套的数据摄入边界。
- `campus-agent` 不应该被单一 HTTP 框架或单一 retrieval 库绑定。
- `campusRAG` 不应继续作为顶层产品路径里的扁平 tool adapter；它应演进为通过稳定 delegation contract 消费的 specialist capability。
- 长期编排采用 `hybrid orchestration`：确定性 gate 与安全控制优先由 code orchestration 承担，开放式推理与证据综合由 LLM orchestration 承担。
- `manager-managed specialist` 与 `explicit handoff` 可以并存，但默认由 supervisor 保持顶层控制，不演化成无中心 peer mesh。
- retrieval 底座应该是可替换的。LlamaIndex、直连向量基础设施，或其他检索实现，都应该藏在 specialist/retrieval 边界之后，而不是上升成仓库顶层架构。
- `crawler/job` 与 `queue` 在长期架构里保留为摄入链路占位符，用来表达解耦和异步边界，不在此文中冻结成具体产品或运行方式。
- 对象存储在架构上始终表示为独立存储边界；当前阶段即使先部署在本机，也不改变它在系统中的角色定义。
- 面向浏览器的 public/protected product surface 可以拆成独立 Worker web surface，但共享 app backend 仍必须保持清晰 app boundary，不得把产品层职责重新塞回 execution engine。

## 架构形态

长期目标查询链路如下：

`client/channel -> supervisor boundary -> supervisor core -> specialist agent -> retrieval core -> evidence bundle -> supervisor synthesis -> response`

在这条链路里，supervisor 既不是“全知执行者”，也不是“被动转发层”，而是以 policy-driven orchestration 为核心的协调层。

长期目标摄入链路如下：

`crawler/job placeholder -> queue placeholder -> ingestion boundary -> source layer + raw asset registry -> derived layer -> document registry -> vector index/chunk metadata`

长期目标产品链路如下：

`browser -> web surface -> shared app-api -> execution engine / read model`

当前 monorepo 的目录设计围绕这条链路展开：

- `apps/public-chat-web`
  public-facing Worker web surface，承载 public chat 的浏览器入口。
- `apps/protected-panel-web`
  protected Worker web surface，承载 panel 的浏览器入口。
- `apps/app-api`
  shared application backend，承载 auth/session/conversation、chat ingress 与 operator read APIs；runtime 现已冻结为 Worker。
- `apps/supervisor-api`
  execution engine boundary，负责 answer execution 与对应 transport adapter。
- `packages/supervisor-core`
  supervisor 策略、路由、委派、答案组装和升级逻辑。
- `packages/rag-specialist`
  知识域 specialist 接口层。这是对旧扁平 “RAG as a tool” 顶层路径的主要替代。
- `packages/ingestion-core`
  ingestion/data plane 的逻辑消费层，承接队列后的文档标准化、去重、chunking、embedding 写入和 registry/index 更新编排。
- `packages/retrieval-core`
  retrieval kernel 抽象和证据抓取路径。它消费 document registry、chunk metadata 和 vector index。
- `packages/contracts`
  delegation / handoff、evidence bundle、状态和类型化载荷的运行时契约。
- `packages/evals`
  回归场景、离线评测、grader/runner 组合，以及未来 judge/e2e 评测入口。
- `packages/shared`
  只放少量共享常量，不承载业务逻辑。

摄入侧在长期架构上至少需要以下数据层：

- Raw Layer: 对象存储中的原始文档
- Raw Asset Registry: 原始文件身份、版本和存储定位
- Processed Layer: 清洗文本和结构化处理中间结果
- Document Registry: 文档版本、hash、authorization filter projection、状态等元数据
- Chunk Metadata + Vector Index: chunk 元数据和向量检索索引；当前 ACL 字段只属于 projection carrier

与 shared `app-api` 配套的运行数据层至少包括：

- Request Execution: command-side durable request facts
- Projection Outbox: command-side emitted projection inputs
- Request Projection Read Model: operator-facing materialized view

## Runtime 边界

`apps/supervisor-api` 这个名字刻意表达的是 API 边界，不是对 FastAPI 的承诺。

execution engine runtime 选择应该延后。未来可以接受的实现包括：

- FastAPI，作为简单 Python HTTP 服务
- Agno AgentOS，如果最终服务模型原生落在 Agno 上
- 其他 transport/runtime，只要产品约束需要

当前 `AgentOS-native` 只表示 `apps/supervisor-api` 的当期 execution engine 选择，不构成 execution engine 的长期 runtime freeze；当前实现取舍与 Agno 集成深度见 `docs/architecture/supervisor-architecture.md`。

但这条“runtime 仍延后”的规则不再适用于 shared `apps/app-api`：

- `apps/app-api` 的 runtime 已接受为 Worker
- 这项冻结只作用于 shared app backend，不反向推导 `apps/supervisor-api` 也必须是 Worker

当前真正重要的是边界清晰：

- transport 相关逻辑留在 `apps/`
- 编排策略留在 `packages/supervisor-core`
- specialist delegation / handoff contract 留在 `packages/contracts`
- ingestion/data consumption 逻辑留在 `packages/ingestion-core`
- ingestion、job、queue 和存储相关能力都保持在独立边界之后，不反向渗透进 supervisor
- 面向 chat/panel 的 app-level API 留在 shared `apps/app-api` boundary
- `apps/supervisor-api` 不承担浏览器产品 API、auth/session/conversation 或 panel list/detail 查询

## Shared App API Boundary

长期上，public chat 与 protected panel 可以共享一个 `apps/app-api`，但只在以下前提下成立：

- `app-api` 负责产品层 auth/session/conversation 与 browser-facing API
- `app-api` 负责 canonical identity、authorization、profile memory 与 session truth
- `app-api` 作为 internal Worker runtime 存在，而不是默认做成独立 Docker-first backend
- `supervisor-api` 保持 execution engine，不重新长出产品层 backend
- `app-api` 内部仍保持 command/query 分离
- request projection / operator read model 不能退化成 `conversation/message` 的别名

当前 accepted direction 允许 `app-api` 与 execution engine 共用同一个关系数据库，但不允许因此合并 boundary 或 ownership。

这里进一步冻结三条补充规则：

- `app-api` 是唯一的 product-layer auth/session/principal mapping owner，并向 execution engine 显式提供 `actor`
- `supervisor-api` 只做 internal execution caller admission，不从 edge/header 恢复最终 business actor
- request projection 采用 same-database outbox-first：`runtime.request_execution` 与 `runtime.projection_outbox` 是 canonical durable truth

第一版数据库实现同时接受：

- Worker runtime 通过 Hyperdrive 访问数据库
- Better Auth 与 `auth/chat/runtime/operator` 共享一套 Drizzle schema codebase 与 migration pipeline
- migration / schema management 使用 direct database management connection

## Identity, Memory And Knowledge Truth

长期上，回答链路相关的用户上下文固定拆成四层真相：

- `verified identity`
  canonical account / identity truth 支撑的已验证 claims，例如 cohort、major、program、campus、role
- `profile memory`
  用户允许持久化的长期偏好、目标与背景摘要，例如“最近在咨询保研”
- `session memory`
  当前会话内的短期工作记忆、已确认槽位与上下文承接
- `institutional knowledge`
  机构制度、培养方案、官网内容等 document / chunk / evidence truth

长期硬约束如下：

- `apps/app-api` 拥有 `verified identity`、`profile memory` 与 `session memory` 的 canonical truth
- `apps/app-api` 同时拥有 canonical authorization truth，例如 principal mapping、entitlement snapshot、resource ownership 与 approval state
- Worker / edge identity 只属于 runtime-boundary material，不等于最终 actor truth
- `apps/supervisor-api`、`packages/supervisor-core` 与 `packages/rag-specialist` 默认只消费 typed projection，而不是 raw auth / raw authz state / raw memory / raw transcript
- `institutional knowledge` 与 personal memory 不得共用同一个 canonical retrieval truth store
- memory 可以个性化 query planning、clarification 与 answer wording，但不能授予权限
- 当 `verified identity`、memory 与 `institutional knowledge` 发生冲突时，权限与事实依据分别以 verified identity 和 institutional knowledge 为准

## Authorization Truth

长期上，authorization 与 identity / memory 相邻，但不是同一层真相。

长期硬约束如下：

- `apps/app-api` 是 canonical authorization truth owner
- canonical authorization truth 至少覆盖 principal mapping、entitlement truth、resource ownership truth 与 approval truth
- `packages/supervisor-core` 与 `packages/rag-specialist` 只消费最小化 typed authz projection，不直接解析 raw JWT、raw session 或 raw product authz store
- `packages/retrieval-core` 负责执行 serving filter 与 authorization filter projection，但不拥有最终 entitlement resolution
- document / chunk 上的 ACL metadata 属于 search-time filter projection，不是长期 canonical authorization truth
- `visibility` 与 `applicability` 必须分层；major、cohort、recent goal 这类个性化线索默认首先属于 applicability / personalization，而不是 visibility truth
- 当前 accepted implementation 中的 `acl_level`、`acl_groups` 与 `campus_scope` 只属于 transitional filter shape；长期字段族应收敛到显式 `visibility` / `entitlement` projection，不应继续被提升为 canonical authz schema

## 观测与遥测边界

长期上，`campus-agent` 的 observability 采用“统一 telemetry seam + 职责分离 sink”的形态，而不是把错误调试、高吞吐运行事件与审计语义全部混到同一个产品或同一类日志里。

长期约束如下：

- canonical telemetry seam 优先是 `OpenTelemetry`
- trace、request identity、route、status、source locator 与治理字段应在各 runtime / package 边界上保持一致可回链
- 高吞吐结构化运行事件与长期分析面可以独立于错误调试面存在
- 具体 sink、collector、sampling 与 retention 不在本文冻结；accepted 运行选择见对应 ADR

对当前仓库的直接含义：

- `apps/*` runtime 壳负责接入 telemetry export，不把 vendor-specific SDK 语义推回 `packages/contracts`
- `packages/supervisor-core` 继续拥有最小 audit / trace 投影责任，但不直接拥有观测产品选型
- `packages/rag-specialist`、`packages/retrieval-core`、`packages/ingestion-core` 只输出结构化事件与 trace 语义，不直接定义长期 sink 边界
- 如果后续需要 operator-facing request list/detail，必须通过 runtime-owned projection/read API 提供，而不是直接把 telemetry sink 暴露成产品面

相关 accepted 决策：

- `docs/decisions/adr-0010-observability-and-telemetry-stack.md`

在长期边界上，`packages/retrieval-core` 应拥有：

- query preprocessing / normalization
- candidate retrieval（dense / sparse / hybrid）
- candidate fusion / rerank
- evidence shaping / registry back-link

`packages/rag-specialist` 负责 retrieval strategy selection 和答案语义，而不拥有底层 retrieval backend 细节。

对 institution-scoped alias / entity resolution，长期 owner 进一步冻结如下：

- `packages/rag-specialist` 拥有 alias/entity resolution、ambiguity handling 与 answer contract
- `packages/retrieval-core` 只消费 canonical entity/filter truth，不拥有 alias 业务语义
- `packages/ingestion-core` 负责构建离线派生的 entity facts，例如 `course_facts` / `course_family_facts`
- `packages/evals` 负责验证 alias resolution 的 deterministic truth 与 fail-close truth

因此：

- alias 的长期对象应是 canonical entity，而不是 repo-wide 全局字符串替换
- institution-scoped family alias 不得在 retrieval backend 内静默坍缩成单一实体
- retrieval 消费的是 canonical entity facts，而不是 alias 文本本身

## 编排模式

长期编排采用 `hybrid orchestration`，而不是把所有控制都交给 LLM，也不是把所有工作流预先冻结成声明式大图。

职责拆分固定如下：

- `code orchestration`
  负责 auth、ACL / policy gate、approval hook、timeout / retry、deterministic stop condition、结构化输入输出校验、审计与 trace 投影
- `LLM orchestration`
  负责用户目标框定、开放式任务拆解、query rewriting、evidence synthesis、clarification / refusal wording 与其他非确定性推理

在这套编排模式中，允许两类 specialist 交互方式并存：

- `manager-managed specialist`
  supervisor 保持顶层控制，向 specialist 委派受限子任务；这是顶层产品路径的默认模式
- `explicit handoff`
  只有在 specialist 需要拥有后续回合、独立状态或独立交互上下文时，才采用显式 handoff

长期禁止退化为：

- 把顶层产品路径重新做回扁平 tool bundle
- 让 specialist 在没有显式 routing 和 contract 的前提下彼此自由串联
- 演化成没有全局策略拥有者的无中心 peer mesh

## Supervisor 与 Specialist 的职责

### Supervisor

supervisor 是这个仓库长期存在的唯一入口协调者，也是查询链路中唯一拥有全局策略、委派决策和最终响应责任的顶层 agent 角色。

它的职责不是亲自完成所有领域任务，也不是把 specialist 调用包装成一次薄透传；它的职责是在稳定 contract 之上完成请求框定、路由、升级和结果组装。

它应该拥有：

- 会话入口
- 用户目标归一化与意图框定
- 选择委派给哪个 specialist
- 在信息不足、范围不清或风险过高时发起澄清、拒答或升级
- 聚合一个或多个 specialist 的结果并形成最终对外响应
- 统一审计、trace 和策略投影
- 未来的跨域协同与多 specialist workflow 编排

它不应该拥有：

- specialist 内部的领域推理逻辑
- 直接 retrieval 实现细节
- index 构建细节
- 向量数据库特定代码
- ingestion/data plane 逻辑
- transport/runtime 宿主细节
- 对象存储、registry、Qdrant、MinIO 等基础设施耦合

长期约束：

- supervisor 是唯一的全局策略拥有者，但不是知识实现层
- specialist 是稳定能力边界，而不是扁平 tool adapter
- supervisor 与 specialist 的交互必须通过 `packages/contracts` 中冻结的 delegation / handoff contract 完成
- 顶层产品路径默认由 supervisor 保持回合控制；只有在 specialist 明确需要接管后续回合时才采用 handoff
- supervisor 可以决定委派、复核、澄清、升级和最终答复，但不能越级侵入 specialist 或 retrieval 内部实现
- 当系统增加更多 specialist 时，supervisor 负责跨域协同；单个 specialist 仍只对自己的能力边界负责

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

长期在这里固定的只有两件事：

- runtime / agent framework 可以进入 supervisor / specialist 的实现层
- runtime / agent framework 不得泄漏进 `packages/contracts` 或 `packages/retrieval-core`

当前对 Agno / AgentOS 的具体集成深度见 `docs/architecture/supervisor-architecture.md`，而不是由本文冻结。

RAG specialist 的长期内部形态、`RagIntentFrame`、个性化输入边界与 authorization filter 约束，见 `docs/architecture/rag-specialist-architecture.md`。
### Other Specialist Types

specialist 在长期架构中表示“稳定能力边界”，不等同于“只有知识域 RAG specialist”。

除 retrieval-oriented specialist 之外，未来也允许存在其他类型的 specialist，例如：

- `official-web` / `availability` specialist
  负责官网探活、外部站点可达性核验、官方入口状态确认或受控的站点级检查
- 其他非 RAG specialist
  只要它们拥有稳定职责边界、明确 delegation / handoff contract，并且不被降级成 supervisor 内联 tool 集

这类 specialist 仍应遵守同一组长期约束：

- 由 supervisor 显式路由，而不是在 supervisor 内部隐式执行一组零散 tool
- 通过 `packages/contracts` 中冻结的 delegation / handoff contract 交互，而不是暴露底层 runtime / network / infra 类型
- 保持自身能力边界，不把 supervisor 变回“什么都自己做”的顶层 agent
- 如果它们不是当前默认 query-serving 路径的一部分，应在当前执行计划中被单独标注，而不是偷渡进现有 `rag-specialist` 语义

### Specialist 准入规则

新增 specialist 不是默认优化项，必须满足清晰的架构理由。

长期准入条件至少包括：

- 它拥有稳定、可重复、可命名的单一职责边界
- 它对应独立的 downstream capability、tool / permission boundary 或状态边界
- 把该能力继续塞在现有 supervisor 或现有 specialist 内，已经造成 prompt / context / tool overload 或边界混乱
- `packages/evals` 中已有足够证据表明拆分能提升质量、可观测性或安全性

如果这些条件不成立，则默认把能力继续留在现有 specialist 内部，或留在 supervisor 的 policy / orchestration 层，而不是为了“看起来更 agentic”而新增一个边界。

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
- 新 specialist、新 routing 或新 handoff 在进入 `release_gate` 前，必须具备 workflow 和 safety 维度的可重复验证
- trace grading 至少要覆盖 routing、delegation / handoff、retrieval path 与 fail-closed / approval path

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
  保存 `document_id`、`version_id`、`content_hash`、`source_uri`、`corpus`、`collection`、status、ingestion metadata，以及指向 raw asset 的引用；同时保存 retrieval pre-filter 所需的 authorization projection metadata。当前 carrier 仍是 `acl_groups` / `campus_scope`，但长期应收敛到显式 `visibility` / `entitlement` projection。它表达“当前逻辑文档版本是什么”，不重复承载 raw 文件身份。

其中 `packages/ingestion-core` 主要负责把 source/derived 输入推进成可追踪的 registry 与 chunk/index 产物，`packages/retrieval-core` 则负责消费这些产物形成 evidence bundle。

额外约束：

- `derived` 是 chunk 的可重建来源，不是对象存储中的 chunk 文件集合
- 在线查询所消费的 canonical chunk store 是 `Chunk/Index Layer`，当前 accepted implementation 为 `Qdrant`
- 如需把 chunk 额外导出到对象存储，该副本只能用于备份、审计或离线重建，不能成为主消费路径或第二真相源

当前接受的数据平面约束：

- 不长期依赖本机文件系统作为数据真相源
- 所有 crawler 产物先进入队列和对象存储
- 去重在摄入早期完成
- stable document ID / version ID / chunk ID 已作为当前 accepted invariant 建立
- online query path 和 offline ingestion path 必须分离
- 当前阶段对象存储可以先部署在本机，但在架构语义上仍按对象存储边界对待，而不是退化成“本机目录方案”

## Untrusted Data Boundary

以下输入默认都属于 `untrusted data`：

- retrieval 返回的文档片段
- OCR / parser 产物
- 网页文本与外部站点响应
- 第三方 API 返回
- 用户上传文件及其提取文本

长期边界固定如下：

- `untrusted data` 不得直接写回 developer / system 指令层
- `untrusted data` 不得以自由文本形式直接驱动 routing、tool permission 或 handoff 决策
- 节点之间的关键控制信号必须通过结构化 schema 和显式字段传递
- 如需基于不可信内容触发后续动作，必须经过 code orchestration 的显式校验和 policy gate

## 从旧 bootstrap 迁移

旧 bootstrap 只作为历史实现参考，现已不保留在主工作树中；如需追溯请查看 git 历史。

概念上保留的内容：

- 入口 agent 的责任边界
- 显式 contract
- 清晰的下游边界

v2 真正变化的地方：

- `campusRAG` 不再主要作为扁平 tool adapter 的目标
- supervisor / sub-agent 编排成为默认模型
- retrieval 被表示为一个具有稳定 delegation / handoff contract 的 specialist capability
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
- 当前 phase 的部署形态和实施顺序

## 设计约束

- 优先保证仓库边界，而不是优先依赖框架能力。
- 优先保证稳定 contract，而不是优先做方便的临时集成。
- 优先保证 retrieval 内核可替换，而不是把某个库硬编码成顶层架构。
- 优先把 eval protocol 设计成仓库自有边界，而不是把某个评测框架提升为顶层依赖。
- 优先明确 ingestion/data plane 的长期边界，而不是把它混进在线查询路径。
- 在 supervisor、specialist contract、evals 和 retrieval abstraction 仍在一起演进时，优先保持 monorepo。

## 治理边界

ACL、审计和 traceability 当前按“够上线的最小闭环”建设，不按“最终硬化形态”一次做满。

系统治理至少需要覆盖：

- API 边界鉴权真实可用
- 请求级 identity、session 和 trace_id 可以透传
- retrieval 前置过滤，异常时 fail-closed
- 回答返回最小可追溯 source 信息
- 多 agent / 多存储链路有集中 tracing
- 审计日志至少记录用户、路由、sources 和最终状态
- ingestion 日志至少记录 `document_id`、`version_id`、`content_hash`、处理状态和索引写入结果
- 观测默认遵循数据最小化：不把完整 prompt、chunk 正文和敏感认证材料直接作为长期默认日志落盘
- 文档层和 chunk 层都带可重建的 authorization filter projection metadata；当前仍使用 ACL carrier，但它不是 canonical authz truth
- 高风险或不可逆动作必须保留 approval / HITL 介入边界
- specialist 自由文本输出不能直接越过 deterministic gate 触发高风险动作

可在后续阶段继续强化的内容：

- chunk-level 或 field-level ACL
- 完整 ABAC / policy engine
- 不可变审计账本
- 强 replayable evidence bundle
- 全量 HITL / approval flow
- 发布审计和回放工具链

## 决策索引

- Golden dataset 治理规则：`docs/decisions/adr-0003-golden-dataset-governance.md`
- 评测指标体系：`docs/decisions/adr-0004-evaluation-metrics.md`
- 编排模式与安全边界：`docs/decisions/adr-0006-agent-orchestration-and-safety.md`
- 授权与访问控制架构：`docs/architecture/authorization-and-access-control-architecture.md`
- 用户身份、长期记忆与个性化边界：`docs/decisions/adr-0015-user-identity-memory-and-personalization-boundaries.md`
- 授权模型与检索过滤投影：`docs/decisions/adr-0016-authorization-model-and-retrieval-filter-projection.md`
- institution-scoped alias 与 entity resolution 治理：`docs/decisions/adr-0021-institution-scoped-entity-alias-governance.md`
- 数据平面架构约束（历史文件名保留）：`docs/architecture/phase1-ingestion-and-storage-architecture.md`
- shared app backend 与 web surface：`docs/decisions/adr-0012-shared-app-api-and-worker-web-surfaces.md`
- request projection ownership：`docs/decisions/adr-0016-app-api-request-projection-and-panel-query-ownership.md`
- supervisor internal execution admission：`docs/decisions/adr-0017-supervisor-internal-execution-admission.md`
