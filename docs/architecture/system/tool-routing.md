---
doc_type: architecture
truth_scope: execution
owner_boundary: execution-control
status: active
created: 2026-04-23
updated: 2026-06-27
---
# Tool Routing And Admission Architecture

## 文档边界

本文冻结 `campus-agent` 在长期产品路径上的 `admission + tool routing` supporting
architecture。

它回答的是：

- 顶层产品入口应先做什么判断、后做什么判断
- `admission` 与 `routing` 应怎样分层
- `requested_scope`、model-visible tool / workflow signal、clarification 分别属于哪一层
- `apps/app-api`、`execution-control` / current `apps/execution-control`、
  retired Python bridge、
  typed tools 与 agent-as-tool 各自负责什么

它不负责：

- 当前 merged truth 是否已经完成 primary-agent-first tool routing
- 某一轮代码实施顺序
- 某个具体 tool 的内部 planner / retrieval 细节

当前 merged truth 仍以 `docs/architecture/current.md` 为准。本文描述的是长期
supporting architecture，不得把它误读成“online answer 当前已经不是 knowledge-only”。

## Core Conclusion

`campus-agent` 的长期入口模型不是：

- 先把所有请求当成 generic knowledge/RAG 问题
- 再在知识路径里临时分叉出 notice、service、navigation

而是：

`surface intake -> admission / guardrails -> durable run creation ->
primary agent first decision -> direct/no-tool terminal or admitted tool /
workflow signal -> typed tool / RAG graph / agent-as-tool activity ->
execution finalization`

其中固定规则如下：

- 顶层默认先做 first Execution Agent decision，判断请求是否可在产品边界内
  直接回答 / 澄清 / 拒绝 / fail closed，还是需要调用某个 campus tool
- 只有当 first decision 判断需要校园工具时，才通过已暴露 tool /
  workflow signal 进入对应的 tool execution path；此时仍然是先选择 tool /
  workflow signal，而不是先判 retrieval `scope`
- tool / workflow signal 选定之后，Execution Agent Layer 只负责把 selected tool /
  workflow signal 纳入 durable workflow、step admission 与 sanitized projection；
  它不再用旧 `plan.route` 抢占普通 chat 的第一语义决策
- `requested_scope` 只属于 `knowledge_query` path，不是所有请求共享的顶层默认字段
- `requested_tool` 是 explicit caller hint / compatibility field；普通
  chat 缺失该字段时，目标态不得由 `app-api` 或 `execution-control` 默认伪造成
  `knowledge`
- `admission` 与 `routing` 必须分层，避免把 surface policy、tool readiness、run
  budget 与
  tool reasoning 混在一起
- `admission` 还必须区分 surface admission、account / quota admission、run
  admission、workflow/activity admission 与 task dispatch admission；process-local
  进程内 queue 只属于 execution-level local protection，不是 canonical production
  admission
- `knowledge_query` 仍是核心 workflow signal，但不再被默认等同于整个产品入口语义
- multi-tool / agent-as-tool 不是默认自由展开；它必须由 typed workflow plan、admitted
  agent-as-tool steps、allowed tools、step budget 与
  eval denominator admission
- deterministic domain ability 默认先建模为 typed tool / projection-backed
  internal query service；semantic specialist 只作为 agent-as-tool step 进入
  workflow

## Current Truth Vs Forward Truth

当前 repo 仍保持以下 current / implementation truth：

- 公开 chat posture 曾长期以 `knowledge` 为默认主路径；当前 accepted path 已接入
  `agent.primary`，且 Go `execution-control`
  已停止把缺失 `requested_tool` 默认写成 `knowledge_query`
- `place_lookup` 在 execution contract 中仍存在，但当前产品路径继续 fail-close；
  地图 UI、route planning 与 `place_card` product consumption 等 navigation 能力等地图产品上线后再开放
- `notice`、`campus_services` 只作为现存 wire / projection label 保留；当前
  model-visible opening 以具体 tool 为准，例如 `transport_schedule_lookup`、
  `campus_notice_discover`。它们还不是当前默认公开主路径的泛化能力集合。

这些都属于当前 surface posture，而不是长期 routing architecture 的原则。

本文冻结的 forward truth 只有两条：

- 顶层 Execution Agent Layer 必须是 neutral tool router
- 不允许把 “当前公开主路径最成熟的是 knowledge QA” 反写成长期入口必须 `RAG-first`
- 普通 chat 未显式传 `requested_tool` 时，目标态 first decision 必须由
  primary agent 在 surface admitted tool set 内完成

## Primary Agent Routing Guardrails

Primary-agent-first routing means the model chooses between direct/no-tool
terminal output and admitted model-visible tools. It does not mean every
product behavior becomes a tool.

Guardrails:

- Missing `requested_tool` is absence of a legacy caller hint, not an implicit
  request for `knowledge_query`.
- `requested_tool` and `selected_tool` remain legacy-named compatibility
  projection fields; new concept names must not copy that legacy wire wording
  unless the wire contract itself is being updated.
- Product self-introduction, greetings, product boundary explanation,
  clarification and rejection are terminal intents, not synthetic tools.
- Model-visible tool choice must be constrained by deterministic surface
  admission, runtime profile opening and the repo tool registry.
- Routing decisions must be projected into operator/eval-safe facts; a hidden
  prompt-only route is not sufficient for durable execution.

## Layered Execution Shape

长期产品执行路径固定拆成六层：

1. `surface intake`
1. `admission / guardrails`
1. `primary agent first decision`
1. `tool / workflow-signal projection when tools are needed`
1. `typed tool / agent-as-tool execution`
1. `execution finalization`

### 1. Surface Intake

surface intake 由 browser surface 与 shared `apps/app-api` 一起承担。

它长期负责：

- session / principal / operator context 解析
- surface-level request normalization
- surface tool allowlist 检查
- 最小 typed context projection
- optional explicit caller hint normalization，例如保留 `requestedTool`
  作为 compatibility hint

它长期不负责：

- domain reasoning
- retrieval planning
- 在多个 tool 之间做最终 handoff
- 缺失 `requestedTool` 时伪造 `knowledge`

补充约束：

- `campus-web /docs/*` 是 docs-first reader surface，不自动进入这条 execution routing path
- `campus-web` Q&A、future `服务状态`、future `校园地图` 可以拥有不同 tool set
- 单个 surface 的内部 IA 不自动升级成产品级 routing 原则

### 2. Admission / Guardrails

`admission` 是顶层 deterministic gate。

它长期负责：

- surface 是否允许该 tool
- tool 是否成熟并对该 surface opened
- tool 是否只读、typed、admitted，并具备 source truth / result contract
- hard reject
- 明显 `out_of_scope`
- per-user / per-conversation quota
- run creation / workflow start 是否可被 admitted
- durable step 是否可创建、排队到 Temporal activity task queue 并被 worker 消费

固定规则：

- `admission` 先于 `routing`
- prompt 不得覆盖 deterministic gate
- agent 不得反向放开上游已关闭的 tool 或 surface policy

长期 admission 分层固定为：

- `surface admission`
  - `apps/app-api` 拥有；判断 browser surface、caller class 与 tool allowlist
- `account / quota admission`
  - `apps/app-api` 与 durable scheduler 共同消费；canonical account/session truth 仍在
    `apps/app-api`
- `run admission`
  - `apps/execution-control` durable scheduler 拥有；判断是否创建 / 推进一个 run
- `step admission`
  - `apps/execution-control` durable scheduler 拥有；判断 typed step 是否允许排队、是否满足
    dependency、projection、ToolSpec 与 worker / queue 条件
- `activity dispatch admission`
  - target architecture 中由 Temporal workflow / task queue dispatch 与
    repo-owned budget policy 承接；判断 execution group、worker、provider、Qdrant、
    Postgres 等 execution budget

当前 runtime profile 中的 admission budget 只属于 current process-local
execution protection。它不得替代 durable run admission 或 lease coordination。

### 3. First Execution Agent Decision

`first Execution Agent decision` 是进入 provider / model reasoning 的第一层
产品语义判断。目标态由 primary agent runtime 承接；它消费 app-api 投影后的
session / actor / surface context、repo-global invariants、allowed tool set
与 user input。

它长期只负责回答：

- 当前请求是否属于产品边界内的普通对话、产品自我说明、澄清或拒绝
- 当前请求是否需要调用 campus tool / typed tool / agent-as-tool
- 若需要工具，应调用哪个 model-visible read-only tool 或 workflow signal
- 若不需要工具，terminal branch 的 user-facing answer / clarification /
  reject / fail-close outcome 是什么

固定规则：

- `hi 你是谁`、产品边界说明、普通寒暄等不应被建模成
  `assistant_intro`、`product_meta` 或其他 synthetic tool
- first decision 必须受 repo-global invariants 与 surface admission 约束；它不能
  打开被 deterministic gate 关闭的 tool
- first decision 的 direct/no-tool terminal outcome 必须进入 sanitized
  projection、workflow trace summary 或等价 operator-safe projection，不能只作为
  transient prompt text 存在
- 当前 accepted path 已把 first decision 接入 `agent.primary`，且
  `execution-control` 已停止把缺失 `requested_tool` 默认写成 `knowledge_query`。
  目标态应向 OpenAI Agents SDK primary agent 暴露 workflow 裁剪后的 visible
  tool set，由模型决定
  是否直接 no-tool 回答或调用已开放工具。knowledge path 对 primary agent
  只暴露 `knowledge_query` workflow signal；该 signal 只选择进入 Go-owned RAG
  Temporal graph，不暴露 `retrieval.query` 或 raw retrieval endpoint。Go
  `execution-control` 仍拥有 deterministic admission、visible tool 裁剪、
  Temporal timeout/cancel、RAG graph execution 与 finalization。对
  campus-services / notice 这类 model-selected read-only typed tool，SDK loop
  内部调用 execution-control internal query 后，execution-control 会把 success /
  fail-close result 归一化成 `sdk_tool.execute.<tool>.<index>` step / result
  projection，避免 tool 可调用性只停留在 SDK trace 或 finalization payload。
  这些工具的 payload/result contract 以已登记 JSON Schema `$defs` 为准；
  Python dataclass、Zod parser 或 Go struct 只属于本地解析 / helper 层。

OpenAI 官方 Responses / tools 文档给出的成熟 agent 形态是：通过系统级
instructions 约束模型，并把工具以结构化 `tools` 配置暴露给模型，由模型基于
prompt 判断是否调用已配置工具，必要时用 `tool_choice` 约束行为。本文目标态
采用同样原则：工具选择属于第一 agent decision 的结构化能力，而不是把每个
产品说明或寒暄都拆成一个 tool。

### 4. Tool Routing

`routing` 是 primary agent selected tool / workflow signal 被 durable workflow
接纳后的治理投影，不再是普通 chat 的独立第一语义入口。

它长期只负责回答：

- 这次请求应该执行哪个 admitted tool / workflow signal
- 当前是否需要 `routing clarification`
- 当前是否应直接 `tool_required`、`rejected`、`out_of_scope` 或进入内部
  `tool_not_ready` / `unsupported_by_evidence` terminal branch

它长期不负责：

- `knowledge_query` 内部的 query rewrite
- retrieval `scope` 的细粒度解析
- notice/service/navigation 域内的最终业务解释
- 抢在 primary agent 之前把缺失 tool 的普通 chat 默认改写成 `knowledge_query`

长期默认只路由到 repo admitted model-visible tools / workflow signals，例如：

- `knowledge_query`
- `campus_notice_discover`
- `campus_notice_period_summary`
- `transport_schedule_lookup`

如果明确接受新的 deterministic ability，它必须先以 repo-owned typed tool / internal query
service 入场；只有需要 semantic specialist 时才新增 agent-as-tool step，不能作为 hidden fallback。

### 5. Workflow Planning

`workflow planning` 是 Execution Agent Layer-owned 的 deterministic governance 层。它长期只负责回答：

- 本次请求是否只需要一个 agent
- 是否需要多个 bounded specialist agent 串行或并行参与
- 哪些 agent / tools 被允许
- 每一步的 input projection、output projection、timeout、budget 与 fail-close 条件是什么
- 哪些 cross-step context 可以进入下一步 prompt 或 finalization
- 本次 workflow 对 durable run / execution group / lease / timeout 的要求是什么
- 哪些 durable step 必须由 typed tool 执行，哪些可以由 agent-as-tool 执行
- 哪些 Temporal workflow / activity task queue 被允许参与

固定规则：

- `workflow_plan` 不复制完整 prompt payload，不替代 bridge request
- multi-tool / agent-as-tool path 必须有 ordered step truth、context
  projection truth 与 trace denominator
- 并行 fanout 必须由 workflow plan 显式声明；不得让 provider 自由并发调用全局工具全集
- routing clarification 仍发生在 workflow planning 之前；agent clarification 只能发生在已选定
  tool / step 内部
- Temporal workflow history 不替代 product projection；workflow/activity progress
  必须写入 repo-owned sanitized projection 后才能进入 Operator Console / eval / badcase truth

### 6. Typed Tool / Agent-As-Tool Execution

一旦 tool 已确定，deterministic data access 归 typed tool /
internal query service 拥有；semantic reasoning 归对应 agent-as-tool 拥有。

固定分工：

- `knowledge`
  - `knowledge_query` 内部 intent / ambiguity / clarification / retrieval planning、
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

### 7. Execution Finalization

Execution Agent Layer 长期继续统一负责：

- response finalization
- fail-close terminal semantics
- selected tool / status / observability summary
- audit / operator projection 所需的 typed execution outcome

## Surface Tool Policy

`surface tool policy` 的长期 owner 固定为 `apps/app-api`。

直接含义：

- `campus-web` Q&A 的当前 tool set 是 surface posture
- `campus-web /docs/*` 不消费 execution routing，不因此拥有 `knowledge_query` tool
- future `服务状态`、`校园地图` 等 surface 可以开放不同 tool set
- `apps/execution-control` 不拥有 product-layer surface allowlist truth

surface policy 只区分产品入口，不表达学生 / 教职工 / 院系之间的普通问答 tool 差异：

- `chat` 面向普通用户开放成熟 read-only campus tools
- `ops / panel` 面向 operator 开放校对、eval、badcase、ingestion / release 管理
- `internal` 仅承接 query function、data-plane、debug 或 runtime-only seam

禁止做法：

- 把某个 surface 当前开放的 tool 直接写死成整个 repo 的长期入口原则
- 让 `apps/execution-control` 或 agent 反向拥有 browser-facing tool policy

## Tool First, Scope Second

长期规则固定为：

- 顶层先选择 model-visible tool / workflow signal
- 只有进入 `knowledge_query` path 后，才进一步解析 retrieval `scope`

因此：

- `requested_scope` 不是顶层普适入口字段
- `requested_scope` 不应用来替代 tool routing
- retrieval / serving supporting architecture 只在 tool 已进入 `knowledge_query`
  path 后生效

在当前 repo 里，这意味着：

- `docs/architecture/system/retrieval-serving.md`
  只描述 `knowledge_query` 内部 retrieval truth
- `docs/architecture/system/agentic-retrieval.md`
  只描述 `knowledge_query` 的 target-state planner/executor shape

## Clarification Split

长期固定区分两类 clarification：

- `routing clarification`
  - 顶层尚不能稳定判定 tool / workflow signal 或缺少进入某个 tool 的关键路由槽位
- `agent clarification`
  - 已经选定 tool，但该 tool / agent-as-tool step 内部仍需要 disambiguation / slot completion

固定规则：

- `routing clarification` 由 Execution Agent Layer 触发
- `agent clarification` 由对应 agent 触发
- 两者不得在 observability、eval truth 或 contract 语义上混成一个模糊的 clarification 桶

## Routing Intent

长期上，primary agent 的顶层工具选择必须被投影为 typed routing intent，而不是只停留在
未结构化、不可观测的 prompt 内部隐式决策。

它至少应显式表达：

- admitted tool / workflow signal
- workflow mode
- allowed tools / admitted agent-as-tool summary
- task kind
- next action
- risk level
- missing slots
- policy reason
- optional `knowledge_query`-specific `requested_scope`
- optional routing confidence / routing summary

first Execution Agent decision 还必须能表达 no-tool terminal intent，例如：

- `direct_answer`
- `clarification`
- `reject`
- `out_of_scope`
- `unsupported_or_not_grounded`

这些 terminal intent 不等于 tool id，legacy `selected_tool`
compatibility field 可以为空或 `none`，但必须保留 decision provenance、LLM
I/O schema provenance 与 fail-close reason。

补充约束：

- 本文冻结的是概念 contract，而不是当前 wire shape
- 当前 internal execution contract 仍保留 `requested_tool + optional
  requested_scope` 作为 legacy-named compatibility wire shape
- forward wire shape 的演进由 legacy-named app-api execution contract 补充说明

## Observability And Evaluation

tool routing 不是纯 prompt 细节，必须进入长期 observability / eval truth。

至少需要可追踪：

- requested tool hint through legacy `requested_tool` compatibility field
- finalized selected tool / legacy `selected_tool` compatibility field
- workflow mode 与 selected step sequence
- cross-step context projection summary
- routing / agent clarification 区分
- policy / scope / opening posture 分支
- requested scope 与 resolved scope 的分层

固定规则：

- routing changes 进入 release path 前必须有独立 eval
- 不能只用最终 answer quality 掩盖顶层路由错误
- operator-facing summary 必须能区分“路由错了”“step planning 错了”“typed tool 失败”
  和“进入正确 agent-as-tool 但证据不足”

## Forbidden Shapes

- 不把所有请求默认压成 `knowledge_query`，再在 knowledge path 内临时 patch 其他能力
- 不为 product self-introduction、普通寒暄或能力边界说明新增
  `assistant_intro`、`product_meta`、`surface prompt profile`、`product persona`
  等 synthetic tool / persona 分支
- 不用 `requested_scope` 充当 tool 的代理字段
- 不让 agent 反向改写 surface tool policy
- 不把 tool read model tool 伪装成 generic retrieval fallback
- 不让 browser surface 绕开 `app-api` 直接推理最终 tool routing
- 不把 `routing clarification` 与 `agent clarification` 混成一个模糊状态
- 不把 deterministic typed tool 包装成没有语义职责的 agent
- 不让 K8s、Redis、provider trace 或 SDK graph 成为 admission / queue / lease truth

## 相关稳定文档

- `docs/architecture/product.md`
- `docs/architecture/system/product-runtime.md`
- `docs/architecture/system/execution-agent-layer.md`
- `docs/architecture/system/tool-runtime.md`
- `docs/architecture/system/retrieval-serving.md`
- `docs/architecture/system/agentic-retrieval.md`
- `docs/contracts/tool-execution.md`（legacy-named execution wire contract）
- `docs/decisions/adr-0006-agent-orchestration-and-safety.md`
- `docs/decisions/adr-0017-supervisor-internal-execution-admission.md`（historical
  ADR filename）
