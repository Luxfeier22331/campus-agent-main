---
doc_type: architecture
status: active
created: 2026-04-02
updated: 2026-06-12
---
# Execution And Agents Architecture

## 文档边界

本文冻结 execution engine、Execution Agent Layer、capability 与 agent-as-tool
supporting architecture。

它回答的是：

- `apps/execution-control`、Temporal worker plane 与 retired Python worker 分别负责什么
- Execution Agent Layer 如何调度 typed tools 与显式 agent-as-tool steps
- knowledge / RAG capability 与其他 domain capability family 的目标角色是什么

## Execution Chain

当前主路径遵循：

`app-api -> execution-control -> Temporal workflow -> activity worker ->
Go RAG DTO/runtime or typed capability worker -> data plane / provider ->
sanitized step projection -> finalization projection`

目标态的产品 agent 与 runtime substrate 分层如下：

- `Campus Assistant` 是 product-level agent experience。
- `Execution Agent Layer` 位于 `execution-control` 内，承接 admission、routing、
  workflow planning、capability dispatch 与 finalization。
- `CapabilityExecutionWorkflow` 是 Temporal durable workflow，负责编排 run lifecycle、
  retry、timeout、cancel 与 step ordering；它不是 agent 本身。
- capability worker 只执行被 workflow admitted 的 typed tool 或 explicit
  agent-as-tool activity。

当前 execution runtime 已统一成三种受治理路径：

- `terminal`
- `single_step`
- `gated multi_step`

其中，`terminal` 在目标态包括 first Execution Agent decision 直接完成的 no-tool /
direct answer、clarification、reject、unsupported 与 fail-close outcome；`single_step`
只表示单个 typed tool 或 agent-as-tool step。已打开但仍保持
`typed_handoff_only` 的 deterministic structured capability 作为 typed tool step 执行：

`app-api -> execution-control -> Go structured runtime -> execution response`

已进入 `runtime_posture=typed_activity_admitted` 的 structured tool 不再被公开 answer
入口的 legacy direct runtime 抢走；它们必须通过 typed Temporal activity / worker
contract 执行，缺 contract、config 或 poller 时 fail closed。

目标态在同一 governance boundary 内扩展为：

`app-api -> execution-control Execution Agent Layer -> first agent decision
-> direct/no-tool terminal or CapabilityExecutionWorkflow capability steps
-> typed activities or agent-as-tool activities -> sanitized step projection
-> finalization projection`

这表示 repo 采用 Execution Agent Layer-led governed multi-capability /
agent-as-tool orchestration，而不是无中心 peer agent mesh。长期 deterministic
workflow ownership 由 `execution-control` + Temporal workflow code 承接；typed
activities 承接 deterministic data access；online capability activity worker 由
Go-owned runtime envelope 承接。retired Python bridge 是 offline / eval / tooling /
historical reference，不是 online answer serving dependency。

边界固定如下：

- 当前 Go `apps/execution-control` 负责 Docker-side execution runtime control plane；长期概念名是
  `execution-control`
- retired Python bridge 不参与 online answer path；它只保留 offline /
  eval / tooling / historical bridge reference，不拥有 provider hot path、RAG step truth
  或 finalization truth
- `packages/prompt-runtime` 负责 provider-facing prompt contract validation、structured
  output execution、provider response normalization 与 prompt trace construction
- 长期 provider adapter 必须成为可取消成本闭环 owner：捕获 provider request ref，响应
  activity cancel / timeout，执行下游 abort，提取 usage，投影 latency / token /
  estimated cost 与 terminal outcome
- typed tool 负责 deterministic data access；agent-as-tool 负责能力边界内的 semantic
  planning / evidence consumption / answer shaping
- multi-capability / agent-as-tool path 只能通过 Go-owned `WorkflowPlan`
  admission 打开；capability / agent-as-tool step 之间不得通过 raw prompt
  transcript、raw provider trace 或 unbounded evidence dump 直接互相调用
- `packages/retrieval-core` 负责 evidence retrieval kernel、target-state retrieval
  execution 与 query activity，不负责顶层产品编排

## Execution Agent Layer Responsibilities

Execution Agent Layer 长期负责：

- admission / guardrails
- first agent decision
- direct/no-tool terminal decision
- capability routing when a campus capability/tool is needed
- handoff shaping
- workflow plan ownership
- allowed capability / allowed tool / admitted agent-as-tool / step budget policy
- response finalization
- fail-close terminal semantics

`supervisor` 是 legacy term：历史 ADR、legacy contract 文件名、旧 schema / symbol
中的 `supervisor` 在目标态映射为 `Execution Agent Layer`。它不是 retired
Python bridge、不是 hidden mega-agent，也不是任意 worker 进程。agentic reasoning
只允许出现在 routing / workflow planning / synthesis / clarification /
finalization，或显式声明的 semantic specialist / agent-as-tool step 中。

当前语言切分下，deterministic admission / routing / RAG DTO projection 与 finalization
由 Go `apps/execution-control` 拥有；retired Python bridge 不参与 online answer
dispatch。

Execution Agent Layer 不负责：

- retrieval backend 细节
- collection-specific ingestion logic
- product-layer auth/session ownership
- 将 semantic specialist 降级成扁平 tool bundle，或把 deterministic tool
  包装成无语义职责的 agent
- 在 prompt 内隐式决定跨 capability / agent-as-tool step 协作顺序
- 把 product identity/help/self-introduction 拆成 `assistant_intro`、`product_meta`
  或类似 synthetic capability；这些应由 first agent decision 的 no-tool
  terminal branch 在产品边界内回答

补充约束：

- Execution Agent Layer 是 neutral capability router，不是默认的 knowledge /
  `knowledge` router
- `public chat` 当前 knowledge-only 只是 surface posture，不反向定义
  Execution Agent Layer 的长期角色
- 当前代码仍存在 missing `requested_capability` 默认进入 `knowledge` 的实现缺口；
  这不是目标架构原则。后续必须让 first agent decision 显式产生 terminal /
  capability routing / workflow planning outcome，而不是由空字段隐式落到 RAG。
- Execution Agent Layer 是 multi-capability / agent-as-tool manager，不是
  peer agent；它保留最终回复
  ownership，除非 workflow plan 显式采用 specialist handoff ownership transfer

## Execution Agent Runtime Kernel

长期上，Execution Agent Layer execution engine 拆成两类职责：

- deterministic execution control / workflow orchestration
- semantic orchestration and explicit agent-as-tool reasoning

`execution-control` + Temporal workflow code 负责：

- durable run projection adapter、deadline、timeout、cancel / signal / update 与
  graceful drain
- workflow start / query / cancel / signal / update
- global / per-capability lane admission、Temporal task queue selection、
  backpressure、retryability 与 circuit breaker
- process-local lifecycle / admission limiter 作为本进程 protection；它不是
  production run store 或跨实例全局 scheduler
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

目标部署 roles：

- `execution-control`：HTTP command-query、workflow
  start/query/cancel/signal/update、
  readyz/metrics 与 projection command。
- `workflow-worker`：poll Temporal workflow task queue，执行 deterministic
  workflow code。
- `activity-worker-{capability}`：poll capability activity task queue，执行
  typed tool 或 agent-as-tool activity，并写 sanitized projection。
- `projection-worker`：在 selected implementation 中把 workflow/activity
  progress materialize 到 app-api / panel / eval read model。
- `worker-autoscaler`：读取 Temporal task queue metrics、poller health、
  downstream budget
  projection 与 SLO policy，只调 worker replica count，不写 execution truth。

当前 repo-local runtime progress：

- Go `execution-control` 已拥有 execution ingress、lifecycle、Temporal cancel、
  per-lane admission、metrics、OTel seam 与 execution audit backflow
- 当前 active chat execution path 已硬切到 Temporal-backed
  `CapabilityExecutionWorkflow`；PG `runtime.agent_runs`、events 与 step tables
  是 sanitized projection store，不是 execution queue truth。旧 PG
  lease coordinator / worker loop / recovery loop 只保留为 historical migration artifact。
  进程内 lifecycle、active count 与 bounded queue 只保留为本进程 runtime protection。
  当前 RAG path 已落成 Go-owned memory + RAG activity graph；剩余缺口是 staging
  Temporal poller proof、worker autoscaler actuation、panel/eval step trajectory
  深化，以及 notice / navigation / campus-services typed worker contract
  全量接入。完整 target 见
  `docs/architecture/system/durable-agent-runtime-architecture.md`
- Go `execution-control` 取消 path 已收口到 Temporal workflow cancel +
  sanitized cancel projection；RAG lookup/provider adapter 必须使用 cancellable
  context，并在 step attempt 上记录 cancel/timeout outcome。无法证明 provider
  token 消耗停止时写
  `abort_unproven`
- provider usage extraction 与 sanitized step/run projection 已进入 online RAG
  synthesis path；latency、input/output/cached token、estimated cost 与 provider
  request ref 必须按 activity attempt 归因，而不是只出现在 provider raw trace
- Go `execution-control` 的 execution envelope 已接受 `knowledge`、`place_lookup`、
  `campus_services`、`notice` capability label，并将它们映射到
  `rag`、`navigation`、`campus_services`、`notice` lane；`requested_scope` 仍只允许
  knowledge path 使用
- Go `execution-control` 已拥有 deterministic effective capability / lane inference：
  当 caller 未显式传 `requested_capability` 时，常见地点、校车/班车、通知/公告/公示
  与 knowledge-family 请求会先被归入对应 runtime lane；versioned / scoped
  knowledge 请求仍保持 knowledge path；capability inference、runtime policy 与
  structured handoff planner 共用 `configs/runtime/intent-policy.v1.json` 作为 signal
  taxonomy 单一来源
- legacy execution OpenAPI schema 仍生成 TS / Go /
  Python historical bridge artifacts，但不再定义 current online RAG serving path；
  current online run command/query path 是 `app-api -> execution-control -> Temporal`
  与 PG sanitized projection
- current internal run command/query seam 采用 strict wire policy：internal seam 固定
  `snake_case`，不接受 camelCase 或未知 top-level wrapper 字段；retired bridge artifacts
  如果用于 offline/eval，也必须保持 strict decode
- Go finalizer 是 terminal response invariant owner：final answer 必须可追溯到
  sanitized synthesis / grounding / finalization projection，`runtime_versions`
  必须携带 response / runtime decision / workflow trace provenance；cancel /
  timeout / Temporal unavailable / RAG runtime unavailable 必须保留 typed
  fail-close reason
- `workflow_trace_summary.workflow_mode` 是 execution wrapper 的 canonical enum，当前固定为
  `terminal`、`single_step`、`multi_step`。`terminal` 表示未进入
  agent/tool execution 的终局裁决，`single_step` 表示只执行一个 typed tool 或
  agent-as-tool step；step kind / branch metadata 负责区分 structured tool 与 semantic
  delegate。
  `multi_step` 已有 gated runtime path，但默认关闭；当前只覆盖 selected notice context +
  knowledge follow-through 的两步链路：`notice internal selected notice resolve
  (payload_kind=campus_notice_get) -> knowledge retrieval.query`。第一步 notice
  结果会先落成 repo-owned canonical
  `StepOutputProjection`，再以有长度上限的 `notice_context` 输入第二步 RAG bridge
  payload；执行 wire 使用 `agent_request.workflow_context` 传递
  `workflow-capability-context-v1` 投影引用 envelope，只允许 `projection_refs`、required
  projection kind 与 target metadata，不携带 raw projection payload。operator / eval 可见的
  `workflow_trace_summary.context_projections` 只暴露 projection id、source step、kind、
  content hash 与 safety summary，不暴露正文 payload。
  `multi_step` 的 selected-notice admission 现已改为 planner 只输出 internal
  `CapabilityPlan`，再由 resolver 根据 artifact graph 编译实际 `WorkflowPlan`；planner 不再
  直接拼 notice -> rag 固定 step list。workflow trace summary 额外记录
  `answer_artifact_projection_ids` 与 `answer_artifact_kinds`，用于证明最终答复使用了哪些
  bounded artifact。不得把单 handoff trace 包装成 `multi_step`
- `plan.route` 是 Execution Agent Layer 的 current durable planning step。它从
  `execution_payload` 读取 bounded request context，输出 resolved branch steps、selected
  capability、typed tool 与 worker role。旧 `runtime_decisions` / bridge handoff 只属于
  historical direct serving contract，不是 current durable chat path 的规划输入。
- `apps/execution-control/internal/execution` 已有 repo-owned `WorkflowRunStore`
  接口、in-memory 实现与 PostgreSQL backend，用于约束 run id、state、step timeline
  与 handoff chain、context projections 的内部 run-state shape。生产打开 `multi_step` 必须配置
  `EXECUTION_CONTROL_WORKFLOW_RUN_DATABASE_URL` 并安装 `runtime.workflow_runs` schema；
  `EXECUTION_CONTROL_WORKFLOW_RUN_AUTO_MIGRATE=true` 只适合 local/dev 或明确允许启动迁移的环境。
  completed `multi_step` 至少包含两个有序 handoff step；需要 cross-step
  context 的 edge 必须声明 `required_projection_kind`，projection 缺失时 fail-closed
- `WorkflowRunStore` 是 multi-step workflow foundation；当前 product-visible durable
  `Run` / `RunEvent` truth 已具备 run-level baseline。下一层收口必须把 `RunStep`、
  `StepAttempt`、`StepResult`、lane lease 与 stream event projection 统一建模
- Go `execution-control` 已落地 gate-closed structured query runtime foundation；当前
  `service_status_lookup`、`transport_schedule_lookup` 与 `service_guide_lookup`
  均通过 PostgreSQL release current pointer + typed read model 消费，
  `transport_schedule_lookup` 具备 projection-backed schedule query kernel 与
  Python thin-adapter wiring；`academic_calendar_lookup` 通过
  `calendar/academic_calendar` read model 回答教学周、节假日和补课安排事实；
  `campus_notice_discover` 具备 capability-facing notice card discovery runtime，
  `campus_notice_get` 只保留为 Go-owned internal selected notice card/context resolve
  function，不进入 provider/SDK tool surface；其
  authenticated-notice-backed offline projection builder 属于 ingestion data plane，
  产品主路由 gate 仍保持关闭
- Go `execution-control` 已拥有 deterministic planner 与 current RAG DTO projection；
  online RAG 不再通过 bridge v6 delegate handoff 进入 Python worker。retired bridge v6
  artifact 只能作为 offline / eval / historical reference。
- planner 实现边界在 `apps/execution-control/internal/structuredplanning`；
  `apps/execution-control/internal/execution` 只负责 request projection 与 current
  runtime decisions 适配；planner 不再维护独立 signal taxonomy，只消费 Go
  runtime policy artifact 与 typed request
- Go `execution-control` 已拥有 deterministic runtime policy foundation；当前实现位于
  `apps/execution-control/internal/runtimepolicy`，run command projection 传递
  `scope_gate`、`policy_gate`、`context_preflight`、`tool_policy` 与 `routing_frame`。
  product-scope、readiness-required、context-follow-up 与 terminal 裁决不得回退给
  Python bridge 或 prompt fallback。
- Go `execution-control` 已拥有 structured runtime foundation，但 structured payload
  只有在 typed Temporal activity contract、config gate 与 task queue poller 都 ready 后
  才能打开 serving；缺口必须 fail closed。Go 仍负责 opening gate、admission、
  `WorkflowPlan`、ToolSpec admission、structured query backend、fail-close envelope
  与 finalization
- Go runtime policy 当前从 `configs/runtime/intent-policy.v1.json` 加载 versioned
  intent policy artifact；artifact 固定 policy / classifier / intent schema /
  case-set version、reason code registry 与 signal group taxonomy，避免 runtime
  源码内匿名 signal list 成为第二套 classifier truth
- Go runtime policy 当前从 `configs/runtime/tools.v3.json` 加载 repo-owned ToolSpec
  registry，并由它派生 structured handoff `allowed_tools`；`retrieval.query`
  只作为 `knowledge` 内部 retrieval step 进入 eval / observability denominator，
  不作为 Go preplanned structured handoff tool 暴露
- Go runtime policy 已显式区分 previous-goal follow-up、selected notice follow-up 与
  curriculum slot follow-up；缺上下文进入 routing clarification，多候选 previous-goal
  进入 ambiguous clarification，而不是继续让 prompt 或 Python fallback 猜测
- Go runtime policy 已对显式 `campus_services` 但无法规划为
  `transport_schedule_lookup` / `service_status_lookup` 的 subtype 返回
  `structured_subtype_missing` clarification，避免缺 typed activity contract 的 serving
  请求被错误放行
- Go `execution-control` 已把 runtime policy decision summary 纳入内部观测口径：
  `/metrics` 只用低基数 label 发布 `scope_gate`、`policy_gate`、
  `context_preflight`、`routing_next_action`、`planning_outcome`、
  selected capability / tool、terminal outcome 与 fail-close reason；OTel 与
  execution audit 同步携带这些安全摘要，不携带 raw `user_goal` 或
  prompt/provider payload
- Go `execution-control` 已拥有 response finalization：Go finalizer 统一生成 product-safe
  finalization projection 与 response-level observability；Python legacy online finalization
  path 不参与 serving
- standalone Python core package 已退役；retired Python bridge
  保留为 offline / eval / tooling / historical bridge reference
- Go `execution-control` 已拥有 query-enabled scope admission；当前 allowlist 来自
  `configs/runtime/query-serving-scopes.v1.json`，并通过 drift test 与 ingestion
  runtime profile 的 `query_enabled_by_default=true` 保持一致。disabled knowledge
  scope 在 workflow admission 前返回 `403 disallowed_knowledge_scope`
- Go `execution-control` 已拥有 structured runtime opening gate：
  `campus_services` / `notice` 默认关闭，只有通过 `EXECUTION_CONTROL_OPEN_CAPABILITIES`
  显式开放后才允许进入 structured runtime；该变量只接受 `campus_services`、`notice`
  及其逗号组合，不接受 `*` / `all`
- `place_lookup` / navigation 继续 fail-close，等待地图产品上线后再进行 serving admission
  wildcard；关闭时 non-stream request 返回 `503 structured_runtime_closed`，
  lifecycle stream 返回 terminal `execution.failed`
- Go `execution-control` 已拥有 prompt config admission summary：
  `/readyz` 发布 Go-owned `prompt_config_gate`，并要求 admitted online provider
  model 出现在 repo-owned `configs/runtime/provider-pricing.v1.json` 中；缺 pricing
  metadata 是 config/readiness failure，不得静默按 zero-cost 执行。Go RAG synthesis
  provider adapter 创建 online provider client / prompt executor，并记录 usage、
  estimated cost 与 cancel / timeout outcome

Go `execution-control` 当前也拥有 step attempt evidence spine：Temporal activity metadata、
task queue、worker id、queue wait、duration、provider/model、token/cost、
cancel / timeout outcome 字段已进入 run projection store、
`/internal/execution/runs/:runId/steps`、app-api operator runtime summary 与
protected panel step trajectory。在线 knowledge / RAG graph 已由 Go
`activity-worker-knowledge` 承接：`rag.plan`、`retrieval.indexed_lookup`、
`retrieval.expand_or_rescue`、`evidence.selection`、`synthesis` 与
`grounding.verify` 均写 sanitized step projection；`finalization.write` 由
Go `activity-worker-finalization` 承接。

Python semantic bridge 只保留 offline / eval / tooling / historical reference：

- 不参与 online answer dispatch checkpoint
- 不创建 online provider client / prompt executor
- 不拥有 RAG planning / retrieval / evidence selection / grounding serving truth
- 不进入 staging readiness、worker topology 或 Temporal task queue poller gate

worker plane 按 Temporal task queue 与 capability boundary 拆分；Rust 只在 step-level
profiling 证明 CPU hotspot 后用于对应 activity backend，不作为默认重写方向。

固定边界：

- Go runtime type 不进入 `packages/contracts`
- execution wrapper schema 不进入 `packages/contracts`；只以
  legacy execution OpenAPI schema 及生成物约束跨语言 wire
  shape
- Go 不接管 `apps/app-api` 的 product-layer auth/session/conversation truth
- Go 不接管 ingestion、OCR、chunking、index build 或 retrieval backend 细节
- structured deterministic query service 和 posture-gated direct answer path
  可以迁 Go；semantic capability / explicit agent-as-tool step 仍保留 owner
  与 thin adapter 边界

## Capability-Neutral Routing Model

长期 execution path 固定采用：

`surface intake -> admission / guardrails -> capability routing -> workflow
planning -> agent-owned execution -> execution finalization`

固定规则：

- 顶层先判 capability family，再判 family 内部 execution path
- capability family 决策之后，Execution Agent Layer 可以选择 `terminal`、
  `single_step`
  或 admitted `multi_step` workflow
- `requested_scope` 只属于 knowledge-family path，不是顶层所有请求共享的默认字段
- `routing clarification` 由 Execution Agent Layer 拥有，`agent clarification`
  由 agent 拥有
- 当前 merged truth 仍可以保持“公开主路径以 knowledge 为主”，但这不表示长期入口必须
  `RAG-first`

更完整的 routing / admission 分层，统一看
`docs/architecture/system/capability-routing-and-admission-architecture.md`。

## Tool And Agent-As-Tool Model

domain capability 默认 tools-first。agent 是 semantic specialist boundary，不等于某个底层框架对象，
也不是 deterministic data access 的默认包装层。

当前 merged-truth 已接受的 current-truth runtime / package label：

- `knowledge`
- `navigation`
- `campus_services`
- `notice`

后续如引入新的稳定 capability family，必须满足：

- deterministic data access 已先建模为 typed tool 或 projection-backed
  internal query service
- 需要 semantic specialist 的理由明确，例如消歧、摘要、跨工具编排、agent-owned
  clarification、evidence consumption 或 answer shaping
- handoff / step contract 可显式化
- workflow / safety / eval 可重复验证

补充命名约束：

- active target terminology uses `Execution Agent Layer` as the top-level role name
- repo-wide execution capability 统一采用三层 vocabulary：
  - target role name
  - current-truth runtime / package / contract label
  - forward family label
- 当前已完成首轮 current-truth/runtime label convergence：
  - `knowledge`
  - `navigation`
  - `campus_services`
  - `notice`
- 当新增稳定 capability family 时，默认先新增 typed tool；只有需要 semantic specialist 时才新增
  `<domain>-agent` label
- 当前 label 已与 forward family label 一致的能力边界，不再额外维护 synthetic split；如未来新增 domain
  capability，需要先冻结 family label，再决定其 package/runtime admission 形态
- 当前 shared contract seam 使用 `CapabilityRequest` / `CapabilityResponse` 作为 private
  bridge 的 canonical DTO 名称。

## Governed Typed-Step Target

multi-capability / agent-as-tool 默认采用 manager-style typed-step orchestration：

`Go execution-control -> durable RunStep -> typed tool or bounded specialist
agent-as-tool -> StepResult / StepOutputProjection -> next step / finalizer`

外部 agent 框架与 Codex CLI / Agents SDK / LangGraph 等 runtime 的共同启发只作为
supporting design input：它们证明 manager-style specialist call、explicit handoff、
tool orchestration、trace 与 agent graph 都应是一等 runtime concern。repo 的 canonical
truth 仍由 durable `RunStep`、`StepAttempt`、`StepResult`、`WorkflowPlan`、
`CapabilityRequest`、`CapabilityResponse`、`StepOutputProjection` 与 `workflow_trace_summary`
拥有；不得把任何 SDK-native graph、provider trace 或框架状态提升为 shared contract。

固定 owner 如下：

- Go `apps/execution-control`
  - 拥有 workflow mode、allowed capabilities、allowed tools、admitted
    agent-as-tool steps、step order、parallelism、timeout / budget、retry /
    replan posture、terminal fail-close policy 与 finalization
- retired Python bridge
  - 只拥有 offline / eval / tooling / historical bridge runtime；不拥有 online
    provider adapter、agent loop execution、step-local serving truth 或 tool result
    consumption
- typed tool
  - 拥有 deterministic data access contract 与 sanitized result projection
- explicit agent-as-tool
  - 拥有 family 内部 semantic reasoning、tool sequencing、clarification 与 answer shaping
- `packages/evals`
  - 拥有 multi-capability / agent-as-tool step selection、handoff
    correctness、context projection completeness 与 final answer grounding 的
    denominator

两种协作模式必须显式区分：

- manager-style agents-as-tools
  - 默认模式；Execution Agent Layer / workflow manager 保持最终回复 ownership
  - specialist agent 只返回 bounded typed output，例如 schedule baseline、notice
    change set、place context 或 evidence bundle
- specialist handoff
  - 只在 specialist 应该接管下一轮回复 ownership 时使用
  - 必须携带显式 handoff target、allowed tools、history filter / context projection 与
    eval denominator

### CapabilitySpec Registry Target

必须有 repo-owned `CapabilitySpec` registry，作为 deterministic capability 的
admission artifact。
新增或打开稳定 domain agent-as-tool 时，不得只在 planner 中添加字符串 target；必须先注册
`CapabilitySpec` 或同等 canonical artifact。

`CapabilitySpec` 至少固定：

- capability id 或 admitted agent-as-tool id / forward family label / owner
  package / runtime adapter
- accepted `CapabilityRequest` payload kinds 与 input projection schema
- output projection schema，例如 `StepOutputProjection` family
- allowed tools 与 deterministic query functions 的边界
- context filter / history inheritance policy
- clarification ownership：routing clarification 还是 capability-owned /
  agent-as-tool-owned clarification
- readiness / opening gate 与 capability lane
- timeout、budget、parallelism、retry / replan posture
- observability labels、trace projection policy 与 eval denominator

`CapabilitySpec` 应生成或校验：

- Go `WorkflowPlan.allowed_capabilities`
- Go structured planner target / payload-kind admission
- offline Python worker delegate map
- domain capability / agent-as-tool adapter dispatch table
- workflow trace `CapabilityInvocation` projection
- `packages/evals` handoff / context / finalization denominator

### Capability Invocation Graph Target

multi-capability / agent-as-tool runtime 的 canonical lifecycle 应显式投影到
durable step model：

`Turn -> Run -> RunStep -> StepAttempt -> StepResult -> RunEvent -> Finalization`

`CapabilityInvocation` 与 `ToolCall` 是 step result / workflow trace 内的
sanitized projection，而不是独立 execution truth owner。该 projection 只保存
sanitized contract，不保存 raw prompt、raw model response、raw provider trace、
raw OCR、raw source HTML 或未裁剪附件正文。

每个 `CapabilityInvocation` 至少应包含：

- invocation id、parent invocation id、workflow run ref、turn / request correlation
- capability id 或 admitted agent-as-tool id、capability family、workflow step
  id、status 与 terminal reason
- input projection refs 与 context projection ids
- allowed tools / actually used tools / deterministic query functions
- output projection id、business outcome、fail-close reason
- latency / token / cost summary 的安全摘要
- source refs / evidence refs / projection hashes

这条 graph 的用途是 runtime observability、operator-safe projection、debugging 与 eval。
它不是用户可见回答内容，也不是 provider-native trace 的镜像。

跨 capability / agent-as-tool step 传递内容必须使用 bounded typed artifact。推荐
长期 artifact family 包括：

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
raw snippets、raw source HTML 或未裁剪附件 OCR dump 直接作为 cross-step context。

### Context Projection Policy

context inheritance 必须按 capability / step role 最小化。Execution Agent Layer 不得把完整
conversation、完整上游 answer、完整 evidence bundle 或 raw source dump 广播给
所有 capability / agent-as-tool steps。

默认 context projection 规则：

- `knowledge` 只接收 query intent、scope/version frame、bounded retrieval plan context、
  upstream projection refs 与必要 evidence summary
- `campus_services` 只接收 service intent、slots、campus / temporal context、
  admitted structured tool list 与 projection-backed service refs
- `notice` 只接收 notice discovery/ref resolution intent、selected notice refs、
  source family / category / date filters 与 bounded notice card context
- `navigation` 只接收 place / point / route intent、service point refs、transport
  stop refs 与 visibility-safe spatial context

context projection 必须记录 projection kind、source step、content hash、visibility posture、
length budget、source refs 与 safety summary。缺失 required projection 或 projection
visibility 不匹配时，workflow 必须 fail closed 或进入 clarification，不得回退到 raw
history / raw evidence prompt stuffing。

执行 wire 的 cross-step context envelope 固定为 `CapabilityRequest.workflow_context`。
该 envelope 是 execution-private 的 projection-ref carrier，不是 operator
summary，也不是 raw context store。它必须携带 schema version、visibility、target、
`required_projection_kind` 与 bounded `projection_refs`；不得出现 `payload`、`raw_payload`、
`raw_context` 或 `source_body` 等 raw-key。`workflow_trace_summary.context_projections`
是 operator / eval summary，只用于重建 workflow shape、source step、projection kind、
hash 与 safety posture，不承担下游 capability / agent-as-tool prompt context 传递。

## Agent Framework / Agents SDK Boundary

agent framework 是显式 domain agent-as-tool 的内部实现 substrate，不是 repo-level
orchestration owner。

当前 accepted worker truth 是：online hot path 不再由 retired Python bridge 承接。
OpenAI Agents SDK / provider-native function calling 可以作为 explicit semantic
agent-as-tool activity 的内部实现 substrate，但不能成为 repo-level
orchestration owner。当前代码事实是 Go `activity-worker-knowledge` 直接调用
Responses API 做 RAG synthesis，尚未在 online path 打开 SDK-native tool loop；retired
Python bridge 仍只可用于 offline / eval / tooling / historical reference。

SDK / provider-native tool loop 可用于承接：

- code-first tool loop 与 handoff object modeling
- provider-native function calling adapter 与 strict function schema execution
- run / trace capture，便于投影到 repo-owned `workflow_trace_summary`
- agent-as-tool 内部 guardrail / interruption checkpoint 的实现 ergonomics
- resumable state 或 next-turn surface 的局部实现

官方 Agents SDK 的当前 primitive 与 repo 边界对齐方式固定如下：

- `Agent` / `Runner` / function tools 可以替代某个 admitted agent-as-tool activity
  内部的手写 tool loop glue
- agents-as-tools 可以用于一个 admitted explicit agent-as-tool step 内部的
  bounded specialist call
- SDK handoff 只作为实现 substrate；repo-level step / handoff truth 仍是 Go
  `WorkflowPlan`、Temporal activity graph 与 sanitized projection
- SDK guardrails 可以作为内部 input / output / function-tool validation，但 repo-owned
  ToolSpec、evidence grounding、source gate 与 finalizer guardrail 仍是 release
  acceptance owner
- SDK tracing 是 debug / evaluation input；默认不得把 raw provider transcript、prompt、
  tool payload、handoff graph 或 trace dump 写入 repo shared contract、panel、eval canonical
  fixture 或 public response

框架级 handoff / agents-as-tools 的使用必须服从 repo-owned workflow plan：

- 默认优先采用 agents-as-tools / manager-style bounded specialist calls，让
  Execution Agent Layer 保持最终回复 ownership
- 只有当某个 specialist 的 instructions、tools、policy 或 next-turn state 必须接管用户回复时，
  才采用 explicit handoff
- 框架生成的 run state、handoff trace、tool schema 与 raw model output 只能作为内部
  debug / adapter input；对外仍以 repo-owned `CapabilityResponse`、`StepOutputProjection`
  与 `workflow_trace_summary` 为准

但它不能替代以下 repo-owned truth：

- Go `apps/execution-control` 的 deterministic runtime kernel、admission、routing policy、
  posture-gated typed structured activity branch、fail-close envelope 与 finalization
- `apps/app-api` 的 surface capability policy、auth/session/principal、conversation、
  request projection 与 operator read model
- `packages/contracts` 的 `CapabilityRequest` / `CapabilityResponse` seam
- `packages/evals` 的 case truth、workflow trace artifact、release verdict 与 observed
  regression lifecycle
- source-truth / projection-backed structured query service 的 data-plane truth

当前 online answer path 不采用 retired Python SDK-native worker runtime。retired
Python / Agents SDK path 只保留为 offline / eval / tooling / historical candidate：

`offline/eval harness -> Python SDK-backed semantic candidate -> sanitized fixture/projection`

online 等价链路必须是：

`Go execution-control -> Temporal activity DTO -> capability activity worker`

`-> sanitized projection -> Go finalization`

如果某个 online capability worker 选择使用 SDK / provider-native function calling，它也必须
运行在这个 Temporal activity envelope 内：activity input 只携带 run / step /
projection refs、ToolSpec-admitted tool subset 与 bounded payload hash；activity attempt
记录 task queue、worker id、provider request ref、latency、token、estimated cost、
cancel / timeout outcome。SDK run / trace 可以作为 activity-local debug input，但进入
app-api / panel / eval 的内容必须先经过 repo-owned sanitized projection。不得把
SDK-native agent graph、tool schema、provider trace、raw provider response、raw
prompt 或 SDK-native state 直接写入 shared contracts。

Provider-native function calling 如果后续进入某个 capability，也只能由 repo-owned
ToolSpec、Temporal activity DTO、runtime policy 与 eval denominator 先冻结，再由该
capability worker 的 adapter 编译为 provider function schema。它不能替代 Go
`apps/execution-control` 的 tool admission、opening gate、runtime policy 或 fail-close
finalization。Python adapter 不能重新成为 online provider hot path。

### Agents SDK Admission Order

SDK runtime 不是 repo-wide owner。若后续在 offline/eval 或某个 online capability
activity 内使用 agent framework，按以下顺序 admission：

1. Read-only structured domain capability tools：必须先有 ToolSpec / Go runtime
   policy / eval denominator，然后由 capability worker adapter 将 admitted tool
   subset 编译为 SDK/provider function tools。
1. RAG-internal semantic loop：当前 online RAG 不使用 SDK loop。若后续打开
   SDK/provider tool loop，只能在 `knowledge` activity 内消费 Go RAG step graph
   已产生的 deterministic query slot 与 bounded evidence projection；`retrieval.query`
   继续保持 capability-internal / closed，不能重新打开为 public serving retrieval path。
1. Multi-step workflow step internals：online workflow step internals 由 Temporal
   activity DTO、ToolSpec、CapabilitySpec 与 projection contract 表达。SDK 可以实现某个
   admitted step 的内部 loop，但不能由 Python bridge 生成或改写全局 workflow plan。
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

引入 SDK 或其他 agent framework 作为 online agent-as-tool substrate 之前，repo-owned
workflow runtime 仍需继续补齐：

- resumable workflow state：Temporal 是 execution truth；PG 只保存 sanitized projection。
  后续 resume / replay 必须围绕 Temporal workflow id、run id、step projection 与
  policy version evidence 设计，不恢复 PG workflow backend
- semantic retry/replan 计数与 policy execution，而不是只在 `WorkflowPlan` 中声明
  `semantic_retry_policy`
- broader `multi_step` admission denominator：新增链路必须先补 Temporal activity graph
  fixture、projection invariant 与 sanitized `workflow_trace_summary.context_projections`
  projection
- eval denominator：继续覆盖 resume、semantic retry/replan、capability-owned /
  agent-as-tool-owned clarification 与 fail-close provenance，避免把固定两步链路误当完整通用
  agent graph

## Tool And Function Calling Target

长期 tool use 采用 application-owned orchestration：

```text
Go execution-control
-> ToolSpec / allowed_tools
-> domain capability tool loop
-> thin adapter
-> internal query service
-> sanitized CapabilityResponse
-> Go finalization
```

固定 owner 如下：

- `apps/execution-control`
  - 拥有 deterministic tool admission、capability / lane / scope / version guard、
    opening gate、workflow plan、max-call / timeout posture、fail-close terminal
    semantics 与 low-cardinality observability labels
- domain capability / explicit agent-as-tool
  - 拥有 family 内部的 tool sequencing、capability clarification、provider-native
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

当前 `ToolSpec` registry 位于 `configs/runtime/tools.v3.json`，是 repo-owned callable
truth 的 canonical artifact，而不是 scattered runtime 常量。`surface` 决定它是
capability-facing `structured_handoff`，还是只能在 agent 内部使用的
`capability_internal` function。`function_schema` 表示该 callable 是否可以生成 strict
provider / SDK function schema；`runtime_posture` 才表达它是
`typed_activity_admitted`、`capability_internal_admitted`、`internal_function`、`closed`
或其他 repo-owned admission posture。schema 可用不等于 runtime 已开放，也不等于可以进入
Go `allowed_tools`。

它至少约束：

- tool name、owner capability、capability family 与 payload kind
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
面向 domain capability / agent-as-tool 的 provider/SDK tool loop 只能接收
WorkflowPlan 已选 capability 内的 ToolSpec-admitted subset；RAG 这类内部 loop 只能接收显式
`capability_internal_admitted` 的 `capability_internal` function。

并行 tool / capability fanout 默认由 Go `WorkflowPlan` 显式表达，而不是交给 provider 在单轮
function calling 中自由并发。provider-native parallel tool call 只有在 ToolSpec、
runtime_posture、eval denominator 与 result merge policy 都明确允许时才可打开；否则
domain capability adapter 应保持 single-call loop 或 serial loop。

Python worker 只保留 offline / eval / tooling / historical substrate。若后续需要
online SDK/tool-loop runtime，应作为 Go-owned execution-control worker plane 下的明确
capability activity adapter 重新设计，而不是恢复 retired Python bridge fallback。
内部 deterministic query function，例如 selected notice resolve/context，不能因为存在
DTO/schema 就进入 structured handoff tool loop。缺失 admission、wrong tool、非对象
arguments、schema 不存在、SDK 运行时缺失或 query service failure 必须转成结构化
fail-close evidence，而不是穿透为 bridge 500。sanitized trace/projection 可以记录
provider correlation，但 raw provider response 不进入 `CapabilityResponse`、workflow
trace、panel 或 eval canonical surface。

Agents SDK 当前不承载 `campus_notice_get`。`campus_notice_get` 保持 notice internal
resolve runtime seam；它不是 structured handoff tool，也不是 provider/SDK function tool。
当前 ToolSpec-admitted structured tools 是
`campus_notice_discover`、`service_status_lookup`、
`service_guide_lookup`、`transport_schedule_lookup`、
`contact_directory_lookup`、`academic_calendar_lookup` 与
`campus_notice_change_set_lookup`。当前 online path 由 Temporal typed activity 执行这些
tools；SDK shell 只可承接 offline/eval 的 argument completion / tool loop 行为复核。
projection-backed structured query、Temporal policy、source truth、Go opening
gate/admission、ToolSpec gate 与 Go finalization 由 repo-owned runtime 承担。
SDK `FunctionTool` surface 只能由
repo-owned ToolSpec 派生；SDK run / trace / native state 不得进入
`packages/contracts`、panel、eval 或 `workflow_trace_summary`。缺 provider、model、
API key 或 SDK dependency 时只能返回稳定 fail-close evidence 或 degraded
offline/eval readiness，不得恢复旧 provider loop 或 non-SDK answer fallback。

`knowledge` 的 Agents SDK 接入只保留为 offline/eval candidate，不属于 current online
RAG synthesis runtime，也不属于 ToolSpec structured handoff。它的内部 function 仍必须由
ToolSpec 注册与校验，但不得进入 structured handoff allowed-tools。它固定遵循：

- `retrieval.query` 保持 `capability_internal` / `closed`，不开放为 public ToolSpec、
  provider tool 或 Go preplanned structured handoff tool
- `retrieve_evidence` 是 `capability_internal` /
  `capability_internal_admitted` 的 internal function，只返回已 admission 的 bounded
  evidence anchors；它不是用户意图级 tool，也不是 Go preplanned structured handoff tool
- Execution Agent Layer 仍拥有 admission、capability routing、workflow plan、
  opening gate 与 finalization；SDK 不承接 online RAG synthesis loop
- `packages/knowledge-capability` 只定义 SDK-neutral `RagSdkRunRequest`、
  bounded evidence projection、claim/list-item support 与 sanitized trace
  projection；官方 SDK import 保留在 retired Python bridge
- SDK `FunctionTool` 只能读取 planner 已产生的 deterministic query slot 和 bounded evidence
  anchors；模型不能提供 corpus、collection、source filter、target document ids、version ids、
  revision track、top-k 或 serving surface
- accepted SDK output 必须把每个 factual claim 或 list item 绑定到返回 evidence 中的
  `source_id + chunk_id + excerpt + span_ref`；source-id-only citation 不足以完成回答
- native SDK tracing 默认关闭，进入 RAG diagnostics / observability 的只能是
  repo-owned sanitized projection；raw prompt、raw transcript、raw provider response、
  SDK run state 与 raw evidence dump 不得出现在 shared contracts、panel、
  workflow trace 或 eval canonical artifact
- RAG query-enabled answer path 不再保留 `closed` / `candidate` / `shadow` /
  `fallback_only` rollout runtime；SDK runtime unavailable 不影响 online serving
  admission，也不得回退到旧 deterministic answer synthesis

notice-family 的目标态需要把 capability-facing tool 与内部 query function 分开。通知用户面默认
是 source-link / card-first：`title`、official URL、source family、发布时间、短摘要或
匹配原因可以进入 answer/card；canonical body、OCR owner text、inline image text 与附件正文
只作为 source-truth、内部 context、下游 materialization、bounded summary 或 fact extraction
输入，不作为默认 public answer 全文输出。`campus_notice_discover` 是合理的
capability-facing tool，因为它表达“找通知”这个用户意图；按 notice id 取 card、取 bounded
context、读取 media / OCR owner text 更适合作为 notice 或 Go internal query
service 的 deterministic query function。若后续保留或改造 `campus_notice_get`，目标语义也必须从
“fetch body”重切为 selected notice ref/card/context resolution，并带 display policy 与
finalizer guard。

当前 workflow trace 的 tool call summary 已显式记录：

- `workflow_run_ref`
- step id
- `tool_call_id`
- tool name / owner capability
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
- workflow correlation：`workflow_run_ref` / run id、step id、`CapabilityInvocation`
  id 与 parent invocation id
- tool correlation：repo-owned `tool_call_id`、tool name、owner capability、business
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
- state-changing tool 进入 public chat 主路径；预约、提交、支付、工单等状态变更能力不是当前主问答产品目标
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

当前已冻结的前向 family / tool boundary 包括：

- campus services typed tools
  - 承接 deterministic `transport_schedule_lookup`、`service_status_lookup` 与
    `service_guide_lookup`、`contact_directory_lookup`、`academic_calendar_lookup`，以及
    reserved `service_process_lookup`
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
- `campus_services`
  - 只在需要 semantic disambiguation、跨工具编排、说明生成或 agent-owned clarification
    时作为 agent-as-tool 消费 campus services typed tools
  - 不拥有服务 source truth、release current pointer 或 typed read model
- notice typed tools
  - 承接 deterministic `campus_notice_discover`、selected notice ref
    resolution、official source card rendering 与 bounded notice context projection
  - 回答 notice 发现、候选消歧、官方链接回链、短摘要/事实抽取所需的内部 context；current-year
    miss 不得自动触发历史回退
  - 不作为默认正文阅读器；canonical notice body / OCR owner text 不得直接进入用户面全文输出
  - source family 至少显式区分 public `official_web` notice-like pages 与
    authenticated-source `campus_notices/internal_notice`
- `notice`
  - 只在需要 notice 候选语义消歧、historical posture、短摘要/事实抽取或向下游 family
    提供 source-linked bounded context 时作为 agent-as-tool
  - 不拥有 notice source truth、canonical body truth、OCR truth 或 release current pointer
- `navigation`
  - 当前 accepted runtime / package / ADR label 已统一为 `navigation`
  - 只在 navigation semantic specialist step 中消费 transport point refs /
    service point refs
  - 不拥有 timetable truth 或 service-status truth
- `knowledge`
  - 当前 accepted runtime / package label 已统一为 `knowledge`
  - 继续承接稳定制度/流程/材料类问题，例如公费医疗报销规则、材料与办理流程；其 retrieval
    / evidence verifier / synthesis / grounding 必须表现为 durable typed steps

固定实现 shape：

- deterministic data access 默认是 typed tool，不是 agent 的附属物
- tool 后面必须是 repo-owned internal query service，而不是 browser-facing API
- internal query service 只消费 projection / normalized truth，不在 query 时回扫 raw
  source bundle
- Execution Agent Layer 负责 routing / terminal semantics 与 typed step admission；它不直接拥有这些
  domain source truth，也不默认通过 `knowledge` 代持这些 domain capability
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
  - public `official_web` notice-like pages 与 authenticated-source
    `campus_notices/internal_notice` 继续先分 projection，再由 `notice` 收口
- `campus_notice_get`
  - 只作为 internal selected notice card/context resolve function
  - 默认返回 official URL、display policy、bounded summary / facts 和 provenance refs
  - 不得进入 provider/SDK tool surface，也不得把 full body 拼入 public answer

## Structured Runtime Opening Gate

campus services / notice 的 typed tool、agent-as-tool package 与 handoff seam 已存在，不等于这条
runtime lane 已开放。

固定规则：

- opening gate 默认保持 closed，直到 backing query implementation、release-gate
  regression / eval evidence 与 app-owned typed observability summary 同时满足
- 在 gate 仍关闭时，产品主路径只能保持当前 routing truth 或 deterministic fail-close；不得通过 stub /
  unavailable adapter 伪装成“能力已上线”
- 显式历史参考、current miss fail-closed 与 stable-RAG boundary 属于 opening criteria，
  不是后续 prompt polish 或 operator 文案问题
- campus services 的领域 opening 规则与 projection owner 细节，统一看
  `docs/architecture/domains/campus-services/architecture.md`

## RAG Family Responsibilities

`packages/knowledge-capability` 是当前 `knowledge` family 的 runtime package
owner；它当前与长期负责：

- knowledge-family 内部 intent / ambiguity handling
- retrieval-oriented request framing
- ambiguity handling
- clarification / no-answer / completed policy
- grounded answer synthesis
- bounded personal memory inputs within source / capability boundary

它不负责：

- account / session / operator access truth
- product-layer identity / session / memory ownership
- retrieval vendor/runtime freeze

## RAG Family Internal Roles

`knowledge` family 在 capability boundary 内固定拆成以下 durable typed
steps / internal roles：

- `scope resolver`
  - 解析 capability、surface、entity、query mode
- `retrieval planner`
  - 生成 typed retrieval plan
- `typed retrieval / domain tool executor`
  - 调用 admitted retrieval-core 或 domain typed tools
- `evidence verifier`
  - 判断 coverage、source trust、freshness、contract completeness 是否足以继续
- `answer synthesizer`
  - 基于 supporting evidence 生成最终回答
- `grounding validator`
  - 判断最终回答是否仍被 supporting evidence 支持

这些角色可以继续由同一 package 内部实现，但不得再混成一个无法观测的单阶段 prompt 调用。

## Retrieval Planner / Executor Boundary

长期固定采用：

`knowledge planner -> typed retrieval/domain tools -> retrieval-core executor /
domain query service -> evidence verifier -> synthesis -> grounding`

其中：

- `knowledge`
  - 当前 runtime package 是 `packages/knowledge-capability`
  - 拥有 plan 语义、replan 决策、supporting evidence selection policy、synthesis 与
    grounding policy
- `retrieval-core`
  - 拥有 step execution、rerank、merge / dedupe、query activity、candidate shaping
- domain typed tools
  - 拥有 deterministic data access 与 projection-backed result contract

固定规则：

- planner 不能绕过 runtime profile、query-enabled surface 或 source gate
- executor 不能反向改写产品 scope、query mode 或 capability
- plan 必须是 typed artifact，而不是只存在于 prompt 内部
- evidence contract 驱动 replan / clarification / fail-close；synthesis 不得
  补齐缺失 tool / retrieval evidence

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

- agent / capability step 与 Execution Agent Layer 通过 `packages/contracts` 交互
- retrieval / infra types 不进入 shared contract
- `ContextProjection` / `ExecutionResponse` 是当前 merged truth 的 shared seam
- future agent growth 只能在这个 seam 之后扩张
- target-state agentic retrieval 必须继续通过 typed plan / query activity / evidence
  summary seam 扩张，而不是退回 hidden prompt state

## Runtime Posture

`apps/execution-control` 表示 logical execution engine boundary，不代表所有 runtime
code 都必须继续留在 Python。

当前重要的是：

- transport 留在 `apps/*`
- retired / offline private agent dispatch checkpoint 留在 retired Python bridge
- agent behavior 留在 agent package
- `apps/execution-control` 的部署 substrate 已冻结为 Docker-first internal execution service
- Docker-side Go `execution-control` owns runtime hardening: request limits, caller
  admission, in-flight lifecycle, Temporal cancel, global / per-lane execution
  queue / backpressure, timeout propagation, readiness,
  metrics, OTel telemetry seam and graceful drain
- 这项冻结不改写 `app-api -> execution-control` contract，也不提前冻结单一 Python/HTTP
  framework
- retired Python bridge 只保留 offline / eval / tooling /
  historical bridge reference，不再保留 repo-local public compatibility entry 或
  online serving entry

## Prompt And Instruction Ownership

execution path 的 prompt / instruction 继续遵循 package-owned ownership：

- `packages/knowledge-capability` owns answer / clarify / no-answer /
  unsupported prompt families
- `packages/retrieval-core` 不拥有 top-level task prompt；只拥有 evidence retrieval 与
  serialization helper
- retired Python bridge 不拥有长期 prompt truth；只负责 offline/eval semantic
  runtime assembly 或 historical bridge reference
- `packages/prompt-runtime` 拥有 provider-facing prompt contract validation、
  structured output execution、provider response normalization 与 prompt trace construction

当前实现中，legacy terminal wording 已由 Go direct terminal path 承接；Python worker
不再维护 production execution terminal prompt family。

prompt 不能替代 code-owned routing、serving filter、source gate 或 fail-close terminal
semantics。

当前仍进入 provider 的 RAG prompt stack 固定为：

`repo-global developer invariants -> package-owned role prompt -> typed
task/evidence packet -> Go-side execution finalization`

补充约束：

- online product runtime 只负责装配与执行，不拥有新的 monolithic mega system prompt
- retained offline/eval Python prompt assembly seam 必须把
  trusted developer/task layers 与 untrusted user/evidence layers 分开表达，且不得被恢复为
  online serving prompt owner
- `packages/retrieval-core` 继续只提供 evidence serialization helper，不拥有 top-level
  prompt truth
- `system prompt` 这个词在 repo 里只保留为沟通简称；真正运行时应以 developer prompt + typed packets
  表达

## Forbidden Shapes

- 不把 Execution Agent Layer 重新写成被动转发层
- 不把 `knowledge` 重新降级成扁平 retrieval tool，也不把 deterministic
  typed tool 包装成没有语义职责的 agent
- 不把 `campus_services` / `notice` 的 structured runtime 再塞回 generic
  RAG 或单一 mega-tool router
- 不把 retrieval implementation 细节塞回 retired Python bridge
- 不让 `apps/execution-control` 恢复 product backend、operator query 或 browser API 责任
- 不让 execution path 为了取 service/notice truth 而回调 `app-api` loopback HTTP
- 不让 tool 在 query time 重新扫描 raw notice/source bundle 来“临时算答案”
- 不把 retrieval steps 内联回 Execution Agent Layer routing
- 不让 planner 以 prompt-only 方式隐式决定未 admission 的 retrieval branch
- 不让 executor 在没有 plan truth 时自猜 current / historical / freshness 语义

## 相关稳定文档

- `docs/decisions/adr-0006-agent-orchestration-and-safety.md`
- historical internal execution admission ADR（target term is Execution Agent Layer）
- `docs/decisions/adr-0043-execution-control-docker-first-runtime.md`
- historical capability-neutral routing ADR（target term is Execution Agent Layer）
- `docs/architecture/system/capability-routing-and-admission-architecture.md`
- `docs/architecture/system/agentic-retrieval-architecture.md`
- `docs/architecture/system/prompt-and-instruction-architecture.md`
- `docs/reference/runtime-serving-and-index-terms.md`
