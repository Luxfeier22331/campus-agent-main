---
doc_type: architecture
status: active
created: 2026-03-22
updated: 2026-03-28
---

# Supervisor 架构设计

## 目标

定义 `campus-agent` 中 supervisor 的专属架构边界，并明确区分：

- 长期架构：系统成熟后的稳定角色、职责和交互模型
- 当期设计架构：phase-1 / 当前实现阶段应该采用的最小正确形态

这份文档只回答 supervisor 应该如何设计，不替代全局架构文档、长期编排 ADR 或实施计划；当前 execution engine runtime 取舍与 Agno 集成深度由本文承接。

## 文档定位

关系固定如下：

- `docs/architecture/long-term-architecture.md`
  定义整个仓库的长期边界、链路分层和 package 责任
- `docs/architecture/app-api-architecture.md`
  定义 canonical app identity / memory ownership 与 app boundary
- `docs/architecture/rag-specialist-architecture.md`
  定义 retrieval-specific intent framing 与 RAG 内部边界
- `docs/architecture/phase1-ingestion-and-storage-architecture.md`
  定义 phase-1 数据平面边界，以及对象存储 + registry + Qdrant 组合的原因
- `docs/decisions/adr-0006-agent-orchestration-and-safety.md`
  定义长期编排模式、specialist 准入与安全边界
- `docs/decisions/adr-0015-user-identity-memory-and-personalization-boundaries.md`
  定义 identity / memory / personalization 的长期边界
- `docs/plans/agentic-rag-foundation.md`
  定义 phase-1 落地顺序、文件落点和验收标准
- 本文
  负责 supervisor 这个边界自身的长期形态与当期设计形态，并承接当前 execution engine runtime 与 Agno 集成边界

## 设计原则

- supervisor 是唯一入口协调层，不是知识实现层
- supervisor 拥有全局策略与最终响应责任，但不拥有 specialist 内部推理逻辑
- supervisor 与 specialist 的交互必须通过稳定 delegation / handoff contract 完成
- 长期采用 `hybrid orchestration`；deterministic gate 与安全边界优先由 code orchestration 收口
- supervisor 不直接接触 retrieval、ingestion 或基础设施细节
- supervisor 只消费 typed identity / memory projection，不拥有 canonical identity / memory truth
- supervisor command side 可以生成最小 audit/trace/runtime facts，但不承载 shared product API、auth/session/conversation 或 panel query serving
- phase-1 即使只有一个 specialist，也应保留真正的 coordination 形态，而不是长期停留在透传包装

## 长期架构

### 角色定义

长期形态中的 supervisor 是系统唯一的 entry orchestrator。

它负责承接所有用户请求，并在统一策略下完成：

- 请求框定
- 路由决策
- specialist 委派
- 澄清 / 拒答 / 升级
- 多 specialist 协同
- 最终响应组装
- 审计与 trace 投影
- command-side runtime fact emission

它不是：

- 一个亲自完成所有领域任务的全知 agent
- 一个把 specialist 调用包一层就返回的薄代理
- 一个夹带 retrieval / storage / runtime 细节的汇总层

### 长期查询链路中的位置

supervisor 在长期链路中的位置固定如下：

`client/channel -> supervisor boundary -> supervisor core -> specialist -> downstream capability -> supervisor synthesis -> response`

其中：

- `supervisor boundary`
  负责 transport、session、auth、外部协议与运行时壳
- `supervisor core`
  负责策略、路由、委派、升级和最终响应
- `specialist`
  负责本域能力执行，例如 retrieval-oriented specialist

### 长期编排模式

supervisor 的长期工作方式不是“只允许 handoff”，而是允许两类受控交互并存：

- `manager-managed specialist`
  supervisor 保持回合控制，向 specialist 委派受限子任务；这是顶层产品路径的默认模式
- `explicit handoff`
  只有在 specialist 需要拥有后续回合、独立状态或独立交互上下文时，才采用显式 handoff

同时，supervisor 长期采用 `hybrid orchestration`：

- `code orchestration`
  负责 auth、ACL / policy gate、tool permission、approval hook、timeout / retry、deterministic stop condition 与结构化输入输出校验
- `LLM orchestration`
  负责意图框定、开放式任务拆解、query rewriting、澄清措辞与结果综合

长期不允许退化为：

- 把 specialist 再次降级成 supervisor 内部的一组零散 tool
- 让 specialist 在没有显式 routing 和 contract 的前提下自由串联
- 让顶层产品路径失去 supervisor 这个全局策略拥有者

### 长期内部职责分层

长期 supervisor 应拆成若干稳定责任层，而不是一个大而全的 agent 类。

建议责任层如下：

- `Request Framing`
  将外部请求归一化成内部可决策输入，吸收 identity、trace、conversation、policy snapshot
- `Intent Framing`
  识别用户目标、问题类型、信息缺口与风险级别
- `Routing Policy`
  决定由哪个 specialist 承接，或是否先澄清 / 拒答 / 升级
- `Delegation Gateway`
  通过 `packages/contracts` 中的 delegation / handoff schema 向 specialist 发起委派
- `Supervisor Decision Policy`
  基于 specialist 结果判断完成、复核、追问、换路由或升级
- `Response Assembler`
  统一最终答复、状态、引用、follow-up 和对外口径
- `Audit / Trace Projector`
  输出最小审计字段与可追踪事件

这些层是职责分层，不强制绑定为某种框架类或某个特定 runtime 抽象。

### 长期 IntentFrame Contract

长期上，supervisor 不应把 top-level intent 识别等价为“入口已经给定 capability 或 scope”。

它至少应拥有一个稳定的 `IntentFrame` 语义层，字段名可以演进，但语义至少覆盖：

- `capability`
- `task_kind`
- `domain_candidates`
- `missing_slots`
- `risk_level`
- `needs_clarification`
- `suggested_next_action`

这里冻结的是语义，不冻结具体 dataclass / JSON schema 名称。

### 长期 Routing Inputs

supervisor 长期允许消费的 routing input 固定如下：

- 用户原始输入
- canonical actor claims 的 typed projection
- profile memory / session memory 的 typed summary
- conversation / trace / request metadata
- runtime profile、serving policy 与 approval policy

长期默认不允许把以下内容当成 routing truth：

- Worker / edge 侧未经 app-layer 映射的 identity
- raw memory text
- raw conversation transcript
- retrieval / OCR / 网页片段等 untrusted free text

### 长期 Clarification / Rejection / Approval Policy

supervisor 的长期职责不只是“选 specialist”，还包括对不完整或高风险请求做显式收口。

因此长期规则固定如下：

- 缺关键槽位时，优先 `clarify`
- 范围不符、未开放或风险过高时，优先 `reject` 或 `approval_required`
- 只有在 routing input 已足够稳定时，才进入 specialist delegation
- 个人记忆可以帮助提问更精准的澄清问题，但不能绕过 deterministic gate

### 长期拥有的能力

- 全局路由权
- 最终响应决定权
- 跨 specialist 协同权
- 统一 policy 执行权
- 审计 / trace 统一投影权
- 失败闭环与升级权

### 长期不拥有的能力

- retrieval strategy selection
- query rewriting
- evidence collection
- vector store / object store / registry 访问
- ingestion/data plane orchestration
- transport/runtime 宿主实现
- shared app-level auth/session/conversation hosting
- product-facing panel query serving
- canonical identity / profile memory ownership

这些能力分别属于 `specialist`、`retrieval-core`、`ingestion-core` 和 `apps/*` 边界。

### 长期与其他边界的关系

与 `apps/supervisor-api`：

- execution engine 边界只负责受控执行入口、runtime 集成和进入 supervisor core
- API 边界可以持久化 command-side request facts 与 projection outbox
- browser-facing product APIs 不属于这里
- supervisor 不反向吸收 HTTP、auth 或 runtime host 细节

与 `packages/contracts`：

- supervisor 只能通过共享 contract 与 specialist 交互
- contract 是 supervisor 多 specialist 演进的稳定边界

与 `packages/rag-specialist`：

- supervisor 决定是否委派给 RAG specialist
- supervisor 拥有 top-level intent framing
- RAG specialist 决定 retrieval-oriented query / answer / confidence 逻辑，以及 retrieval-specific intent framing

与 `packages/retrieval-core`：

- supervisor 不直接访问 retrieval-core
- retrieval-core 只通过 specialist 间接被消费

与 `packages/ingestion-core`：

- supervisor 不拥有任何 ingestion/data plane 逻辑
- online query path 与 offline ingestion path 必须长期分离

与 `apps/app-api`：

- supervisor 不直接 serving browser-facing chat/panel APIs
- `app-api` 负责 auth/session/conversation 与 operator query
- `app-api` 负责 canonical identity、profile memory 与 session truth
- `app-api` 当前已冻结为 Worker runtime，但这不要求 supervisor 也采用同一 runtime
- `app-api` 只把受控执行请求和最小化 typed context projection 交给 supervisor，而不是把 supervisor 暴露成产品后端

### 长期演进方向

当系统从单 specialist 演进到多 specialist 时，supervisor 的变化应该体现在：

- 路由规则变复杂
- 协同 workflow 变复杂
- 结果组装逻辑变复杂

而不应该体现在：

- 直接侵入 specialist 内部实现
- 在 supervisor 中堆积下游 capability 细节
- 把 contract 退化为临时函数调用

### 长期扩展门禁

当系统考虑新增 specialist、handoff 路径或 approval-required capability 时，supervisor 侧至少应满足以下前置条件：

- 满足 `docs/decisions/adr-0006-agent-orchestration-and-safety.md` 中的 specialist 准入规则
- 对应 routing、delegation / handoff 和 safety gate 已在 `packages/evals` 中具备可重复验证
- 缺少 machine-grade trace 点的设计，不应被视为“已具备长期可维护性”

## 当期设计架构

### 目标

当前阶段的 supervisor 设计目标不是一步做到完整多 agent orchestration，而是在 phase-1 约束内建立最小正确骨架：

- 当前默认 query-serving 主线仍是 `rag-specialist`
- 当前可以显式路由到 `availability-specialist`
- 当前查询范围是否开放某个 scope，由 supervisor routing/policy 决定，而不是由 API shell 固定构造 `rag-specialist + regulations/student_handbook`
- 当前仍以最小可验证主链路为优先
- 当前必须避免继续扩大“supervisor 只是透传”的错误形态
- 当前默认保持 supervisor 对用户回合的持续控制，不开放用户可见 handoff

这里的“默认主线仍是 rag-specialist”表示当前实现重点仍围绕 handbook 查询，而不是长期架构上禁止增加第二个 specialist。

### 当前执行引擎与 Agno 集成边界

当前设计固定如下：

- `apps/supervisor-api` 当前采用 `AgentOS-native` 作为 execution engine runtime
- 对外产品接口仍保留自定义 HTTP 入口壳；`AgentOS-native` 不等于“不暴露 HTTP”
- 当前不保留旧 `/api/search`、`/api/answer` 兼容层
- `Agno` 允许进入 `apps/supervisor-api`、`packages/supervisor-core`、`packages/rag-specialist`
- `Agno` 不得泄漏到 `packages/contracts` 与 `packages/retrieval-core`

采用这组边界的原因是：

- 直接复用 `AgentOS`/`Agno` 已有的 session、trace、RBAC、streaming 与 team/workflow execution 能力
- 保留产品 API 的自主定义能力，不把 execution engine runtime 等价成唯一外部接口
- 避免把运行时框架绑定成整个 monorepo 的底层类型系统
- 让 retrieval kernel、shared contracts 与未来 specialist 扩展继续保持可替换

这里冻结的是当前设计，不是长期 runtime freeze：

- 长期是否继续沿用 `AgentOS-native`，仍取决于 contract 兼容性、observability、RBAC、deployment 与迁移成本
- 当前 serving surface、serving alias、physical collection 与 release 运行真相不由本文维护；以 runtime profile、`.planning/PROJECT.md`、`.planning/STATE.md` 与 `docs/reference/runtime-serving-and-index-terms.md` 为准

### 当前架构定位

当期 supervisor 应该被实现为：

`supervisor-facing entry, policy-driven coordinator`

这意味着：

- 虽然当前 handbook 主线只稳定依赖一个 query-serving specialist，但仍然要显式保留 routing decision
- 虽然当前结果主要来自 RAG specialist，但最终状态与对外响应仍由 supervisor 收口
- 虽然当前 workflow 很短，但仍然要把 request framing、response assembly、audit projection 从透传逻辑中拆出来
- 当前 delegation 仍是 bounded subtask delegation，不让 `rag-specialist` 接管用户会话
- 当前如果需要 request projection，也应在 command side 一次性生成事实，再交给 `app-api` 的 read path，而不是在 panel 查询时回打 supervisor

### 当前查询链路

当期查询链路固定为：

`supervisor-api -> supervisor-core -> specialist -> downstream capability -> supervisor response`

其中当前 supervisor-core 至少负责：

- 接收已经完成 auth / trace 注入的请求
- 做最小请求归一化，并把外部 `SupervisorRequest` 和内部 `SpecialistRequest` 分开
- 在路由前执行显式 validation 和 query policy gate，并对冲突输入 fail-closed
- 选择 `rag-specialist` 或其他显式 specialist
- 处理 `completed` / `needs_clarification` / `no_answer` / `error`
- 形成统一的对外响应语义
- 投影最小审计字段
- 为后续 approval / escalation 留出 deterministic gate 的位置，但当前不要求一次做满

### 当前建议的内部模块骨架

为了避免长期继续围绕一个 `handle()` 透传函数扩展，当期设计建议 supervisor-core 至少收敛为以下模块角色：

- `agent.py`
  只负责编排主流程，不承载所有判断细节
- `request.py` 或 `context.py`
  负责 supervisor 内部的请求上下文模型
- `validation.py`
  负责 capability 归一化、冲突请求拒绝和缺失路由输入校验
- `query_policy.py`
  负责 phase-1 query-enabled scope gate，不把范围决策塞回 transport 壳
- `routing.py`
  负责当前 specialist 选择逻辑，并为未来多 specialist 扩展保留接口
- `errors.py`
  负责 supervisor 侧稳定错误分类，供上层 boundary 做结构化映射
- `policy.py`
  负责 clarification / escalation / finalization 等决策规则
- `response.py`
  负责最终响应组装
- `audit.py`
  负责最小审计字段投影，至少覆盖 route、requested capability/scope 和 response status

当期不要求这些模块一次做得很重，但要求职责位置先固定。

### 当前最小决策流

当期建议的最小决策流如下：

1. API boundary 完成 auth、actor 映射和 trace 注入
2. supervisor 归一化请求并构建内部上下文
3. supervisor 执行 validation + query policy，再路由到目标 specialist
4. specialist 返回 typed response
5. supervisor 根据结果决定：
   - 直接完成
   - 返回澄清问题
   - 保持 no-answer
   - 返回错误并记录审计
6. supervisor 输出统一响应并投影最小审计字段

### 当前必须做到的边界

- 不把 retrieval 细节拉回 supervisor-core
- 不让 supervisor 越过 specialist 直连 registry、Qdrant、MinIO
- 不把 HTTP transport、auth 或 AgentOS host 逻辑混进 supervisor-core
- 不为“先跑通”继续扩建 pass-through 结构
- 当前默认由 supervisor 持续控场，不让 `rag-specialist` 接管用户回合
- 不让 specialist 返回的自由文本直接驱动下一跳控制逻辑
- 不把 phase-1 的单 specialist 设计写成长期架构承诺
- 如果未来引入新的 specialist，例如 `official-web` / `availability` specialist，应通过显式 routing target 和独立 contract 接入，而不是退回成 supervisor 内联 tool bundle

### 当前允许显式延后的能力

- 多 specialist routing matrix
- specialist 间串并行 workflow
- supervisor 级复核 / 反思循环
- 更细粒度的 policy engine
- 更强的会话状态管理
- 完整 HITL / approval flow

这些能力可以后续增加，但不影响当前先把 supervisor 的正确骨架立住。

需要区分两件事：

- “复杂多 specialist workflow engine” 可以延后
- “为长期稳定能力新增一个边界清晰的 specialist” 本身并不违背长期架构；是否在当前里程碑纳入，应由 `.planning/` 中的当前执行决策决定

## 长期架构与当期设计的关系

两者的关系不是“长期先不管，当前先凑合”，而是：

- 长期架构定义 supervisor 最终应成为什么
- 当期设计定义现在先把哪些职责位置固定住
- 当期设计允许能力裁剪，但不允许边界退化

因此，当期设计即使只支持一个 `rag-specialist`，也必须保留以下长期不变量：

- supervisor 是唯一入口协调层
- supervisor 拥有最终响应责任
- specialist 是稳定能力边界，不是 tool adapter
- supervisor 与 specialist 之间通过稳定 contract 交互
- supervisor 不直接吸收 retrieval / ingestion / infra 细节

## 非目标

本文不冻结以下内容：

- 具体 runtime 选型细节
- supervisor 内部最终类名或模块名
- 某个框架下的 agent/team API 用法
- phase-1 的逐任务实施顺序
- 第二个 specialist 的具体引入方式
- 任何一轮新增 routing / specialist 的具体 gate 数值

这些内容分别由 ADR、实施计划和后续代码设计承担。
