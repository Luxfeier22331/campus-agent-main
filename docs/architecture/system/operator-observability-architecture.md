---
doc_type: architecture
truth_scope: ops
owner_boundary: app-api
status: active
created: 2026-04-02
updated: 2026-06-13
---
# Operator Observability Architecture

## 文档边界

本文冻结 Operator Console observability domain、operator audit、quality monitoring、safety
monitoring、cost monitoring 与 observability sink participation 的 supporting architecture。

它回答的是：

- operator-facing observability / audit / quality surface 应该长成什么形态
- Operator Console surfaces、`app-api`、telemetry sinks 各自负责什么
- 哪些指标属于长期必须持续监控的最小集合
- `Sentry`、`Axiom` 与 sampled grading / evals 如何参与，而不反向成为 Operator Console truth

它不负责：

- 当前哪些 operator API 已经落地
- 某个 dashboard 的最终布局
- alert threshold、retention、sampling ratio 的具体数值
- 某个 sink SDK 的逐字段接入细节

## Core Conclusion

长期 operator observability 形态固定为：

- Operator Console 是长期 operator control-plane surface；当前 read-only implementation
  surface 是 `operator-console-web`
- `apps/app-api` 是 operator-facing audit / quality / safety / cost read-model
  owner
- `Sentry`、`Axiom`、OpenAI trace / eval tooling 是 observability / debugging /
  grading sinks
- Operator Console 只能消费 runtime-owned APIs，不直接读取 raw audit log、telemetry sink 或
  `apps/execution-control`

因此长期主链路固定为：

`operator browser -> operator console surface -> app-api operator read surfaces`

与之并行的 observability chain 固定为：

`runtime boundary -> OTel-first telemetry / trace identity -> sink fan-out ->
debugging / analysis / grading`

二者相关，但不是同一条数据面。

## Operator Domain Model

长期 operator-facing observability 域固定拆成：

- `Overview`
  - 全局 SLO、告警摘要、最近异常、sink health
- `Runtime Health`
  - execution-control readyz 的 operator-safe projection、Temporal required task queue
    poller health、run projection store readiness；它只能由 `app-api`
    operator endpoint 暴露，不是 Temporal Dashboard、raw history viewer 或 metrics
    explorer
- `Requests`
  - request list/detail、step timeline、trace correlation、projection-friendly diagnostics
- `Quality`
  - retrieval quality、citation coverage、refusal distribution、badcase sampling
- `Safety/Boundary`
  - capability readiness、source / evidence fail-close posture、projection anomaly
    与 memory boundary diagnostics
- `Cost`
  - token usage、estimated cost、model / target / surface 分布
- `Audit`
  - request-scoped timeline、operator action timeline、governance explanation
- `Official Web`
  - `official_web` control plane；它仍是独立 operator domain，不退化成通用 infra console

这些域都属于 operator-facing read model，不等于 raw sink explorer。

`Runtime Health` 的固定路径是：

`operator browser -> operator console surface -> app-api /api/operator/runtime/health
-> execution-control /readyz projection`

规则：

- Operator Console 不直接访问 `apps/execution-control`、Temporal service、
  Prometheus、Sentry、Axiom 或 PG。
- `app-api` 可以把 `execution-control /readyz` 的 200/503 structured payload 转成
  operator-safe runtime health projection；503 只表示执行平面明确报告 degraded，不表示前端可以绕过
  app-api 直接查基础设施。
- 缺配置、网络错误、鉴权错误、非 JSON 或非 readyz projection 错误仍 fail closed；不得在 Operator Console
  消费层猜测 runtime 状态。

## Execution Projection Spine

Operator observability 的目标诊断主线固定为 repo-owned execution projection
spine：

`Run -> RunEvent -> RunStep -> StepAttempt -> StepResult -> Finalization`

固定规则：

- Operator Console `Requests` detail、quality badcase、eval candidate 与 release_evidence
  必须以 step trajectory 作为共同诊断口径。
- `workflow_trace_summary` 只保留为 operator-safe compatibility summary，用于展示
  bounded workflow mode、artifact refs 与历史摘要字段；它不是 canonical diagnostic
  projection。
- Temporal history、Sentry、Axiom、OpenAI trace / eval tooling 与 provider raw trace
  只能作为 debugging、analysis、grading 或 backlink 输入，不得成为 Operator Console query truth。
- Operator Console 可以把 step trajectory 渲染成 timeline，但 truth synthesis
  仍归 `apps/app-api` operator read model；console 不从 runtime-internal package、sink
  query 或 execution-control response 拼装诊断事实。

## Operator-Safe Trajectory Diagnostics Contract

eval、badcase 与后续 release_evidence 不再各自解释 `workflow_trace_summary` 或
runtime-specific payload。它们共同消费 app-api 物化后的 operator-safe trajectory
diagnostics contract：

`app-api operator request detail / export -> operator_step_trajectory.v1 ->
eval attribution / badcase projection / release_evidence fixture`

第一版契约目标：

- 保持 operator ownership：本文只冻结 operator_diagnostic_evidence 的消费口径，不要求真实
  ops run、真实 Temporal metrics 或真实 release closeout。
- 保持 app-api ownership：输入只能来自 app-api operator read model 或与其同形的
  sanitized export fixture，不得读取 Temporal history、execution-control internal
  endpoint、raw provider trace、raw prompt、raw answer、raw transcript 或 local object
  path。
- 保持共同归因：每个 eval failure、badcase 或 future release_evidence item 必须能关联
  到 step trajectory 中的阶段、capability、tool、attempt outcome 与 projection refs；无法关联时
  必须显式标记 `trajectory_missing` / `attribution_missing`，不得从 raw artifact 猜测。
- 保持兼容摘要降级：`workflow_trace_summary` 可以继续为 Operator Console / eval 提供 bounded
  display summary，但不得作为 canonical diagnostic source，也不得反向覆盖 step
  trajectory。

`operator_step_trajectory.v1` 的最小诊断字段族固定为：

- run identity：`request_id`、`run_id`、`trace_id`、`conversation_id`
- step identity：`step_id`、`step_kind`、`capability`、`tool_name`、`status`
- execution metadata：task queue / worker metadata、attempt count、queue wait、duration
- outcome metadata：fail-close reason、terminal reason、replan reason、cancel outcome、
  timeout outcome、late-completion outcome
- model / cost metadata：provider、model、input / output / cached tokens、estimated
  cost
- projection refs：result refs、answer artifact refs、evidence / retrieval / grounding
  projection refs where available
- primary-agent metadata：`agent.primary` step 的 `selected_tools`、
  `terminal_reason`、`sdk_trace_ref` 与 bounded `tool_result_refs`；SDK raw trace 只能作为
  backlink/debug sink，不能替代 sanitized step result projection

消费者职责：

- eval normalizer 负责把 app-api export 转成 stable diagnostic observation，不拥有
  runtime truth。
- badcase projection 负责把低分、失败或人工复核项绑定到 sanitized step attribution，不读取
  raw artifact。
- release_evidence 消费必须通过同一个 operator-safe trajectory export。本文不定义
  ops closeout 是否充分，也不把 release_evidence 反写成 main-chain completion 条件。

## Ownership Model

### Operator Console surface

- current read-only implementation surface is `apps/operator-console-web`
- protected operator UI shell
- 只消费 runtime APIs
- 只承担 BFF / route shell / operator UX，不承担 operator truth synthesis

### `apps/app-api`

长期负责：

- operator request projection
- operator audit projection
- operator quality / safety / cost aggregate read surfaces
- operator-facing access / boundary interpretation
- request identity、trace correlation、projection materialization 与 aggregate
  publication

它不负责：

- 让 Operator Console 直接回放 raw execution payload
- 让 sink query 反向成为长期 operator API

### `apps/execution-control`

- 继续只是 execution engine
- 不承担 operator observability query backend
- Docker-side Go `apps/execution-control` runtime 可以产生 execution audit events，但只能通过
  `app-api` internal ingest 写入 app-owned outbox / projection，不直接服务 Operator Console

### Telemetry / Evaluation Sinks

- 负责 debugging、high-volume analysis、sampled grading、release_evidence 输入
- 不承担 Operator Console canonical read model

## Execution Audit Backflow

Go `apps/execution-control` runtime 负责 admission、queue/backpressure、timeout、
cancel 与 bridge failure 等 runtime kernel 事实。它产生的 execution audit
events 只能按以下路径进入 Operator Console：

`execution-control execution event` -> `app-api internal ingest` ->
`runtime.projection_outbox` -> `operator.request_audit_projection` ->
`operator console surface`

第一版允许进入 audit timeline 的 execution event type 固定为：

- `execution.admission_rejected`
- `execution.cancel_requested`
- `execution.cancelled`
- `execution.bridge_failed`
- `execution.timed_out`

规则：

- `app-api` 继续是 audit projection owner；`execution-control` 不写 Postgres、不提供
  operator query backend
- `app-api` execution audit ingest 成功后必须调度 request-scoped projector drain；
  scheduled drain 只承担周期性一致性检查，不承担 answer path 的补救语义
- ingest payload 只允许 `request_id`、`trace_id`、lane、decision、failure kind、
  duration、queue wait、bridge duration、HTTP status、retryable 等 safe fields
- payload 禁止 raw prompt、raw answer、raw transcript、auth material、retrieval
  payload、provider raw response
- `Sentry` 与 `Axiom` 可以接收同类 sanitized event 用于 trace / analysis / alert，
  但 Operator Console 不得直接查询这些 sink
- `app-api` 可以按 optional deep-link template 把 request trace / issue backlink 写入
  `operator.trace_backlink_projection`；这是 app-owned projection write，不是
  Operator Console route-time sink query
- Go `execution-control` 的 execution audit writer 开启后必须同步发送每个 safe audit
  event；sink 不可用时 answer path fail closed。`/readyz` / `/metrics` 必须暴露
  enabled、configured、emitted、failed 与 last error，便于 operator 诊断投递状态。

## Read-Model Families

长期至少保留以下 operator-facing read-model family：

- `request projection`
  - request list/detail 的 canonical read model
- `request-scoped observability fact`
  - app-owned runtime fact family，用于 rollup、request observability detail、grading
    / reconciliation join
- `request audit projection`
  - request-scoped governance / timeline view
- `metric rollup`
  - time-window aggregate，用于 Overview / Quality / Safety / Cost
- `quality grade projection`
  - sampled trace grading、badcase review、grader output、人工复核结果

其中：

- `request projection`、`request audit projection`、`metric rollup`、`quality grade
  projection` 属于 operator-facing read model
- `request-scoped observability fact` 属于 app-owned runtime fact family，不等于
  Operator Console list/detail read model

这些 family 都必须由 `app-api` 或其继任 shared app boundary 拥有；Operator Console 不得通过
raw sink、数据库直连或 runtime-internal package import 拼装它们。

## Current-State Ownership

This document owns operator observability supporting architecture, not current
rollout status. Current accepted operator surfaces and runtime facts belong in
`../current-architecture.md`; active work signals belong in `.planning/`;
operational proof and closeout belong in runbooks.

Do not add rollout-progress lists here. New durable observability facts should
be promoted to the owning class: architecture boundary here, HTTP contract in
`docs/contracts/`, schema/read-model truth in `docs/data/`, ADR reasoning in
`docs/decisions/`, and operational procedure in `docs/runbooks/`.

## Monitoring Taxonomy

长期必须持续监控的最小指标集合包括：

- latency
  - request end-to-end latency
  - retrieval latency
  - generation latency
  - projection lag
- request failure rate
  - validation failure
  - downstream failure
  - timeout
  - internal error
- empty recall rate
  - 只对发生 retrieval attempt 的请求计数
- citation miss rate
  - 只对 citation-expected grounded answer 计数
- refusal / fail-close rate
  - 必须拆分 `no_answer`、`needs_clarification`、`rejected`、`error`
- boundary anomaly rate
  - projection 缺失、冲突、fail-open suspicion、unopened source / capability risk
- token usage / token cost
  - input / output / cache hit usage
  - near-real-time estimated cost
- observability health
  - missing trace rate
  - audit projection failure
  - telemetry drop suspicion
- planner quality
  - invalid plan rate
  - replan rate
  - planner abort rate
- retrieval execution quality
  - step failure rate
  - merge / dedupe collapse rate
  - rerank drop rate
- freshness / live branch
  - freshness gate hit rate
  - freshness fail-close rate
  - live retrieval usage rate
  - live retrieval fail-close rate

这些指标默认至少按以下维度支持切分：

- `surface`
- `selected_capability`
- `requested_capability`
- `requested_scope`
- `principal_type`
- `collection` / `source family`
- `model`

## Raw Target And Derived Label Rule

`selected_capability` 的长期职责固定为 raw capability dimension。

它继续用于：

- storage / filter truth
- telemetry sink correlation
- deterministic runtime assertions
- operator debug / drill-down 时的原始执行目标定位

它不直接承担：

- operator-facing capability family wording
- Operator Console 默认展示标签
- report / summary 的 family grouping

如果 operator surface 需要展示或分组，必须通过显式 projection 派生，例如：

- `selected_capability`
  - raw capability id，例如 `knowledge`
- `capability_family`
  - family wording，例如 `knowledge`
- `selected_capability_label`
  - operator-facing display label，例如 `知识问答`

固定约束：

- raw `selected_capability` 不能被 schema rename、display copy 或 report summary 静默重载
- Operator Console 默认展示 derived label / display label；只有 debug/filter surface
  才直接暴露 raw capability id
- 如果未来 admission 新 capability family，也必须先补 mapping / projection，再开放 operator-facing
  wording

## Agentic Retrieval Monitoring Extension

长期 full agentic RAG 至少还要补以下 operator-facing summary truth：

- `retrieval_plan_summary`
  - query mode、step count、replan count、budget outcome
- `query_activity_summary`
  - step outcomes、step latency、step target scopes
- `supporting_evidence_summary`
  - answer-bearing source count、trust tier、freshness branch
- `live_branch_summary`
  - 是否触发 live retrieval、是否 fail-close、失败原因

这些 summary 必须继续是 observability-safe typed projection，不得把 raw prompt、 raw snippet
dump 或 raw vendor payload 直接暴露给 panel。

## Governed Multi-Agent Workflow Monitoring Extension

长期 multi-capability / agent-as-tool workflow 至少还要补以下 operator-facing summary truth：

- `first_decision_summary`
  - terminal intent、direct/no-tool vs capability-required branch、decision
    version、prompt/instruction version、selected capability/tool if any、fail-close
    reason 与 no-tool answer provenance
- `workflow_plan_summary`
  - workflow mode、planner version、selected step sequence、allowed capabilities /
    allowed tools、admitted agent-as-tool steps、budget posture 与 terminal policy
- `capability_step_summary`
  - 每个 step 的 capability family / admitted agent-as-tool family、step input
    projection kind、step output projection kind、latency、status、business
    outcome 与 fail-close reason
- `cross_agent_context_summary`
  - context projection id、source step、target step、projection kind、content hash、
    visibility posture 与 safety summary
- `handoff_ownership_summary`
  - 本次是 manager-style bounded specialist call，还是 specialist handoff ownership
    transfer；如果是 handoff，必须记录 handoff target 与 filtered context posture
- `guardrail_summary`
  - input / tool / output guardrail outcome、human review interruption 或
    blocked reason

固定约束：

- operator surface 可以展示 agent sequence 与 projection summary，但不得展示 raw provider
  response、完整上游 prompt、raw source HTML、raw OCR dump 或 unrestricted evidence payload
- repo-owned step trajectory 是 canonical diagnostic projection；
  `workflow_trace_summary` 只是兼容的 operator-safe summary；OpenAI Agents SDK
  tracing 或其他外部 trace 只能作为 debug / grader input
- Python worker SDK-native readiness 必须使用稳定 fail-close reasons，例如
  `dependency_missing`、`provider_config_missing`、`provider_key_missing`、`model_missing`、
  `sdk_tool_missing`、`tool_not_admitted`、`plan_not_admitted`、`sdk_timeout` 与
  `sdk_guardrail_failed`；这些 reason 只能表达 degraded/fail-close，不得暗示存在
  alternate runtime path
- 对 `single_step` 不能包装成 `multi_step`；对 typed structured activity 不能伪造 agent
  collaboration trace
- 需要区分“multi-capability / agent-as-tool 规划正确但某个 step 证据不足”和
  “顶层 routing / workflow plan 错误”

## Plan-Level And Step-Level Metrics

长期 planner/executor 至少要按两层监控：

- `plan-level`
  - plan count
  - median plan latency
  - invalid plan rate
  - replan rate
  - planner abort rate
- `step-level`
  - step latency
  - step failure rate
  - rerank latency
  - merge / dedupe collapse rate
  - answer-bearing evidence retention rate

## Freshness And Live Branch Monitoring

长期 freshness-sensitive / live-assisted retrieval 需要单独观测：

- 是否命中 freshness-sensitive query class
- 是否命中 freshness gate
- local freshness 不足时是否进入 admitted live branch
- live branch unavailable 时是否正确 fail-close
- archive/historical 结果是否被错误回填到 recent answer

## Measurement Modes

长期质量治理固定分成三条线：

### Online Runtime Monitoring

用于：

- latency
- failure
- empty recall
- citation coverage
- refusal distribution
- boundary anomaly
- token / cost

要求：

- 近实时
- 低延迟聚合
- 可触发告警

### Sampled Trace Grading

用于：

- answer grounding
- citation correctness
- clarification appropriateness
- refusal appropriateness
- policy conformance
- retrieval plan appropriateness
- supporting evidence selection correctness
- freshness branch correctness
- live branch fail-close correctness

要求：

- 可从 trace / structured event / projection 触发抽样
- 输出可回流到 operator-facing quality grade projection

## Structured Runtime Summary Minimum

当 `campus_services` / `notice` 这类 structured runtime lane 后续真的
admission 到产品主路径时，`request-scoped observability fact` 至少要保留以下 compact fields：

- `selected_capability`
- `tool_name`
- `tool_business_outcome`
- `fail_close_reason`
- `historical_reference_reason`
- `notice_source_family`

这些字段的目标不是把 raw tool dump 暴露给 panel，而是让 operator 能分辨：

- 这次请求进了哪个 structured runtime family
- 返回的是 current answer、historical reference、canonical body，还是 deterministic
  fail-close / unavailable
- 显式历史参考或 fail-close 的原因是什么
- notice 结果来自 public `official_web` 还是 authenticated-source `internal_notice` source
  family

固定约束：

- 这些字段继续由 `app-api` owned request observability fact / audit projection 收口，不由
  Operator Console、`apps/execution-control` 或 sink query 直接拥有
- 它们必须保持 summary-only：不返回 raw query args、raw adapter response、raw notice/source
  bundle、raw prompt
- 如果 runtime lane 尚未 opening 或本次请求命中 fail-close，这份 summary 也必须记录 deterministic
  business outcome，而不是把 closed gate 模糊写成普通 success
- 如果 operator 需要 capability family / 产品命名标签，必须通过独立 projection 或 UI mapping
  派生，而不是改写 `selected_capability`

### Release-Gate / Regression Evals

用于：

- canonical benchmark
- replay / regression verification
- pre-release hard gate

要求：

- 不与 production aggregate 混成一套 truth
- 但应能与 production badcase queue 互相反馈

## Audit Model

长期 `Audit` 域不是 raw log viewer，而是 request-scoped curated timeline。

它至少回答：

- 这次 request 以什么 account / session / surface projection 进入系统
- 进入了哪个 target / capability / surface
- 是否发生 retrieval、fail-close、source gate 或 capability gate
- 最终为什么
  `completed`、`needs_clarification`、`no_answer`、`rejected` 或 `error`
- 有没有 operator action 或治理异常需要追踪

长期 audit 允许展示：

- `request_id`
- `trace_id`
- caller projection version / policy projection version
- selected capability / selected tool
- status / reason code
- source doc id summary
- fail-close / deny markers
- safe summary diagnostics

长期 audit 不允许展示：

- raw JWT
- raw cookie / auth header
- raw prompt / raw answer / raw transcript
- retrieval backend payload dump
- vendor-specific sink event blob

## Sink Participation

### `Sentry`

长期职责：

- exception aggregation
- performance tracing
- dependency failure
- release-aware debugging
- cross-Worker trace correlation
- AI / LLM span debugging

适合承接：

- `public-chat-web -> app-api` 与 `operator console surface -> app-api` trace
  continuity
- downstream HTTP / timeout / retry failure
- Worker shell 与 app runtime exception capture
- request-level trace deep link

不应承接：

- Operator Console primary query backend
- high-cardinality operator aggregate truth
- raw full prompt / answer / transcript archive

`app-api` 允许使用 `APP_API_OPERATOR_TRACE_LINK_TEMPLATE` 把 Sentry trace viewer 之类的
safe deep link 投影进 Operator Console backlink。该模板只用 app-owned `requestId` / `traceId`
等 correlation field 渲染 URL，不从 Sentry 查询 raw event。

### `Axiom`

长期职责：

- high-volume structured runtime events
- retrieval / citation / serving / ingestion analysis
- long-window trend、slice、cohort comparison
- badcase slicing 与 rollup input

适合承接：

- retrieval summary events
- no-answer / clarification / refusal reason summary
- citation coverage summary
- source / capability gate summary
- token / cost attribution
- official-web / ingestion / rebuild runtime events

不应承接：

- Operator Console canonical request list/detail source
- 唯一错误调试面
- raw operator PII / auth material / transcript store

如果需要从 Operator Console 跳转到 Axiom 查询页，只能通过
`APP_API_OPERATOR_ISSUE_LINK_TEMPLATE` 或 external internal producer 写入 safe deep
link；Operator Console 不直接向 Axiom 发查询请求。

### OpenAI Trace / Eval Tooling

长期职责：

- workflow-level trace debugging
- sampled trace grading
- grader / eval experimentation

它可以帮助：

- 识别单纯 HTTP 指标看不到的 workflow-level quality failure
- 给 sampled badcase 产出 structured grade

它不改变 repo truth：

- Operator Console 仍读 `app-api` owned read model
- grader output 需要经 app-owned projection / aggregate seam 才能进入 Operator Console

### OTel / Collector / Adapter Seam

长期默认方向保持：

- `OTel schema -> collector / adapter -> Sentry + Axiom + optional
  grading/export path`

redaction、sampling、字段裁剪与 sink fan-out 优先放在这条 seam，而不是把厂商逻辑复制到每个 runtime
boundary。

runtime OTel 接入口径、事件 taxonomy、attribute allowlist、forbidden fields 与 runtime
ownership matrix 固定在
`docs/reference/runtime-otel-telemetry-taxonomy.md`。该 reference 的核心约束是：OTel SDK
只进入 `apps/*` runtime / adapter / deployment 层；`retrieval-core`、`knowledge`、
`ingestion-core` 与 `contracts` 保持 vendor-neutral，不直接依赖 Sentry、Axiom、Collector
或 OpenTelemetry SDK。

Runtime bridge implementation state belongs in `../current-architecture.md`.
This document only keeps the long-term seam: runtime boundaries emit sanitized
OTel-compatible trace/metric signals, collector/adapter policy handles
redaction and sink fan-out, and app-api-owned projection remains the operator
read model.

## Cost Model

长期成本治理固定分成两层：

- near-real-time runtime estimated cost
  - request-level、operator trend、异常波动 detection
- reconciled provider cost
  - 小时 / 日级对账、预算追踪、财务口径校正

因此：

- Operator Console 可以展示 request-level estimated cost 与 rollup trend
- 最终账务或 budget closure 应以 provider cost reconciliation 为准
- 不把 repo 内静态价格表当作长期 canonical truth

## Data Minimization

所有 operator observability 域持续遵守最小化原则：

- 默认发送 identity hash、snapshot id、reason code、count
  summary、latency、status、token、cost
- 默认不发送 raw prompt、raw answer、raw transcript、raw JWT、raw auth envelope、raw
  long-term memory
- citation / retrieval 只传 doc id、count、safe summary，不传 raw snippet dump

## Forbidden Shapes

- 不把 Operator Console 做成 `Sentry` 或 `Axiom` 的嵌入式 viewer
- 不让 raw audit log 直接成为 operator query data plane
- 不让 `apps/execution-control` 承担 observability query backend
- 不把 production aggregate、sampled grades、release-gate eval truth 混成一张表
- 不把 token / cost / source / citation 口径硬编码在前端
- 不让 vendor-specific event schema 反向定义 `packages/contracts`

## 相关稳定文档

- `docs/architecture/system/product-runtime-architecture.md`
- `docs/architecture/system/identity-and-authorization-architecture.md`
- `docs/architecture/domains/official-web/architecture.md`
- `docs/contracts/app-api-http.md`
- `docs/contracts/app-api-operator-observability-http.md`
- `docs/data/app-api-schema.md`
- `docs/domains/operator-observability.md`
- `docs/decisions/adr-0010-observability-and-telemetry-stack.md`
- `docs/decisions/adr-0016-app-api-request-projection-and-operator-console-query-ownership.
  md`
- `docs/decisions/adr-0023-operator-observability-control-plane-and-sink-partici
  pation.md`

## 外部参考

- OpenAI Agent Evals
  - `<https://platform.openai.com/docs/guides/agent-evals`>
- OpenAI Trace Grading
  - `<https://platform.openai.com/docs/guides/trace-grading`>
- OpenAI Evaluation Best Practices
  - `<https://platform.openai.com/docs/guides/evaluation-best-practices`>
- OpenAI Agents SDK Tracing
  - `<https://openai.github.io/openai-agents-js/guides/tracing/`>
- OpenAI Usage / Costs API
  - `<https://platform.openai.com/docs/api-reference/usage/costs`>
- OpenTelemetry GenAI Metrics
  - `<https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-metrics/`>
- OpenTelemetry GenAI Spans
  - `<https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-spans/`>
