---
doc_type: architecture
status: active
created: 2026-04-23
updated: 2026-06-06
---
# Capability Routing And Admission Architecture

## 文档边界

本文冻结 `campus-agent` 在长期产品路径上的 `admission + capability routing` supporting
architecture。

它回答的是：

- 顶层产品入口应先做什么判断、后做什么判断
- `admission` 与 `routing` 应怎样分层
- `requested_scope`、`capability family`、clarification 分别属于哪一层
- `apps/app-api`、`execution-control` / current `apps/execution-control`、
  retired Python bridge、
  typed tools 与 agent-as-tool 各自负责什么

它不负责：

- 当前 merged truth 是否已经完成 capability-neutral routing
- 某一轮代码实施顺序
- 某个具体 capability family 的内部 planner / retrieval 细节

当前 merged truth 仍以 `docs/architecture/current-architecture.md` 为准。本文描述的是长期
supporting architecture，不得把它误读成“public chat 当前已经不是 knowledge-only”。

## Core Conclusion

`campus-agent` 的长期入口模型不是：

- 先把所有请求当成 generic knowledge/RAG 问题
- 再在知识路径里临时分叉出 notice、service、navigation

而是：

`surface intake -> admission / guardrails -> capability routing ->
workflow planning -> Temporal typed activity / agent-as-tool activity ->
execution finalization`

其中固定规则如下：

- 顶层默认先判定 `capability family`，而不是先判定 retrieval `scope`
- capability family 判定之后，Execution Agent Layer 再决定本次请求是 terminal、
  direct typed tool runtime、single agent-as-tool execution，还是 admitted
  multi-step workflow
- `requested_scope` 只属于 knowledge-family path，不是所有请求共享的顶层默认字段
- `admission` 与 `routing` 必须分层，避免把 authz、surface policy、approval-required 与
  domain reasoning 混在一起
- `admission` 还必须区分 surface admission、identity / quota admission、run
  admission、workflow/activity admission 与 task dispatch admission；process-local
  进程内 queue 只属于 execution-level local protection，不是 canonical production
  admission
- `knowledge` 仍是核心 capability family，但不再被默认等同于整个产品入口语义
- multi-capability / agent-as-tool 不是默认自由展开；它必须由 typed workflow plan、allowed
  capabilities / admitted agent-as-tool steps、allowed tools、step budget 与
  eval denominator admission
- deterministic domain capability 默认先建模为 typed tool / projection-backed
  internal query service；semantic specialist 只作为 agent-as-tool step 进入
  workflow

## Current Truth Vs Forward Truth

当前 repo 仍保持以下 merged truth：

- `public-chat-web -> app-api` 的公开 chat 请求当前只开放 `knowledge`
- `place_lookup` 在 execution contract 中仍存在，但当前产品路径继续 fail-close；
  地图 UI、route planning 与 `place_card` product consumption 等 navigation 能力等地图产品上线后再开放
- `notice`、`campus_services` 是已冻结的 semantic specialist family；internal
  execution wire 已接受显式 `notice` / `campus_services` capability label 并映射到对应
  lane，但它们还不是当前默认公开主路径

这些都属于当前 surface posture，而不是长期 routing architecture 的原则。

本文冻结的 forward truth 只有两条：

- 顶层 Execution Agent Layer 必须是 neutral capability router
- 不允许把 “当前公开主路径最成熟的是 knowledge QA” 反写成长期入口必须 `RAG-first`

## Layered Execution Shape

长期产品执行路径固定拆成六层：

1. `surface intake`
1. `admission / guardrails`
1. `capability routing`
1. `workflow planning`
1. `typed tool / agent-as-tool execution`
1. `execution finalization`

### 1. Surface Intake

surface intake 由 browser surface 与 shared `apps/app-api` 一起承担。

它长期负责：

- session / principal / operator context 解析
- surface-level request normalization
- surface capability allowlist 检查
- 最小 typed context projection

它长期不负责：

- domain reasoning
- retrieval planning
- 在多个 capability family 之间做最终 handoff

补充约束：

- `public-docs` 是 docs-first browser surface，不自动进入这条 execution routing path
- `public-chat-web`、future `服务状态`、future `校园地图` 可以拥有不同 capability set
- 单个 surface 的内部 IA 不自动升级成产品级 routing 原则

### 2. Admission / Guardrails

`admission` 是顶层 deterministic gate。

它长期负责：

- surface 是否允许该 capability
- authz / visibility / restricted posture
- approval-required
- hard reject
- 明显 `out_of_scope`
- per-user / per-org / per-conversation quota
- run creation / workflow start 是否可被 admitted
- durable step 是否可创建、排队到 Temporal activity task queue 并被 worker 消费

固定规则：

- `admission` 先于 `routing`
- prompt 不得覆盖 deterministic gate
- agent 不得反向放开上游已关闭的 capability 或 surface policy

长期 admission 分层固定为：

- `surface admission`
  - `apps/app-api` 拥有；判断 browser surface、caller class 与 capability allowlist
- `identity / quota admission`
  - `apps/app-api` 与 durable scheduler 共同消费；canonical identity truth 仍在
    `apps/app-api`
- `run admission`
  - `apps/execution-control` durable scheduler 拥有；判断是否创建 / 推进一个 run
- `step admission`
  - `apps/execution-control` durable scheduler 拥有；判断 typed step 是否允许排队、是否满足
    dependency、projection、ToolSpec / CapabilitySpec 与 lane 条件
- `activity dispatch admission`
  - target architecture 中由 Temporal workflow / task queue dispatch 与
    repo-owned budget policy 承接；判断 lane、worker、provider、Qdrant、
    Postgres 等 execution budget

当前 `EXECUTION_CONTROL_MAX_CONCURRENT_ANSWERS`、
`EXECUTION_CONTROL_QUEUE_CAPACITY` 与 `EXECUTION_CONTROL_QUEUE_TIMEOUT_MS` 只属于
current process-local execution protection。
它们不得替代 durable run admission 或 lease coordination。

### 3. Capability Routing

`routing` 是 Execution Agent Layer-owned 的中立 capability 决策层。

它长期只负责回答：

- 这次请求应该进入哪个 admitted capability family
- 当前是否需要 `routing clarification`
- 当前是否应直接 `delegate`、`approval_required`、`rejected` 或 `out_of_scope`

它长期不负责：

- knowledge-family 内部的 query rewrite
- retrieval `scope` 的细粒度解析
- notice/service/navigation 域内的最终业务解释

长期默认只路由到 repo admitted capability family / semantic specialist family，例如：

- `knowledge`
- `notice`
- `campus_services`
- `navigation`

如果明确接受新的 deterministic capability，它必须先以 repo-owned typed tool / internal query
service 入场；只有需要 semantic specialist 时才新增 family label，不能作为 hidden fallback。

### 4. Workflow Planning

`workflow planning` 是 Execution Agent Layer-owned 的 deterministic governance 层。它长期只负责回答：

- 本次请求是否只需要一个 agent
- 是否需要多个 bounded specialist agent 串行或并行参与
- 哪些 agent / tools 被允许
- 每一步的 input projection、output projection、timeout、budget 与 fail-close 条件是什么
- 哪些 cross-step context 可以进入下一步 prompt 或 finalization
- 本次 workflow 对 durable run / lane / lease / timeout 的要求是什么
- 哪些 durable step 必须由 typed tool 执行，哪些可以由 agent-as-tool 执行
- 哪些 Temporal workflow / activity task queue 被允许参与

固定规则：

- `workflow_plan` 不复制完整 prompt payload，不替代 bridge request
- multi-capability / agent-as-tool path 必须有 ordered step truth、context
  projection truth 与 trace denominator
- 并行 fanout 必须由 workflow plan 显式声明；不得让 provider 自由并发调用全局工具全集
- routing clarification 仍发生在 workflow planning 之前；agent clarification 只能发生在已选定
  family / step 内部
- Temporal workflow history 不替代 product projection；workflow/activity progress
  必须写入 repo-owned sanitized projection 后才能进入 panel / eval / badcase truth

### 5. Typed Tool / Agent-As-Tool Execution

一旦 capability family 已确定，deterministic data access 归 typed tool /
internal query service 拥有；semantic reasoning 归对应 agent-as-tool 拥有。

固定分工：

- `knowledge`
  - knowledge-family 内部 intent / ambiguity / clarification / retrieval planning、
    evidence verification、answer synthesis 与 grounding
- notice typed tools
  - notice discovery / selected notice ref resolution / source card / bounded
    context read
- `notice`
  - notice 候选消歧、historical posture、短摘要/事实抽取等 semantic specialist step
- campus services typed tools
  - structured current-state / process / directory / schedule lookup
- `campus_services`
  - campus services semantic disambiguation、跨工具编排、说明生成或 agent-owned clarification
- navigation typed tools / `navigation`
  - place / point deterministic read 与 navigation semantic specialist step

在 multi-step workflow 中，agent-as-tool execution 不等于 agent 之间自由互调。每个 step
只消费 workflow plan 允许的 typed input projection，并只返回 bounded typed output，例如
`StepOutputProjection`、evidence summary、change set、place context 或 grounding verdict。

### 6. Execution Finalization

Execution Agent Layer 长期继续统一负责：

- response finalization
- fail-close terminal semantics
- selected capability / selected tool / status / observability summary
- audit / operator projection 所需的 typed execution outcome

## Surface Capability Policy

`surface capability policy` 的长期 owner 固定为 `apps/app-api`。

直接含义：

- `public-chat-web` 当前 knowledge-only 是 surface posture
- `public-docs` 不消费 execution routing，不因此拥有 `knowledge` capability
- future `服务状态`、`校园地图` 等 surface 可以开放不同 capability set
- `apps/execution-control` 不拥有 product-layer surface allowlist truth

禁止做法：

- 把某个 surface 当前开放的 capability 直接写死成整个 repo 的长期入口原则
- 让 `apps/execution-control` 或 agent 反向拥有 browser-facing capability policy

## Capability Family First, Scope Second

长期规则固定为：

- 顶层先解析 capability family
- 只有进入 knowledge-family path 后，才进一步解析 retrieval `scope`

因此：

- `requested_scope` 不是顶层普适入口字段
- `requested_scope` 不应用来替代 capability routing
- retrieval / serving supporting architecture 只在 capability 已进入 knowledge-family
  path 后生效

在当前 repo 里，这意味着：

- `docs/architecture/system/retrieval-serving-architecture.md`
  只描述 knowledge-family 内部 retrieval truth
- `docs/architecture/system/agentic-retrieval-architecture.md`
  只描述 knowledge-family 的 target-state planner/executor shape

## Clarification Split

长期固定区分两类 clarification：

- `routing clarification`
  - 顶层尚不能稳定判定 capability family 或缺少进入某个 family 的关键路由槽位
- `agent clarification`
  - 已经选定 capability family，但该 family 内部仍需要 disambiguation / slot completion

固定规则：

- `routing clarification` 由 Execution Agent Layer 触发
- `agent clarification` 由对应 agent 触发
- 两者不得在 observability、eval truth 或 contract 语义上混成一个模糊的 clarification 桶

## Routing Intent

长期上，Execution Agent Layer 的顶层 routing 输出必须是 typed routing intent，而不是 prompt 内部隐式决策。

它至少应显式表达：

- admitted capability family
- workflow mode
- allowed capabilities / allowed tools / admitted agent-as-tool summary
- task kind
- next action
- risk level
- missing slots
- policy reason
- optional knowledge-family-specific `requested_scope`
- optional routing confidence / routing summary

补充约束：

- 本文冻结的是概念 contract，而不是当前 wire shape
- 当前 internal execution contract 仍以 `requested_capability + optional
  requested_scope` 为 current truth
- forward wire shape 的演进由 legacy-named app-api execution contract 补充说明

## Observability And Evaluation

capability routing 不是纯 prompt 细节，必须进入长期 observability / eval truth。

至少需要可追踪：

- requested capability hint
- finalized selected capability
- workflow mode 与 selected step sequence
- cross-step context projection summary
- routing / agent clarification 区分
- policy / scope / approval 分支
- requested scope 与 resolved scope 的分层

固定规则：

- routing changes 进入 release path 前必须有独立 eval
- 不能只用最终 answer quality 掩盖顶层路由错误
- operator-facing summary 必须能区分“路由错了”“step planning 错了”“typed tool 失败”
  和“进入正确 agent-as-tool 但证据不足”

## Forbidden Shapes

- 不把所有请求默认压成 `knowledge`，再在 knowledge path 内临时 patch 其他能力
- 不用 `requested_scope` 充当 capability family 的代理字段
- 不让 agent 反向改写 surface capability policy
- 不把 structured runtime capability 伪装成 generic retrieval fallback
- 不让 browser surface 绕开 `app-api` 直接推理最终 capability routing
- 不把 `routing clarification` 与 `agent clarification` 混成一个模糊状态
- 不把 deterministic typed tool 包装成没有语义职责的 agent
- 不让 K8s、Redis、provider trace 或 SDK graph 成为 admission / queue / lease truth

## 相关稳定文档

- `docs/architecture/product-positioning.md`
- `docs/architecture/system/product-runtime-architecture.md`
- `docs/architecture/system/execution-and-agents-architecture.md`
- `docs/architecture/system/retrieval-serving-architecture.md`
- `docs/architecture/system/agentic-retrieval-architecture.md`
- `docs/contracts/capability-execution.md`（legacy filename；active owner
  是 Execution Agent Layer）
- `docs/decisions/adr-0006-agent-orchestration-and-safety.md`
- `docs/decisions/adr-0017-supervisor-internal-execution-admission.md`（historical
  ADR filename）
