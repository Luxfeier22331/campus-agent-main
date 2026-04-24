---
doc_type: architecture
status: active
created: 2026-04-02
updated: 2026-04-24
---
# Execution And Agents Architecture

## 文档边界

本文冻结 execution engine、supervisor 与 agent supporting architecture。

它回答的是：

- `apps/supervisor-api` 与 `packages/supervisor-core` 分别负责什么
- supervisor 如何与 agent 交互
- RAG agent 与其他 domain capability family 的长期角色是什么

## Execution Chain

当前与长期都遵循：

`app-api -> go-shell -> supervisor-api private bridge -> supervisor-core ->
agent -> retrieval-core -> evidence -> supervisor response`

边界固定如下：

- `apps/go-shell` 负责 Docker-side execution runtime control plane
- Python `apps/supervisor-api` 负责 private bridge worker 与 semantic orchestration
  runtime assembly
- `packages/supervisor-core` 负责 policy-driven orchestration、admission / routing
  与 finalization
- agent 负责能力边界内的 planning / evidence consumption / answer shaping
- `packages/retrieval-core` 负责 evidence retrieval kernel、target-state retrieval
  execution 与 query activity，不负责顶层产品编排

## Supervisor Responsibilities

supervisor 长期负责：

- admission / guardrails
- capability routing
- handoff shaping
- response finalization
- fail-close terminal semantics

supervisor 不负责：

- retrieval backend 细节
- collection-specific ingestion logic
- product-layer auth/session ownership
- 将 agent 降级成扁平 tool bundle

补充约束：

- supervisor 是 neutral capability router，不是默认的 knowledge / `rag-agent` router
- `public chat` 当前 knowledge-only 只是 surface posture，不反向定义 supervisor 的长期角色

## Supervisor Runtime Kernel

长期上，supervisor execution engine 拆成两类职责：

- deterministic runtime control plane
- semantic orchestration and agent reasoning

Docker-side Go runtime control plane 长期负责：

- request lifecycle、in-flight registry、deadline、timeout、cancel 与 graceful drain
- global / per-capability lane admission、queue、backpressure、retryability 与 circuit
  breaker
- execution request envelope validation、trace / actor / context projection 的结构校验
- deterministic capability routing gate、scope opening gate 与 query-enabled collection
  gate 中不依赖 LLM 的部分
- structured runtime dispatch，例如 projection-backed `transport_schedule_lookup`、
  `service_status_lookup`、`campus_notice_discover`、`campus_notice_get`
- runtime metrics、structured logs、audit writer、cost / token / latency accounting
  与 failure fingerprint
- transport / timeout / bridge unavailable / policy unavailable 等 fail-close response
  envelope

当前 repo-local runtime progress：

- Go shell 已拥有 execution ingress、lifecycle、explicit cancel、per-lane
  admission、metrics、OTel seam 与 execution audit backflow
- Go shell 已补齐 Go -> Python cooperative cancel signal；Python bridge 记录 active
  request id 的 cancel state，但 provider / prompt executor mid-flight stop 仍未接入
- Go shell 已落地 gate-closed structured query runtime foundation；当前仅
  `service_status_lookup` 具备 file projection fixture backed foundation，
  `transport_schedule_lookup` 仍是 typed fail-closed seam，等待 schedule contract
  讨论完成后再实现业务查询

Python semantic orchestration 长期继续负责：

- `packages/supervisor-core` 的 handoff shaping、routing policy 与 response finalization
  语义
- agent reasoning、prompt-owned clarification / answer synthesis 与 RAG grounding
- prompt stack semantic assembly 与 provider-backed structured output execution，除非后续
  profiling 证明它们是 Go runtime 稳定后的下一条瓶颈线

固定边界：

- Go runtime type 不进入 `packages/contracts`
- Go 不接管 `apps/app-api` 的 product-layer auth/session/conversation truth
- Go 不接管 ingestion、OCR、chunking、index build 或 retrieval backend 细节
- structured deterministic query service 可以迁 Go；domain-agent 仍保留 capability owner
  与 thin adapter 边界

## Capability-Neutral Routing Model

长期 execution path 固定采用：

`surface intake -> admission / guardrails -> capability routing -> specialist
handoff -> specialist-owned execution -> supervisor finalization`

固定规则：

- 顶层先判 capability family，再判 family 内部 execution path
- `requested_scope` 只属于 knowledge-family path，不是顶层所有请求共享的默认字段
- `routing clarification` 由 supervisor 拥有，`specialist clarification` 由
  specialist 拥有
- 当前 merged truth 仍可以保持“公开主路径以 knowledge 为主”，但这不表示长期入口必须 `RAG-first`

更完整的 routing / admission 分层，统一看
`docs/architecture/system/capability-routing-and-admission-architecture.md`。

## Agent Model

agent 是稳定能力边界，不等于某个底层框架对象。

当前 merged-truth 已接受的 current-truth runtime / package label：

- `rag-agent`
- `navigation-agent`

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
- 当前已完成首轮 current-truth/runtime label convergence：
  - `rag-agent`
  - `navigation-agent`
- 当前额外冻结的 forward family label 为：
  - `campus-services-agent`
  - `notice-agent`
- 当长期新增稳定 capability family 时，前向 family label 默认采用 `<domain>-agent`
- 当前 label 已与 forward family label 一致的能力边界，不再额外维护 synthetic split；如未来新增 domain
  capability，需要先冻结 family label，再决定其 package/runtime admission 形态
- 当前 shared contract seam 仍保留 `SpecialistRequest` / `SpecialistResponse` 等
  legacy DTO 名称；这些类型名暂不代表 canonical runtime vocabulary。

## Structured Runtime Families

长期上，部分校园问题不是 generic retrieval 问答，而是 projection-backed structured runtime
query。

当前已冻结的前向 family 包括：

- `campus-services-agent`
  - 承接 `transport_schedule_lookup`、`service_status_lookup`，以及 later-wave
    `contact_directory_lookup`、`service_process_lookup`
  - 详细领域边界、projection owner 与 opening gate 统一看
    `docs/architecture/domains/campus-services/architecture.md`
- `notice-agent`
  - 承接 `campus_notice_discover`、`campus_notice_get`
  - 回答 notice 发现、canonical notice 正文读取，以及 current-year miss 时的 historical
    downgrade
  - future source family 至少显式区分 public `official_web` notice-like pages 与
    restricted `campus_notices/internal_notice`
- `navigation-agent`
  - 当前 accepted runtime / package / ADR label 已统一为 `navigation-agent`
  - 可消费 transport point refs / service point refs
  - 不拥有 timetable truth 或 service-status truth
- `rag-agent`
  - 当前 accepted runtime / package label 已统一为 `rag-agent`
  - 继续承接稳定制度/流程/材料类问题，例如公费医疗报销规则、材料与办理流程

固定实现 shape：

- tool 只是 domain-agent 持有的 thin adapter
- tool 后面必须是 repo-owned internal query service，而不是 browser-facing API
- internal query service 只消费 projection / normalized truth，不在 query 时回扫 raw
  source bundle
- supervisor 负责 routing / terminal semantics，但不直接拥有这些 domain tools，也不默认通过
  `rag-agent` 代持这些 domain capability
- `current/latest/effective/current-year miss` 这类 temporal semantics 必须是
  code-owned routing / contract truth，而不是 prompt 或 retrieval 层的事后补救

projection owner 继续显式分层：

- campus services family
  - 只读 `campus_services/*` semantic-owner projection
  - timetable truth、service-status truth、contact truth 与 process truth 不回退成 generic
    RAG seam
- `campus_notice_discover`
  - 只读 source-family-aware notice discovery projection
  - public `official_web` notice-like pages 与 restricted
    `campus_notices/internal_notice` 继续先分 projection，再由 `notice-agent` 收口
- `campus_notice_get`
  - 只读 canonical notice body projection
  - 不得在 query time 拼 raw notice/source bundle 或退化成 link-only read

## Structured Runtime Opening Gate

`campus-services-agent` / `notice-agent` 的 owner package、thin
adapter 与 handoff seam 已存在，不等于这条 runtime lane 已开放。

固定规则：

- opening gate 默认保持 closed，直到 backing query implementation、release-gate
  regression / eval evidence 与 app-owned typed observability summary 同时满足
- 在 gate 仍关闭时，产品主路径只能保持当前 routing truth 或 deterministic fail-close；不得通过 stub /
  unavailable adapter 伪装成“能力已上线”
- historical downgrade 与 stable-RAG boundary 属于 opening criteria，不是后续 prompt
  polish 或 operator 文案问题
- `campus-services-agent` 的领域 opening 规则与 projection owner 细节，统一看
  `docs/architecture/domains/campus-services/architecture.md`

## RAG Family Responsibilities

`packages/rag-agent` 是当前 `rag-agent` family 的 runtime package owner；它当前与长期负责：

- knowledge-family 内部 intent / ambiguity handling
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

`agent planner -> retrieval-core executor`

其中：

- `rag-agent`
  - 当前 runtime package 是 `packages/rag-agent`
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

- `curriculum_plan` 可以按 repo truth 进入
  `course_facts`、`program_family_facts`、`program_semester_facts`
- historical / compare / freshness-sensitive branch 只能进入显式 admitted retrieval
  mode
- live retrieval 只能命中 repo-owned source channel

长期禁止：

- planner 静默打开 `offline_preparation` surface
- planner 把开放域 general web 作为 campus path 的隐藏 fallback
- executor 因为召回困难而自行切到另一个未 admission 的 collection

## Retrieval And Execution Contract

- agent 与 supervisor 通过 `packages/contracts` 交互
- retrieval / infra types 不进入 shared contract
- `ContextProjection` / `SupervisorResponse` 是当前 merged truth 的 shared seam
- future agent growth 只能在这个 seam 之后扩张
- target-state agentic retrieval 必须继续通过 typed plan / query activity / evidence
  summary seam 扩张，而不是退回 hidden prompt state

## Runtime Posture

`apps/supervisor-api` 表示 logical execution engine boundary，不代表所有 runtime code 都必须继续
留在 Python。

当前重要的是：

- transport 留在 `apps/*`
- orchestration 留在 `packages/supervisor-core`
- agent behavior 留在 agent package
- `apps/supervisor-api` 的部署 substrate 已冻结为 Docker-first internal execution service
- Docker-side Go shell owns runtime hardening: request limits, caller admission,
  in-flight lifecycle, explicit cancel, global / per-lane execution queue /
  backpressure, timeout propagation, readiness, metrics, OTel telemetry seam and
  graceful drain
- 这项冻结不改写 `app-api -> supervisor-api` contract，也不提前冻结单一 Python/HTTP
  framework
- Python `apps/supervisor-api` 只保留 private bridge worker，不再保留 repo-local
  public compatibility entry

## Prompt And Instruction Ownership

execution path 的 prompt / instruction 继续遵循 package-owned ownership：

- `packages/supervisor-core` owns supervisor role instructions、clarification /
  reject / approval / out-of-scope wording prompt families
- `packages/rag-agent` owns answer / clarify / no-answer / unsupported prompt
  families
- `packages/retrieval-core` 不拥有 top-level task prompt；只拥有 evidence retrieval 与
  serialization helper
- `apps/supervisor-api` 不拥有长期 prompt truth；只负责 request packaging 与 execution
  admission

prompt 不能替代 code-owned routing、authz、serving filter 或 fail-close terminal
semantics。

execution path 的最终 prompt stack 也固定为：

`repo-global developer invariants -> package-owned role prompt -> typed
task/evidence packet -> code-side finalization`

补充约束：

- `apps/supervisor-api` 与后续 product runtime 只负责装配与执行，不拥有新的 monolithic mega
  system prompt
- 当前 repo-default runtime assembly seam 已收口到
  `apps/supervisor-api/src/campus_supervisor_api/prompt_stack.py`；它必须把 trusted
  developer/task layers 与 untrusted user/evidence layers 分开表达
- `packages/retrieval-core` 继续只提供 evidence serialization helper，不拥有 top-level
  prompt truth
- `system prompt` 这个词在 repo 里只保留为沟通简称；真正运行时应以 developer prompt + typed packets
  表达

## Forbidden Shapes

- 不把 supervisor 重新写成被动转发层
- 不把 agent 重新降级成 `campusRAG` 式扁平 tool
- 不把 `campus-services-agent` / `notice-agent` 的 structured runtime 再塞回 generic
  RAG 或单一 mega-tool router
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
- `docs/decisions/adr-0043-supervisor-api-docker-first-runtime.md`
- `docs/decisions/adr-0042-capability-neutral-supervisor-routing-and-surface-cap
  ability-policy.md`
- `docs/architecture/system/capability-routing-and-admission-architecture.md`
- `docs/architecture/system/agentic-retrieval-architecture.md`
- `docs/architecture/system/prompt-and-instruction-architecture.md`
- `docs/reference/runtime-serving-and-index-terms.md`
