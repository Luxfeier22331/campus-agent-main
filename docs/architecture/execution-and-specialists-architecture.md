---
doc_type: architecture
status: active
created: 2026-04-02
updated: 2026-04-21
---

# Execution And Specialists Architecture

## 文档边界

本文冻结 execution engine、supervisor 与 specialist supporting architecture。

它回答的是：

- `apps/supervisor-api` 与 `packages/supervisor-core` 分别负责什么
- supervisor 如何与 specialist 交互
- RAG specialist 与其他 specialist 的长期角色是什么

## Execution Chain

当前与长期都遵循：

`app-api -> supervisor-api -> supervisor-core -> specialist -> retrieval-core -> evidence -> supervisor response`

边界固定如下：

- `apps/supervisor-api` 负责 internal execution admission 与 transport
- `packages/supervisor-core` 负责 policy-driven orchestration
- specialist 负责能力边界内的 planning / evidence consumption / answer shaping
- `packages/retrieval-core` 负责 evidence retrieval kernel、target-state retrieval execution 与 query activity，不负责顶层产品编排

## Supervisor Responsibilities

supervisor 长期负责：

- intent framing
- risk / safety gate
- specialist routing
- handoff shaping
- response finalization
- fail-close terminal semantics

supervisor 不负责：

- retrieval backend 细节
- collection-specific ingestion logic
- product-layer auth/session ownership
- 将 specialist 降级成扁平 tool bundle

## Specialist Model

specialist 是稳定能力边界，不等于某个底层框架对象。

当前 merged-truth 已接受的 current-truth runtime / package label：

- `rag-specialist`
- `navigation-specialist`

后续如引入新的稳定 capability family，必须满足：

- 能力边界长期稳定
- handoff contract 可显式化
- workflow / safety / eval 可重复验证

补充命名约束：

- `supervisor` 是 invariant top-level role name，不引入 `supervisor-agent`
- repo-wide execution capability 统一采用三层 vocabulary：
  - invariant role name
  - current-truth runtime / package / contract label
  - forward family label
- 当前 merged-truth package 继续保留 `rag-specialist`、`navigation-specialist` 等命名
- 当前已冻结的 forward family mapping 为：
  - `rag-specialist -> rag-agent`
  - `navigation-specialist -> navigation-agent`
  - `campus-services-agent`
  - `notice-agent`
- 当长期新增稳定 capability family 时，前向 family label 默认采用 `<domain>-agent`
- 本文在讨论当前 package owner / runtime label 时继续使用现有 current-truth 名称；在讨论未来 family 时使用 `*-agent`
- 在 repo-wide family convergence 真正执行前，current-truth contract label 与 forward family label 允许短期并存；新增 domain capability 应先冻结 mapping，再决定是否迁移 label，而不是边实现边混用

## Structured Service And Notice Runtime Pattern

长期上，部分校园问题不是 generic retrieval 问答，而是 projection-backed structured runtime query。

当前已收口的前向 family 包括：

- `campus-services-agent`
  - 负责 `transport_schedule_lookup`、`service_status_lookup`
  - 回答班车/接驳车班次、上下车点、服务开放时间、临时关闭与运营 override
  - later-wave `contact_directory_lookup` 负责部门电话、办公电话、邮箱、办公地点与联系人联系方式
  - later-wave `service_process_lookup` 负责办理步骤、材料、入口、适用人群与前提条件
- `notice-agent`
  - 负责 `campus_notice_discover`、`campus_notice_get`
  - 回答 notice 发现、canonical notice 正文读取，以及 current-year miss 时的 historical downgrade
  - future source family 至少显式区分 public `official_web` notice-like pages 与 restricted `campus_notices/internal_notice`
- `navigation-agent`
  - target-side family label；当前 accepted runtime package / ADR label 仍是 `navigation-specialist`
  - 可消费 transport point refs / service point refs
  - 不拥有 timetable truth 或 service-status truth
- `rag-agent`
  - target-side family label；当前 accepted runtime package 仍是 `packages/rag-specialist`
  - 继续承接稳定制度/流程/材料类问题，例如公费医疗报销规则、材料与办理流程

固定实现 shape：

- tool 只是 domain-agent 持有的 thin adapter
- tool 后面必须是 repo-owned internal query service，而不是 browser-facing API
- internal query service 只消费 projection / normalized truth，不在 query 时回扫 raw notice/source bundle
- supervisor 负责 routing / terminal semantics，但不直接拥有这些 domain tools
- `current/latest/effective/current-year miss` 这类 temporal semantics 必须是 code-owned routing / contract truth，而不是 prompt 或 retrieval 层的事后补救

projection owner 继续显式分层：

- `service_status_lookup`
  - 只读 current-effective status projection
  - 不把 `service_catalog` 文本检索或 generic RAG 当作 runtime query seam
- `transport_schedule_lookup`
  - 只读 route / service window / stop ref projection
  - `navigation-agent` 只消费 point refs，不拥有 timetable truth
- `campus_notice_discover`
  - 只读 source-family-aware notice discovery projection
  - public `official_web` notice-like pages 与 restricted `campus_notices/internal_notice` 继续先分 projection，再由 `notice-agent` 收口
- `campus_notice_get`
  - 只读 canonical notice body projection
  - 不得在 query time 拼 raw notice/source bundle 或退化成 link-only read
- later-wave `contact_directory_lookup`
  - 只读 `campus_services/contact_directory` 的 contact entity / entity-group projection
  - handbook 电话页、official-web 联系方式页与 future directory page 只作为 provenance/source-family 上游
  - 明确 contact fact lookup 进入 structured runtime 时，不再由 generic RAG chunk 充当 canonical answer seam
  - alias ambiguity -> clarification；currentness 不可证或 source 冲突 -> fail-close / unavailable
- later-wave `service_process_lookup`
  - 只读 `campus_services/service_catalog` 的 process-oriented projection
  - handbook flow page、official-web 办事说明页与 future service entry page 只作为 provenance/source-family 上游
  - 明确 process fact lookup 进入 structured runtime 时，不再由 generic RAG chunk 或说明性正文充当 canonical answer seam
  - service / audience / process variant ambiguity -> clarification；缺 process/materials/entry truth -> fail-close / unavailable
  - related contact refs 可以进入结果，但 canonical contact truth 仍由 `contact_directory_lookup` 拥有

## Structured Runtime Opening Gate

`campus-services-agent` / `notice-agent` 的 owner package、thin adapter 与 handoff seam 已存在，不等于这条 runtime lane 已开放。

固定规则：

- opening gate 默认保持 closed，直到 backing query implementation、release-gate regression / eval evidence 与 app-owned typed observability summary 同时满足
- 在 gate 仍关闭时，产品主路径只能保持当前 routing truth 或 deterministic fail-close；不得通过 stub / unavailable adapter 伪装成“能力已上线”
- historical downgrade 与 stable-RAG boundary 属于 opening criteria，不是后续 prompt polish 或 operator 文案问题

## RAG Family Responsibilities

`packages/rag-specialist` 是当前 `rag-agent` family 的 runtime package owner；它当前与长期负责：

- retrieval-oriented request framing
- ambiguity handling
- clarification / no-answer / completed policy
- grounded answer synthesis
- personalization inputs within authz boundary

它不负责：

- canonical authz truth
- product-layer identity / session / memory ownership
- retrieval vendor/runtime freeze

## RAG Family Internal Roles

长期 `rag-agent` family 在 capability boundary 内固定拆成以下内部角色：

- `scope resolver`
  - 解析 capability、surface、entity、query mode
- `retrieval planner`
  - 生成 typed retrieval plan
- `answer synthesizer`
  - 基于 supporting evidence 生成最终回答
- `grounding validator`
  - 判断最终回答是否仍被 supporting evidence 支持

这些角色可以继续由同一 package 内部实现，但长期不得再混成一个无法观测的单阶段 prompt 调用。

## Retrieval Planner / Executor Boundary

长期固定采用：

`specialist planner -> retrieval-core executor`

其中：

- `rag-agent`
  - 当前 runtime package 仍是 `packages/rag-specialist`
  - 拥有 plan 语义、replan 决策、supporting evidence selection policy
- `retrieval-core`
  - 拥有 step execution、rerank、merge / dedupe、query activity、candidate shaping

固定规则：

- planner 不能绕过 runtime profile 或 authz projection
- executor 不能反向改写产品 scope、query mode 或 capability
- plan 必须是 typed artifact，而不是只存在于 prompt 内部

## Cross-Scope Planning Rules

长期允许的 cross-scope planning 只存在于 repo admitted 的 capability boundary 内。

这意味着：

- `curriculum_plan` 可以按 repo truth 进入 `course_facts`、`program_family_facts`、`program_semester_facts`
- historical / compare / freshness-sensitive branch 只能进入显式 admitted retrieval mode
- live retrieval 只能命中 repo-owned source channel

长期禁止：

- planner 静默打开 `offline_preparation` surface
- planner 把开放域 general web 作为 campus path 的隐藏 fallback
- executor 因为召回困难而自行切到另一个未 admission 的 collection

## Retrieval And Execution Contract

- specialist 与 supervisor 通过 `packages/contracts` 交互
- retrieval / infra types 不进入 shared contract
- `ContextProjection` / `SupervisorResponse` 是当前 merged truth 的 shared seam
- future specialist growth 只能在这个 seam 之后扩张
- target-state agentic retrieval 必须继续通过 typed plan / query activity / evidence summary seam 扩张，而不是退回 hidden prompt state

## Runtime Posture

`apps/supervisor-api` 表示 execution engine boundary，不代表 repo-wide HTTP/runtime freeze。

当前重要的是：

- transport 留在 `apps/*`
- orchestration 留在 `packages/supervisor-core`
- specialist behavior 留在 specialist package

## Prompt And Instruction Ownership

execution path 的 prompt / instruction 继续遵循 package-owned ownership：

- `packages/supervisor-core`
  owns supervisor role instructions、clarification / reject / approval / out-of-scope wording prompt families
- `packages/rag-specialist`
  owns answer / clarify / no-answer / unsupported prompt families
- `packages/retrieval-core`
  不拥有 top-level task prompt；只拥有 evidence retrieval 与 serialization helper
- `apps/supervisor-api`
  不拥有长期 prompt truth；只负责 request packaging 与 execution admission

prompt 不能替代 code-owned routing、authz、serving filter 或 fail-close terminal semantics。

execution path 的最终 prompt stack 也固定为：

`repo-global developer invariants -> package-owned role prompt -> typed task/evidence packet -> code-side finalization`

补充约束：

- `apps/supervisor-api` 与后续 product runtime 只负责装配与执行，不拥有新的 monolithic mega system prompt
- 当前 repo-default runtime assembly seam 已收口到 `apps/supervisor-api/src/campus_supervisor_api/prompt_stack.py`；它必须把 trusted developer/task layers 与 untrusted user/evidence layers 分开表达
- `packages/retrieval-core` 继续只提供 evidence serialization helper，不拥有 top-level prompt truth
- `system prompt` 这个词在 repo 里只保留为沟通简称；真正运行时应以 developer prompt + typed packets 表达

## Forbidden Shapes

- 不把 supervisor 重新写成被动转发层
- 不把 specialist 重新降级成 `campusRAG` 式扁平 tool
- 不把 `campus-services-agent` / `notice-agent` 的 structured runtime 再塞回 generic RAG 或单一 mega-tool router
- 不把 retrieval implementation 细节塞回 `packages/supervisor-core`
- 不让 `apps/supervisor-api` 恢复 product backend、operator query 或 browser API 责任
- 不让 execution path 为了取 service/notice truth 而回调 `app-api` loopback HTTP
- 不让 tool 在 query time 重新扫描 raw notice/source bundle 来“临时算答案”
- 不把 retrieval steps 内联回 supervisor routing
- 不让 planner 以 prompt-only 方式隐式决定未 admission 的 retrieval branch
- 不让 executor 在没有 plan truth 时自猜 current / historical / freshness 语义

## 相关稳定文档

- `docs/decisions/adr-0006-agent-orchestration-and-safety.md`
- `docs/decisions/adr-0017-supervisor-internal-execution-admission.md`
- `docs/architecture/agentic-retrieval-architecture.md`
- `docs/architecture/prompt-and-instruction-architecture.md`
- `docs/reference/runtime-serving-and-index-terms.md`
