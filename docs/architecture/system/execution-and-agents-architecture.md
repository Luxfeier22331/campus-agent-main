---
doc_type: architecture
status: active
created: 2026-04-02
updated: 2026-05-07
---
# Execution And Agents Architecture

## 文档边界

本文冻结 execution engine、supervisor 与 agent supporting architecture。

它回答的是：

- `apps/supervisor-api` 与 `apps/supervisor-agent-worker` 分别负责什么
- supervisor 如何与 agent 交互
- RAG agent 与其他 domain capability family 的长期角色是什么

## Execution Chain

当前主路径遵循：

`app-api -> supervisor-api -> supervisor-agent-worker private bridge ->
agent -> retrieval-core -> evidence -> supervisor response`

已打开但仍保持 `typed_handoff_only` 的 deterministic structured capability 是这条语义链路的
例外分支：

`app-api -> supervisor-api -> Go structured runtime -> supervisor-style response`

已进入 `runtime_posture=sdk_adapter_admitted` 的 structured tool 不再被公开 answer
入口的 Go direct-runtime 抢走；它们走 Go-owned `single_handoff` plan，再由 Python
domain-agent adapter / Agents SDK shell 调用 repo-owned structured query backend。

长期目标态在同一 governance boundary 内扩展为：

`app-api -> supervisor-api -> workflow plan -> one or more domain agents ->
typed step output projections -> Go supervisor finalization`

这表示 repo 采用 supervisor-led governed multi-agent，而不是无中心 peer
agent mesh。Go `apps/supervisor-api` 保留 deterministic workflow ownership；
Python `apps/supervisor-agent-worker` 与 package-owned domain agents 承接 bounded
semantic execution。

边界固定如下：

- Go `apps/supervisor-api` 负责 Docker-side execution runtime control plane
- Python `apps/supervisor-agent-worker` 负责 private bridge worker、prompt runtime
  assembly 与默认 agent delegate map 装配；worker 内部 `AgentDispatcher` 消费
  Go preplanned `AgentRequest` handoff，并调用注入的 agent delegate
- agent 负责能力边界内的 planning / evidence consumption / answer shaping
- multi-agent path 只能通过 Go-owned `WorkflowPlan` admission 打开；agent 之间不得通过
  raw prompt transcript、raw provider trace 或 unbounded evidence dump 直接互相调用
- `packages/retrieval-core` 负责 evidence retrieval kernel、target-state retrieval
  execution 与 query activity，不负责顶层产品编排

## Supervisor Responsibilities

supervisor 长期负责：

- admission / guardrails
- capability routing
- handoff shaping
- workflow plan ownership
- allowed agent / allowed tool / step budget policy
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
- 在 prompt 内隐式决定跨 agent 协作顺序

补充约束：

- supervisor 是 neutral capability router，不是默认的 knowledge / `rag-agent` router
- `public chat` 当前 knowledge-only 只是 surface posture，不反向定义 supervisor 的长期角色
- supervisor 是 multi-agent manager，不是 peer agent；它保留最终回复 ownership，
  除非 workflow plan 显式采用 specialist handoff ownership transfer

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
- structured runtime backend dispatch，例如 projection-backed
  `transport_schedule_lookup`、`service_status_lookup`、`service_guide_lookup`、
  `academic_calendar_lookup`、`campus_notice_discover`、internal selected notice
  resolve (`payload_kind=campus_notice_get`)；公开 answer 入口是否 direct-execute 由
  ToolSpec runtime posture 决定
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
  `campus_services`、`notice` capability label，并将它们映射到
  `rag`、`navigation`、`campus_services`、`notice` lane；`requested_scope` 仍只允许
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
  knowledge follow-through 的两步链路：`notice-agent internal selected notice resolve
  (payload_kind=campus_notice_get) -> rag-agent retrieval.query`。第一步 notice
  结果会先落成 repo-owned canonical
  `StepOutputProjection`，再以有长度上限的 `notice_context` 输入第二步 RAG bridge
  payload；执行 wire 使用 `agent_request.workflow_context` 传递
  `workflow-agent-context-v1` 投影引用 envelope，只允许 `projection_refs`、required
  projection kind 与 target metadata，不携带 raw projection payload。operator / eval 可见的
  `workflow_trace_summary.context_projections` 只暴露 projection id、source step、kind、
  content hash 与 safety summary，不暴露正文 payload。
  `multi_step` 的 selected-notice admission 现已改为 planner 只输出 internal
  `CapabilityPlan`，再由 resolver 根据 artifact graph 编译实际 `WorkflowPlan`；planner 不再
  直接拼 notice -> rag 固定 step list。workflow trace summary 额外记录
  `answer_artifact_projection_ids` 与 `answer_artifact_kinds`，用于证明最终答复使用了哪些
  bounded artifact。不得把单 handoff trace 包装成 `multi_step`
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
  completed `multi_step` 至少包含两个有序 handoff step；需要 cross-step
  context 的 edge 必须声明 `required_projection_kind`，projection 缺失时 fail-closed
- Go `supervisor-api` 已落地 gate-closed structured query runtime foundation；当前
  `service_status_lookup`、`transport_schedule_lookup` 与 `service_guide_lookup`
  均通过 PostgreSQL release current pointer + typed read model 消费，
  `transport_schedule_lookup` 具备 projection-backed schedule query kernel 与
  Python thin-adapter wiring；`academic_calendar_lookup` 通过
  `calendar/academic_calendar` read model 回答教学周、节假日和补课安排事实；
  `campus_notice_discover` 具备 agent-facing notice card discovery runtime，
  `campus_notice_get` 只保留为 Go-owned internal selected notice card/context resolve
  function，不进入 provider/SDK tool surface；其
  authenticated-notice-backed offline projection builder 属于 ingestion data plane，
  产品主路由 gate 仍保持关闭
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
- Go `supervisor-api` 已拥有 non-stream 与 lifecycle SSE direct structured answer path，
  但 direct answer 只保留给 ToolSpec 中仍为 `typed_handoff_only` 的 structured
  payload。`sdk_adapter_admitted` 的 structured payload 在公开 answer / stream 入口
  进入 `single_handoff` bridge lane；Go 仍负责 opening gate、admission、
  `WorkflowPlan`、ToolSpec admission、structured query backend、fail-close envelope
  与 finalization
- Go runtime policy 当前从 `configs/runtime/intent-policy.v1.json` 加载 versioned
  intent policy artifact；artifact 固定 policy / classifier / intent schema /
  case-set version、reason code registry 与 signal group taxonomy，避免 runtime
  源码内匿名 signal list 成为第二套 classifier truth
- Go runtime policy 当前从 `configs/runtime/tools.v2.json` 加载 repo-owned ToolSpec
  registry，并由它派生 structured handoff `allowed_tools`；`retrieval.query`
  只作为 `rag-agent` 内部 retrieval step 进入 eval / observability denominator，
  不作为 Go preplanned structured handoff tool 暴露
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
  `campus_services` / `notice` 默认关闭，只有通过 `SUPERVISOR_API_OPEN_CAPABILITIES`
  显式开放后才允许进入 structured runtime；该变量只接受 `campus_services`、`notice`
  及其逗号组合，不接受 `*` / `all`
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
- structured deterministic query service 和 posture-gated direct answer path
  可以迁 Go；domain-agent 仍保留 semantic capability owner 与 thin adapter 边界

## Capability-Neutral Routing Model

长期 execution path 固定采用：

`surface intake -> admission / guardrails -> capability routing -> workflow
planning -> agent-owned execution -> Go supervisor finalization`

固定规则：

- 顶层先判 capability family，再判 family 内部 execution path
- capability family 决策之后，supervisor 可以选择 `terminal`、`direct_runtime`、
  `single_handoff` 或 admitted `multi_step` workflow
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

## Governed Multi-Agent Target

长期 multi-agent 默认采用 manager-style orchestration：

`Go supervisor-api -> WorkflowPlan -> bounded specialist agent calls ->
StepOutputProjection -> next step / finalizer`

外部 agent 框架与 Codex CLI / Agents SDK / LangGraph 等 runtime 的共同启发只作为
supporting design input：它们证明 manager-style specialist call、explicit handoff、
tool orchestration、trace 与 agent graph 都应是一等 runtime concern。repo 的 canonical
truth 仍由 `WorkflowPlan`、`AgentRequest`、`AgentResponse`、
`StepOutputProjection` 与 `workflow_trace_summary` 拥有；不得把任何 SDK-native graph、
provider trace 或框架状态提升为 shared contract。

固定 owner 如下：

- Go `apps/supervisor-api`
  - 拥有 workflow mode、allowed agents、allowed tools、step order、parallelism、
    timeout / budget、retry / replan posture、terminal fail-close policy 与 finalization
- Python `apps/supervisor-agent-worker`
  - 拥有 bounded domain-agent runtime、provider adapter、agent loop execution 与
    step-local guardrail / tool result consumption
- domain agent
  - 拥有 family 内部 reasoning、tool sequencing、clarification 与 answer shaping
- `packages/evals`
  - 拥有 multi-agent step selection、handoff correctness、context projection completeness
    与 final answer grounding 的 denominator

两种协作模式必须显式区分：

- manager-style agents-as-tools
  - 默认模式；supervisor / workflow manager 保持最终回复 ownership
  - specialist agent 只返回 bounded typed output，例如 schedule baseline、notice
    change set、place context 或 evidence bundle
- specialist handoff
  - 只在 specialist 应该接管下一轮回复 ownership 时使用
  - 必须携带显式 handoff target、allowed tools、history filter / context projection 与
    eval denominator

### AgentSpec Registry Target

长期必须有 repo-owned `AgentSpec` registry，作为 `ToolSpec` 的 agent-level 等价物。
新增或打开稳定 domain agent 时，不得只在 planner 中添加字符串 target；必须先注册
`AgentSpec` 或同等 canonical artifact。

`AgentSpec` 至少固定：

- agent id / forward family label / owner package / runtime adapter
- accepted `AgentRequest` payload kinds 与 input projection schema
- output projection schema，例如 `StepOutputProjection` family
- allowed tools 与 deterministic query functions 的边界
- context filter / history inheritance policy
- clarification ownership：routing clarification 还是 agent-owned clarification
- readiness / opening gate 与 capability lane
- timeout、budget、parallelism、retry / replan posture
- observability labels、trace projection policy 与 eval denominator

`AgentSpec` 应生成或校验：

- Go `WorkflowPlan.allowed_agents`
- Go structured planner target / payload-kind admission
- Python worker delegate map
- domain-agent adapter dispatch table
- workflow trace `AgentInvocation` projection
- `packages/evals` handoff / context / finalization denominator

### Agent Invocation Graph Target

multi-agent runtime 的 canonical lifecycle 应显式建模为：

`Turn -> WorkflowRun -> AgentInvocation -> ToolCall -> Evidence/Projection -> Finalization`

当前 `WorkflowRunStore` 与 `workflow_trace_summary` 是这条线的 foundation；后续需要补齐
agent invocation graph projection。该 projection 只保存 sanitized contract，不保存 raw
prompt、raw model response、raw provider trace、raw OCR、raw source HTML 或未裁剪附件正文。

每个 `AgentInvocation` 至少应包含：

- invocation id、parent invocation id、workflow run ref、turn / request correlation
- agent id、capability family、workflow step id、status 与 terminal reason
- input projection refs 与 context projection ids
- allowed tools / actually used tools / deterministic query functions
- output projection id、business outcome、fail-close reason
- latency / token / cost summary 的安全摘要
- source refs / evidence refs / projection hashes

这条 graph 的用途是 runtime observability、operator-safe projection、debugging 与 eval。
它不是用户可见回答内容，也不是 provider-native trace 的镜像。

跨 agent 传递内容必须使用 bounded typed artifact。推荐长期 artifact family 包括：

- `ScheduleBaseline`
- `NoticeChangeSet`
- `CanonicalNoticeContext`
- `PlaceContext`
- `ServiceGuideFacts`
- `EvidenceBundle`
- `GroundingVerdict`

这些 artifact 可以映射为 `StepOutputProjection` 或其后续版本。它们进入下一步 prompt、
workflow trace、operator projection 或 eval artifact 前，必须经过长度、来源、hash、
safety summary 与 visibility posture 裁剪。不得把 provider raw response、完整上游答案、
raw snippets、raw source HTML 或未裁剪附件 OCR dump 直接作为 cross-agent context。

### Context Projection Policy

context inheritance 必须按 agent role 最小化。supervisor 不得把完整 conversation、
完整上游 answer、完整 evidence bundle 或 raw source dump 广播给所有 agents。

默认 context projection 规则：

- `rag-agent` 只接收 query intent、scope/version frame、bounded retrieval plan context、
  upstream projection refs 与必要 evidence summary
- `campus-services-agent` 只接收 service intent、slots、campus / temporal context、
  admitted structured tool list 与 projection-backed service refs
- `notice-agent` 只接收 notice discovery/ref resolution intent、selected notice refs、
  source family / category / date filters 与 bounded notice card context
- `navigation-agent` 只接收 place / point / route intent、service point refs、transport
  stop refs 与 visibility-safe spatial context

context projection 必须记录 projection kind、source step、content hash、visibility posture、
length budget、source refs 与 safety summary。缺失 required projection 或 projection
visibility 不匹配时，workflow 必须 fail closed 或进入 clarification，不得回退到 raw
history / raw evidence prompt stuffing。

执行 wire 的 cross-agent context envelope 固定为 `AgentRequest.workflow_context`。
该 envelope 是 agent-private 的 projection-ref carrier，不是 operator summary，也不是 raw
context store。它必须携带 schema version、visibility、target、
`required_projection_kind` 与 bounded `projection_refs`；不得出现 `payload`、`raw_payload`、
`raw_context` 或 `source_body` 等 raw-key。`workflow_trace_summary.context_projections`
是 operator / eval summary，只用于重建 workflow shape、source step、projection kind、
hash 与 safety posture，不承担下游 agent prompt context 传递。

## Agent Framework / Agents SDK Boundary

agent framework 是 domain-agent 内部实现 substrate，不是 repo-level orchestration owner。

当前 accepted worker truth 是：Python `apps/supervisor-agent-worker` 的 provider-facing
semantic runtime 使用 OpenAI Agents SDK native substrate。它用来承接：

- code-first tool loop 与 handoff object modeling
- provider-native function calling adapter 与 strict function schema execution
- run / trace capture，便于投影到 repo-owned `workflow_trace_summary`
- agent 内部 guardrail / approval checkpoint 的实现 ergonomics
- resumable state 或 next-turn surface 的局部实现

官方 Agents SDK 的当前 primitive 与 repo 边界对齐方式固定如下：

- `Agent` / `Runner` / function tools 可以替代 Python 内部手写 tool loop glue
- agents-as-tools 可以用于一个 admitted domain-agent step 内部的 bounded specialist call
- SDK handoff 只作为实现 substrate；repo-level handoff truth 仍是 Go `WorkflowPlan`
- SDK guardrails 可以作为内部 input / output / function-tool validation，但 repo-owned authz、
  ToolSpec、evidence grounding 与 finalizer guardrail 仍是 release acceptance owner
- SDK tracing 是 debug / evaluation input；默认不得把 raw provider transcript、prompt、
  tool payload、handoff graph 或 trace dump 写入 repo shared contract、panel、eval canonical
  fixture 或 public response

框架级 handoff / agents-as-tools 的使用必须服从 repo-owned workflow plan：

- 默认优先采用 agents-as-tools / manager-style bounded specialist calls，让 Go
  supervisor 保持最终回复 ownership
- 只有当某个 specialist 的 instructions、tools、policy 或 next-turn state 必须接管用户回复时，
  才采用 explicit handoff
- 框架生成的 run state、handoff trace、tool schema 与 raw model output 只能作为内部
  debug / adapter input；对外仍以 repo-owned `AgentResponse`、`StepOutputProjection`
  与 `workflow_trace_summary` 为准

但它不能替代以下 repo-owned truth：

- Go `apps/supervisor-api` 的 deterministic runtime kernel、admission、routing policy、
  posture-gated direct structured runtime branch、fail-close envelope 与 finalization
- `apps/app-api` 的 surface capability policy、auth/session/principal、conversation、
  request projection 与 operator read model
- `packages/contracts` 的 `AgentRequest` / `AgentResponse` seam
- `packages/evals` 的 case truth、workflow trace artifact、release verdict 与 observed
  regression lifecycle
- source-truth / projection-backed structured query service 的 data-plane truth

当前 Agents SDK 路径固定为 SDK-native worker runtime：

`Go supervisor-api -> AgentRequest -> Python SDK-backed domain agent -> AgentResponse
-> Go finalization`

SDK run / trace 只能作为内部 trace/debug input；进入 app-api / panel / eval 的内容必须先
经过 repo-owned sanitized projection。不得把 SDK-native agent graph、tool schema 或 provider
trace 直接写入 shared contracts。

Provider-native function calling 的默认接入点同样只能在 domain-agent 内部。它不能替代 Go
`apps/supervisor-api` 的 `allowed_tools`、tool admission、opening gate、runtime policy
或 fail-close finalization。Python adapter 只能把 Go handoff 中已经允许的 tool 子集编译成
provider function schema，并把 tool output 先收敛为 repo-owned typed result，再返回
`AgentResponse`。

### Agents SDK Admission Order

SDK runtime 不是 repo-wide owner。后续新增 surface 按以下顺序 admission：

1. Read-only structured domain-agent tools：必须先有 ToolSpec / Go runtime policy / eval
   denominator，然后由 worker 将 `AgentRequest.allowed_tools` 编译为 SDK function tools。
1. RAG-internal semantic loop：只能消费 `rag-agent` deterministic planner/retrieval 之后的
   bounded evidence projection；`retrieval.query` 继续保持 agent-internal / closed。
   RAG SDK loop 如果需要 provider/SDK function surface，只能使用
   `runtime_posture=sdk_internal_admitted` 的 internal function，例如
   `retrieve_evidence`，并且该 function 不进入 Go `allowed_tools` 或
   structured handoff denominator。
1. Multi-step workflow step internals：SDK 只能实现 Go `WorkflowPlan` 已 admission 的
   step。Python bridge 必须校验 `runtime_decisions.workflow_plan` 与
   `AgentRequest.workflow_context`，不能生成或改写全局 workflow plan。
1. Offline notice multimodal / media review：只能作为 ingestion-side processing adapter，
   产出 normalized fact/classification projection，不进入 public query-time tool surface。

不进入默认扩展范围：

- hosted web search / file search / code interpreter / remote MCP / shell /
  filesystem tools
- raw SQL、object-store、collector、OCR dump、index build 或 ingestion write
  query-time tools
- SDK-native session memory 作为产品 conversation truth
- SDK-native tracing export，除非有单独 redaction/exporter gate
- 预约、提交、支付、工单等 state-changing tool

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

## Tool And Function Calling Target

长期 tool use 采用 application-owned orchestration：

`Go supervisor-api -> ToolSpec / allowed_tools -> domain-agent tool loop ->
thin adapter -> internal query service -> sanitized AgentResponse -> Go finalization`

固定 owner 如下：

- `apps/supervisor-api`
  - 拥有 deterministic tool admission、capability / lane / scope / version guard、
    opening gate、workflow plan、max-call / timeout posture、fail-close terminal
    semantics 与 low-cardinality observability labels
- domain-agent
  - 拥有 family 内部的 tool sequencing、agent clarification、provider-native
    function calling adapter、typed result consumption 与 answer shaping
- thin adapter
  - 只负责 function arguments 到 repo-owned request DTO 的 glue code，不拥有业务
    policy、不读 raw source、不自行扩大权限
- internal query service / retrieval-core
  - 负责读取 projection、read model、canonical artifact 或 retrieval index，并返回
    typed result
- `packages/evals`
  - 拥有 tool selection、argument precision、no-tool correctness、fail-close
    correctness、tool result usage 与 hallucinated tool prevention 的 denominator

当前 `ToolSpec` registry 位于 `configs/runtime/tools.v2.json`，是 repo-owned callable
truth 的 canonical artifact，而不是 scattered runtime 常量。`surface` 决定它是
agent-facing `structured_handoff`，还是只能在 agent 内部使用的
`agent_internal` function。`function_schema` 表示该 callable 是否可以生成 strict
provider / SDK function schema；`runtime_posture` 才表达它是 `sdk_adapter_admitted`、
`sdk_internal_admitted`、`closed` 或其他 repo-owned admission posture。schema 可用不等于
runtime 已开放，也不等于可以进入 Go `allowed_tools`。

它至少约束：

- tool name、owner agent、capability family 与 payload kind
- request / result schema refs
- read-only / state-changing posture
- opening gate、allowed surface、source-truth owner 与 query service owner
- timeout、max result size、parallel-call policy 与 retry / replan budget
- argument summary policy 与 result projection policy
- business outcome、fail-close reason 与 observability labels
- eval denominator 与 provider function schema generation policy

Provider-native function calling 只能由 ToolSpec 生成的 strict schema 驱动。agent framework
或 provider SDK 可以承担调用循环、arguments validation ergonomics 与 trace capture，但 trace
进入 app-api、panel、eval 或 workflow summary 前必须经过 repo-owned bounded projection。
面向 domain-agent handoff 的 provider/SDK tool bridge 只能接收 `structured_handoff`
surface；RAG 这类内部 SDK loop 只能接收显式 `sdk_internal_admitted` 的
`agent_internal` function。

并行 tool / agent fanout 默认由 Go `WorkflowPlan` 显式表达，而不是交给 provider 在单轮
function calling 中自由并发。provider-native parallel tool call 只有在 ToolSpec、
runtime_posture、eval denominator 与 result merge policy 都明确允许时才可打开；否则
domain-agent adapter 应保持 single-call loop 或 serial loop。

当前 Python worker 只保留一条 structured domain-agent substrate：ToolSpec 驱动的 Agents
SDK shell 加 package-owned SDK executor。不存在并行的 repo-owned provider function-call
loop，也不存在 direct online adapter fallback。内部 deterministic query function，例如
selected notice resolve/context，不能因为存在 DTO/schema 就进入 structured handoff tool
loop。缺失 admission、wrong tool、非对象 arguments、schema 不存在、SDK 运行时缺失或 query
service failure 都必须转成结构化 `AgentResponse` fail-close，而不是穿透为 bridge 500。sanitized
trace/projection 可以记录 provider correlation，但 raw provider response 不进入
`AgentResponse`、workflow trace、panel 或 eval canonical surface。

Agents SDK 当前不承载 `campus_notice_get`。`campus_notice_get` 保持 notice-agent internal
resolve runtime seam；它不是 structured handoff tool，也不是 provider/SDK function tool。
当前已接纳的 SDK adapter tools 是
`campus_notice_discover`、`service_status_lookup`、
`service_guide_lookup`、`transport_schedule_lookup`、
`contact_directory_lookup`、`academic_calendar_lookup` 与
`campus_notice_change_set_lookup`。其中
`service_status_lookup` 与 `transport_schedule_lookup`
在公开 answer / stream 入口同样走 `single_handoff` bridge lane；SDK shell 只承接
agent-side argument completion / tool loop，projection-backed structured query、
temporal policy、source truth、Go opening gate/admission、ToolSpec gate 与 Go
finalization 仍由 repo-owned runtime 承担。SDK runtime 默认开启；
provider、model、API key 或 SDK dependency 缺失时 readiness 降级并 fail closed。唯一 runtime
开关是 `SUPERVISOR_AGENTS_SDK_RUNTIME_ENABLED=false`；target/tool eligibility 由
repo-owned AgentSpec、ToolSpec 与 Go handoff `AgentRequest.allowed_tools` 派生，不能再通过
worker env 维护第二套 target/tool allowlist。SDK `FunctionTool` surface 只能由
repo-owned ToolSpec 派生；SDK run / trace / native state 不得进入
`packages/contracts`、panel、eval 或 `workflow_trace_summary`。缺 provider、model、
API key 或 SDK dependency 时只能返回稳定 fail-close 结果或 degraded readiness，不得恢复旧
provider loop 或 non-SDK answer fallback。

`rag-agent` 的 Agents SDK 接入是 SDK-native RAG synthesis runtime，不属于 ToolSpec
structured handoff。它的内部 function 仍必须由 ToolSpec 注册与校验，但不得进入
structured handoff allowed-tools。它固定遵循：

- `retrieval.query` 保持 `agent_internal` / `closed`，不开放为 public ToolSpec、
  provider tool 或 Go preplanned structured handoff tool
- `retrieve_evidence` 是 `agent_internal` / `sdk_internal_admitted` 的 SDK internal
  function，只返回已 admission 的 bounded evidence anchors；它不是用户意图级 tool，也不是
  Go preplanned structured handoff tool
- Go supervisor 仍拥有 admission、capability routing、workflow plan、opening gate 与
  finalization；SDK 只承接 Python `rag-agent` 内部 semantic synthesis loop
- `packages/rag-agent` 只定义 SDK-neutral `RagSdkRunRequest`、bounded evidence
  projection、claim/list-item support 与 sanitized trace projection；官方 SDK import
  保留在 `apps/supervisor-agent-worker`
- SDK `FunctionTool` 只能读取 planner 已产生的 deterministic query slot 和 bounded evidence
  anchors；模型不能提供 corpus、collection、authz filter、target document ids、version ids、
  revision track、top-k 或 serving surface
- accepted SDK output 必须把每个 factual claim 或 list item 绑定到返回 evidence 中的
  `source_id + chunk_id + excerpt + span_ref`；source-id-only citation 不足以完成回答
- native SDK tracing 默认关闭，进入 RAG diagnostics / observability 的只能是
  repo-owned sanitized projection；raw prompt、raw transcript、raw provider response、
  SDK run state 与 raw evidence dump 不得出现在 shared contracts、panel、
  workflow trace 或 eval canonical artifact
- RAG query-enabled answer path 不再保留 `closed` / `candidate` / `shadow` /
  `fallback_only` rollout runtime；SDK runtime unavailable 时 fail closed，不回退到旧
  deterministic answer synthesis

notice-family 的目标态需要把 agent-facing tool 与内部 query function 分开。通知用户面默认
是 source-link / card-first：`title`、official URL、source family、发布时间、短摘要或
匹配原因可以进入 answer/card；canonical body、OCR owner text、inline image text 与附件正文
只作为 source-truth、内部 context、下游 materialization、bounded summary 或 fact extraction
输入，不作为默认 public answer 全文输出。`campus_notice_discover` 是合理的
agent-facing tool，因为它表达“找通知”这个用户意图；按 notice id 取 card、取 bounded
context、读取 media / OCR owner text 更适合作为 notice-agent 或 Go internal query
service 的 deterministic query function。若后续保留或改造 `campus_notice_get`，目标语义也必须从
“fetch body”重切为 selected notice ref/card/context resolution，并带 display policy 与
finalizer guard。

当前 workflow trace 的 tool call summary 已显式记录：

- `workflow_run_ref`
- step id
- `tool_call_id`
- tool name / owner agent
- sanitized argument summary
- result status / business outcome
- fail-close reason
- source refs 或 result hash
- bounded result projection posture；raw tool result 不进入该 summary
- provider tool loop correlation：repo-owned `tool_call_id` 仍是主 ID，provider
  `call_id` / response id 只作为 sanitized `provider_tool_call_projection` 出现在
  workflow trace 中，用于 debugging 与 eval，不替代 repo-owned lifecycle id

runtime observability、audit 与 eval 统一使用 repo-owned correlation id：

- request / trace correlation：`request_id`、incoming trace context 与低基数 lane /
  capability / workflow mode label
- workflow correlation：`workflow_run_ref` / run id、step id、`AgentInvocation`
  id 与 parent invocation id
- tool correlation：repo-owned `tool_call_id`、tool name、owner agent、business
  outcome、fail-close reason 与 bounded result projection posture
- projection / evidence correlation：`projection_id`、projection kind、content hash、
  source refs / evidence refs 与 freshness / effective window where applicable
- provider correlation：provider response id / call id 只能作为 sanitized auxiliary
  projection；raw prompt、raw response、raw source body 与 source object bytes 不进入
  OTel span attributes、audit event、workflow trace、panel 或 eval canonical asset

默认禁止：

- 模型看到全局工具全集后自由选择工具
- provider-native remote MCP / built-in web search 作为 campus answer-bearing fallback
- raw SQL、raw object-store read、collector live crawl、ingestion write 或 index build
  暴露成 query-time tool
- state-changing tool 在没有 approval / HITL / audit / rollback / eval contract 时进入
  public chat 主路径
- tool output 未裁剪就进入 prompt、workflow trace、panel 或 eval canonical asset

当前 admitted SDK adapter surface 还需要区分两种执行语义，并在 safe observability 中显式记录：

- `sdk_mediated_answer_shaping`
  - 代表工具返回的是 bounded source-backed material，SDK shell 负责把它改写成用户可读回答
  - 当前包括 `campus_notice_discover` 与 `service_guide_lookup`
- `deterministic_lookup_sdk_finalization`
  - 代表 projection/read-model 已完成事实查找，SDK shell 只负责轻量 final wording，不负责补推理
  - 当前包括 `service_status_lookup`、`transport_schedule_lookup`、
    `contact_directory_lookup` 与 `academic_calendar_lookup`

对应的 repo-owned instruction profile / result usage mode 也必须显式分层，而不是把所有 admitted
surface 折叠成同一个 generic campus-services prompt。至少应保留：

- notice card listing
- source-backed guidance
- service status fact
- transport schedule fact
- contact directory fact
- academic calendar fact

## Structured Runtime Families

长期上，部分校园问题不是 generic retrieval 问答，而是 projection-backed structured runtime
query。

当前已冻结的前向 family 包括：

- `campus-services-agent`
  - 承接 `transport_schedule_lookup`、`service_status_lookup` 与
    `service_guide_lookup`、`contact_directory_lookup`、`academic_calendar_lookup`，以及
    later-wave `service_process_lookup`
  - `service_guide_lookup` 只回答只读办理指南、材料、入口说明、服务时间、联系方式与来源引用；
    不执行申请、预约、提交、代办、支付、工单创建或任何状态变更
  - 详细领域边界、projection owner 与 opening gate 统一看
    `docs/architecture/domains/campus-services/architecture.md`
  - `academic_calendar_lookup` 回答第几教学周、学期日期窗口、节假日安排与
    补课/调休上课安排等校历事实
  - `academic_calendar_lookup` 只读 `calendar/academic_calendar` projection /
    typed read model；不查询 raw 官网页面、不回退 generic RAG，也不负责
    “校历怎么看 / 校历在哪里看”这类入口说明
  - `academic_calendar_lookup` 的 contract 显式携带 `query_kind`、
    `event_query`、`target_date`、`term_label` 等 normalized query fields；
    trusted execution anchor 仍由服务端解析并通过 `queried_time_anchor`
    返回，不接受客户端自由写入 `time_anchor`
  - “校历怎么看 / 校历在哪里看”仍属于 `service_guide_lookup` 的只读指南边界
- `notice-agent`
  - 承接 `campus_notice_discover`、selected notice ref resolution、official source card
    rendering 与 bounded notice context projection
  - 回答 notice 发现、候选消歧、官方链接回链、短摘要/事实抽取所需的内部 context，以及
    current-year miss 时的 historical downgrade
  - 不作为默认正文阅读器；canonical notice body / OCR owner text 不得直接进入用户面全文输出
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
- academic calendar lookup data plane
  - 只读 `calendar/academic_calendar` semantic-owner projection
  - teaching-week、holiday 与 makeup-class truth 不回退成 service-guide 或 generic
    RAG seam
- `campus_notice_discover`
  - 只读 source-family-aware notice discovery projection
  - public `official_web` notice-like pages 与 restricted
    `campus_notices/internal_notice` 继续先分 projection，再由 `notice-agent` 收口
- `campus_notice_get`
  - 只作为 internal selected notice card/context resolve function
  - 默认返回 official URL、display policy、bounded summary / facts 和 provenance refs
  - 不得进入 provider/SDK tool surface，也不得把 full body 拼入 public answer

## Structured Runtime Opening Gate

`campus-services-agent` / `notice-agent` 的 owner package、thin adapter 与
handoff seam 已存在，不等于这条 runtime lane 已开放。

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
