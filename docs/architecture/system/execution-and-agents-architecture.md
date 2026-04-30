---
doc_type: architecture
status: active
created: 2026-04-02
updated: 2026-04-30
---
# Execution And Agents Architecture

## 文档边界

本文冻结 execution engine、supervisor 与 agent supporting architecture。

它回答的是：

- `apps/supervisor-api` 与 `apps/supervisor-agent-worker` 分别负责什么
- supervisor 如何与 agent 交互
- RAG agent 与其他 domain capability family 的长期角色是什么

## Execution Chain

当前与长期都遵循：

`app-api -> supervisor-api -> supervisor-agent-worker private bridge ->
agent -> retrieval-core -> evidence -> supervisor response`

已打开的 deterministic structured capability 是这条语义链路的例外分支：

`app-api -> supervisor-api -> Go structured runtime -> supervisor-style response`

边界固定如下：

- Go `apps/supervisor-api` 负责 Docker-side execution runtime control plane
- Python `apps/supervisor-agent-worker` 负责 private bridge worker、prompt runtime
  assembly 与默认 agent delegate map 装配；worker 内部 `AgentDispatcher` 消费
  Go preplanned `AgentRequest` handoff，并调用注入的 agent delegate
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

当前语言切分下，deterministic admission / routing / handoff projection 与
`AgentResponse -> SupervisorResponse` finalization 由 Go `apps/supervisor-api`
拥有；Python `apps/supervisor-agent-worker` 只装配 agent delegates 并执行 private
agent dispatch。

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
  `service_status_lookup`、`service_guide_lookup`、
  `campus_notice_discover`、`campus_notice_get`
- runtime metrics、structured logs、audit writer、cost / token / latency accounting
  与 failure fingerprint
- transport / timeout / bridge unavailable / policy unavailable 等 fail-close response
  envelope

当前 repo-local runtime progress：

- Go `supervisor-api` 已拥有 execution ingress、lifecycle、explicit cancel、per-lane
  admission、bridge circuit breaker、bounded bridge transport retry、metrics、OTel seam
  与 execution audit backflow
- Go `supervisor-api` 已补齐 Go -> Python cooperative cancel signal；Python bridge
  记录 active request id 的 cancel state，默认 supervisor orchestration 已在路由、
  RAG prompt execution 和 agent delegation checkpoints 观测取消；provider /
  prompt executor 已进入阻塞 HTTP 调用时仍不承诺 hard-abort
- Go `supervisor-api` 的 execution envelope 已接受 `knowledge`、`place_lookup`、
  `campus_services`、`notice` capability label，并将它们映射到 `rag`、
  `navigation`、`campus_services`、`notice` lane；`requested_scope` 仍只允许
  knowledge path 使用
- Go `supervisor-api` 已拥有 deterministic effective capability / lane inference：
  当 caller 未显式传 `requested_capability` 时，常见地点、校车/班车、通知/公告/公示
  与 knowledge-family 请求会先被归入对应 runtime lane；versioned / scoped
  knowledge 请求仍保持 knowledge path；capability inference、runtime policy 与
  structured handoff planner 共用 `configs/runtime/intent-policy.v1.json` 作为 signal
  taxonomy 单一来源
- Go `supervisor-api` 已拥有 private bridge v6 canonical request projection：
  Python bridge hardcut 到 `supervisor_bridge_v6`，缺失 Go-owned
  `effective_capability` / `lane` / `runtime_decisions` 时 fail-closed；
  Python worker 不再重复做 capability keyword inference
- `app-api -> supervisor-api -> supervisor-agent-worker` 的 execution / bridge wrapper
  由 `docs/contracts/schemas/supervisor-execution.openapi.yaml` 作为 OpenAPI 3.1.1
  canonical schema，并生成 TS / Go / Python runtime artifact；`packages/contracts`
  只承载 stable `AgentRequest` / `AgentResponse` handoff schema
- execution wrapper 当前采用 strict wire policy：internal seam 固定 `snake_case`、
  不接受 camelCase 或未知 top-level wrapper 字段；共享 valid / invalid fixture matrix
  必须同时被 Python bridge、Go runtime 与 TypeScript app-api adapter 消费
- Go finalizer 是 terminal response invariant owner：delegate branch 必须有 matching
  handoff target，`selected_target` 必须与 handoff 一致，`runtime_versions`
  必须携带 bridge / response / runtime decision / workflow trace provenance；
  cancel / timeout / bridge unavailable 必须保留 typed fail-close reason
- `workflow_trace_summary.workflow_mode` 是 execution wrapper 的 canonical enum，当前固定为
  `terminal`、`direct_runtime`、`single_handoff`、`multi_step`。`terminal` 表示未进入
  agent/tool execution 的终局裁决，`direct_runtime` 表示 Go-owned projection-backed
  structured runtime，`single_handoff` 表示 supervisor 只委派给一个 domain-agent。
  `multi_step` 已有 gated runtime path，但默认关闭；当前只覆盖 selected notice context +
  knowledge follow-through 的两步链路：`notice-agent campus_notice_get -> rag-agent
  retrieval.query`。第一步 notice 结果会先落成 repo-owned canonical
  `StepOutputProjection`，再以有长度上限的 `notice_context` 输入第二步 RAG bridge
  payload；operator / eval 可见的 `workflow_trace_summary.context_projections`
  只暴露 projection id、source step、kind、content hash 与 safety summary，不暴露正文 payload。
  不得把单 handoff trace 包装成 `multi_step`
- `runtime_decisions.workflow_plan` 是 Go planner 的 canonical safe projection，当前
  `schema_version=workflow-plan-v1`，用于显式记录 `single_handoff` plan、step kind、
  selected target / payload kind / allowed tools、terminal policy、resume policy 与
  semantic retry policy。`runtime_decisions.handoff.agent_request` 仍是 bridge 真实
  `AgentRequest`；`workflow_plan` 不复制完整 payload，也不替代 bridge request
- `apps/supervisor-api/internal/execution` 已有 repo-owned `WorkflowRunStore`
  接口、in-memory 实现与 PostgreSQL backend，用于约束 run id、state、step timeline
  与 handoff chain、context projections 的内部 run-state shape。生产打开 `multi_step` 必须配置
  `SUPERVISOR_API_WORKFLOW_RUN_DATABASE_URL` 并安装 `runtime.workflow_runs` schema；
  `SUPERVISOR_API_WORKFLOW_RUN_AUTO_MIGRATE=true` 只适合 local/dev 或明确允许启动迁移的环境。
  completed `multi_step` 至少包含两个有序 handoff / tool execution step；需要 cross-step
  context 的 edge 必须声明 `required_projection_kind`，projection 缺失时 fail-closed
- Go `supervisor-api` 已落地 gate-closed structured query runtime foundation；当前
  `service_status_lookup`、`transport_schedule_lookup` 与 `service_guide_lookup`
  均通过 PostgreSQL release current pointer + typed read model 消费，
  `transport_schedule_lookup` 具备 projection-backed schedule query kernel 与
  Python thin-adapter wiring；`campus_notice_discover` / `campus_notice_get`
  具备 Go-owned PG read-model + S3-compatible canonical body query runtime 与
  Python notice-agent HTTP thin-adapter wiring；其 authenticated-notice-backed
  offline projection builder 属于 ingestion data plane，产品主路由 gate 仍保持关闭
- Go `supervisor-api` 已拥有 deterministic delegate handoff planner，bridge v6
  通过 `runtime_decisions.handoff.agent_request` 传递完整
  `AgentRequest`、target、allowed tools 与 planning outcome；Python worker 只消费
  Go handoff，不再在 Python query time 构造 RAG / navigation / 校车 /
  service status / notice payload
- planner 实现边界在 `apps/supervisor-api/internal/structuredplanning`；
  `apps/supervisor-api/internal/execution` 只负责 request projection 与 bridge v6
  `runtime_decisions` 适配；planner 不再维护独立 signal taxonomy，只消费 Go
  runtime policy artifact 与 typed request
- Go `supervisor-api` 已拥有 deterministic runtime policy foundation；当前实现位于
  `apps/supervisor-api/internal/runtimepolicy`，bridge v6 delegate 请求传递
  `scope_gate`、`policy_gate`、`context_preflight`、`tool_policy`、`routing_frame` 与
  `handoff`。Python bridge 对缺失 Go-owned routing frame / delegate handoff 的 v6
  请求 fail-closed，不再在 bridge 主路径重新做 product-scope、approval-required、
  context-follow-up 或 terminal 裁决；non-delegate terminal routing 由 Go direct
  terminal path 返回
- Go `supervisor-api` 已拥有 non-stream 与 lifecycle SSE direct structured answer path：
  `campus_services` / `notice` opening gate 放行后的
  deterministic structured payload 可直接调用 Go structured runtime，并由 Go shape
  supervisor-style response；Python bridge 不再是这些 opened structured payload 的必经
  runtime hop
- Go runtime policy 当前从 `configs/runtime/intent-policy.v1.json` 加载 versioned
  intent policy artifact；artifact 固定 policy / classifier / intent schema /
  case-set version、reason code registry 与 signal group taxonomy，避免 runtime
  源码内匿名 signal list 成为第二套 classifier truth
- Go runtime policy 已显式区分 previous-goal follow-up、selected notice follow-up 与
  curriculum slot follow-up；缺上下文进入 routing clarification，多候选 previous-goal
  进入 ambiguous clarification，而不是继续让 prompt 或 Python fallback 猜测
- Go runtime policy 已对显式 `campus_services` 但无法规划为
  `transport_schedule_lookup` / `service_status_lookup` 的 subtype 返回
  `structured_subtype_missing` clarification，避免 delegate + nil handoff 进入 Python
  bridge
- Go `supervisor-api` 已把 runtime policy decision summary 纳入内部观测口径：
  `/metrics` 只用低基数 label 发布 `scope_gate`、`policy_gate`、
  `context_preflight`、`routing_next_action`、`planning_outcome`、selected target /
  tool、terminal outcome 与 fail-close reason；OTel 与 execution audit 同步携带这些安全摘要，
  不携带 raw `user_goal` 或 prompt/provider payload
- Go `supervisor-api` 已拥有 bridge response finalization：Python bridge 只返回
  `AgentResponse`，Go finalizer 统一生成 public `SupervisorResponse` 与
  response-level observability；Python legacy `policy.py` / `response.py` 已删除
- Standalone Python `packages/supervisor-core` 已退役；剩余
  `AgentDispatcher` / `dispatch_agent_request` 已内联到
  `apps/supervisor-agent-worker`，默认 agent delegate map 由 worker runtime
  assembly 装配
- Go `supervisor-api` 已拥有 query-enabled scope admission；当前 allowlist 来自
  `configs/runtime/query-serving-scopes.v1.json`，并通过 drift test 与 ingestion
  runtime profile 的 `query_enabled_by_default=true` 保持一致。disabled knowledge
  scope 在进入 Python bridge 前返回 `403 disallowed_knowledge_scope`
- Go `supervisor-api` 已拥有 structured runtime opening gate：
  `campus_services` / `notice` 默认关闭，只有通过
  `SUPERVISOR_API_OPEN_CAPABILITIES` 显式开放后才允许进入 structured runtime；该变量只接受
  `campus_services`、`notice` 或 `campus_services,notice`，不接受 `*` / `all`
- `place_lookup` / navigation 继续 fail-close，等待地图产品上线后再进行 serving admission
  wildcard；关闭时 non-stream request 返回 `503 structured_runtime_closed`，
  lifecycle stream 返回 terminal `execution.failed`
- Go `supervisor-api` 已拥有 prompt config admission summary：
  `/readyz` 发布 Go-owned `prompt_config_gate`；Python worker 继续实际创建
  provider client / prompt executor，只上报 executor admission 与 HTTP pool health

Python semantic orchestration 长期继续负责：

- `apps/supervisor-agent-worker` 的 private agent dispatch checkpoint
- agent reasoning、prompt-owned clarification / answer synthesis 与 RAG grounding
- RAG prompt stack semantic assembly 与 provider-backed structured output execution，除非
  后续 profiling 证明它们是 Go runtime 稳定后的下一条瓶颈线
- Python bridge 不再拥有本地 supervisor audit JSONL writer；execution audit writer /
  backflow 属于 Go `apps/supervisor-api`
- Python bridge readiness 只报告 `prompt_runtime`、`prompt_http_pool` 与 minimal
  `worker_runtime`；execution lifecycle / cancel counters / runtime truth 由 Go
  `apps/supervisor-api` 发布

固定边界：

- Go runtime type 不进入 `packages/contracts`
- execution wrapper schema 不进入 `packages/contracts`；只以
  `docs/contracts/schemas/supervisor-execution.openapi.yaml` 及生成物约束跨语言 wire
  shape
- Go 不接管 `apps/app-api` 的 product-layer auth/session/conversation truth
- Go 不接管 ingestion、OCR、chunking、index build 或 retrieval backend 细节
- structured deterministic query service 和 opened direct answer path 可以迁 Go；
  domain-agent 仍保留 semantic capability owner 与 thin adapter 边界

## Capability-Neutral Routing Model

长期 execution path 固定采用：

`surface intake -> admission / guardrails -> capability routing -> agent
handoff -> agent-owned execution -> Go supervisor finalization`

固定规则：

- 顶层先判 capability family，再判 family 内部 execution path
- `requested_scope` 只属于 knowledge-family path，不是顶层所有请求共享的默认字段
- `routing clarification` 由 supervisor 拥有，`agent clarification` 由 agent 拥有
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
- 当前 shared contract seam 使用 `AgentRequest` / `AgentResponse` 作为 private
  bridge 的 canonical DTO 名称。

## Agent Framework / Agents SDK Boundary

agent framework 是 domain-agent 内部实现 substrate，不是 repo-level orchestration owner。

Agents SDK 可以作为后续 Python `apps/supervisor-agent-worker` / domain-agent 的 adapter
候选，用来补齐：

- code-first tool loop 与 handoff object modeling
- run / trace capture，便于投影到 repo-owned `workflow_trace_summary`
- agent 内部 guardrail / approval checkpoint 的实现 ergonomics
- resumable state 或 next-turn surface 的局部实现

但它不能替代以下 repo-owned truth：

- Go `apps/supervisor-api` 的 deterministic runtime kernel、admission、routing policy、
  direct structured runtime branch、fail-close envelope 与 finalization
- `apps/app-api` 的 surface capability policy、auth/session/principal、conversation、
  request projection 与 operator read model
- `packages/contracts` 的 `AgentRequest` / `AgentResponse` seam
- `packages/evals` 的 case truth、workflow trace artifact、release verdict 与 observed
  regression lifecycle
- source-truth / projection-backed structured query service 的 data-plane truth

如果引入 Agents SDK，默认路径是 adapter/spike lane：

`Go supervisor-api -> AgentRequest -> Python SDK-backed domain agent -> AgentResponse
-> Go finalization`

SDK run / trace 只能作为内部 trace/debug input；进入 app-api / panel / eval 的内容必须先
经过 repo-owned sanitized projection。不得把 SDK-native agent graph、tool schema 或 provider
trace 直接写入 shared contracts。

引入 SDK 或其他 agent framework 之前，repo-owned workflow runtime 仍需继续补齐：

- resumable workflow state：当前已有 PostgreSQL `WorkflowRun` backend 与 readiness gate，
  但还没有可恢复 resume token / replay protocol
- semantic retry/replan 计数与 policy execution，而不是只在 `WorkflowPlan` 中声明
  `semantic_retry_policy`
- broader `multi_step` admission denominator：当前只开放 selected notice context + knowledge
  follow-through 的两步链路；新增链路必须先补 handoff chain fixture、store invariant 与
  sanitized `workflow_trace_summary.context_projections` projection
- eval denominator：继续覆盖 resume、semantic retry/replan、agent-owned clarification
  与 fail-close provenance，避免把固定两步链路误当完整通用 agent graph

## Structured Runtime Families

长期上，部分校园问题不是 generic retrieval 问答，而是 projection-backed structured runtime
query。

当前已冻结的前向 family 包括：

- `campus-services-agent`
  - 承接 `transport_schedule_lookup`、`service_status_lookup` 与
    `service_guide_lookup`、`contact_directory_lookup`，以及 later-wave
    `service_process_lookup`
  - `service_guide_lookup` 只回答只读办理指南、材料、入口说明、服务时间、联系方式与来源引用；
    不执行申请、预约、提交、代办、支付、工单创建或任何状态变更
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
- private agent dispatch checkpoint 留在 `apps/supervisor-agent-worker`
- agent behavior 留在 agent package
- `apps/supervisor-api` 的部署 substrate 已冻结为 Docker-first internal execution service
- Docker-side Go `supervisor-api` owns runtime hardening: request limits, caller
  admission, in-flight lifecycle, explicit cancel, global / per-lane execution
  queue / backpressure, bridge circuit breaker, timeout propagation, readiness,
  metrics, OTel telemetry seam and graceful drain
- 这项冻结不改写 `app-api -> supervisor-api` contract，也不提前冻结单一 Python/HTTP
  framework
- Python `apps/supervisor-agent-worker` 只保留 private bridge worker，不再保留 repo-local
  public compatibility entry

## Prompt And Instruction Ownership

execution path 的 prompt / instruction 继续遵循 package-owned ownership：

- `packages/rag-agent` owns answer / clarify / no-answer / unsupported prompt
  families
- `packages/retrieval-core` 不拥有 top-level task prompt；只拥有 evidence retrieval 与
  serialization helper
- `apps/supervisor-agent-worker` 不拥有长期 prompt truth；只负责 semantic runtime
  assembly 与 provider-backed execution adapter

当前实现中，supervisor deterministic terminal wording 已由 Go direct terminal path
承接；Python worker 不再维护 production supervisor terminal prompt family。

prompt 不能替代 code-owned routing、authz、serving filter 或 fail-close terminal
semantics。

当前仍进入 provider 的 RAG prompt stack 固定为：

`repo-global developer invariants -> package-owned role prompt -> typed
task/evidence packet -> Go-side supervisor finalization`

补充约束：

- `apps/supervisor-agent-worker` 与后续 product runtime 只负责装配与执行，不拥有新的
  monolithic mega system prompt
- 当前 repo-default runtime assembly seam 已收口到
  `apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/prompt_stack.py`；它必须把
  trusted developer/task layers 与 untrusted user/evidence layers 分开表达
- `packages/retrieval-core` 继续只提供 evidence serialization helper，不拥有 top-level
  prompt truth
- `system prompt` 这个词在 repo 里只保留为沟通简称；真正运行时应以 developer prompt + typed packets
  表达

## Forbidden Shapes

- 不把 supervisor 重新写成被动转发层
- 不把 agent 重新降级成 `campusRAG` 式扁平 tool
- 不把 `campus-services-agent` / `notice-agent` 的 structured runtime 再塞回 generic
  RAG 或单一 mega-tool router
- 不把 retrieval implementation 细节塞回 `apps/supervisor-agent-worker`
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
