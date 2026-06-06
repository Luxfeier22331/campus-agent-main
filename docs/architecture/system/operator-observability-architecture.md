---
doc_type: architecture
status: active
created: 2026-04-02
updated: 2026-05-07
---
# Operator Observability Architecture

## 文档边界

本文冻结 protected panel、operator audit、quality monitoring、safety monitoring、cost
monitoring 与 observability sink participation 的 supporting architecture。

它回答的是：

- operator-facing observability / audit / quality surface 应该长成什么形态
- `protected-panel-web`、`app-api`、telemetry sinks 各自负责什么
- 哪些指标属于长期必须持续监控的最小集合
- `Sentry`、`Axiom` 与 sampled grading / evals 如何参与，而不反向成为 panel truth

它不负责：

- 当前哪些 operator API 已经落地
- 某个 dashboard 的最终布局
- alert threshold、retention、sampling ratio 的具体数值
- 某个 sink SDK 的逐字段接入细节

## Core Conclusion

长期 operator observability 形态固定为：

- `protected-panel-web` 是 operator control-plane surface
- `apps/app-api` 是 operator-facing audit / quality / safety / cost read-model
  owner
- `Sentry`、`Axiom`、OpenAI trace / eval tooling 是 observability / debugging /
  grading sinks
- panel 只能消费 runtime-owned APIs，不直接读取 raw audit log、telemetry sink 或
  `apps/execution-gateway`

因此长期主链路固定为：

`operator browser -> protected-panel-web -> app-api operator read surfaces`

与之并行的 observability chain 固定为：

`runtime boundary -> OTel-first telemetry / trace identity -> sink fan-out ->
debugging / analysis / grading`

二者相关，但不是同一条数据面。

## Operator Domain Model

长期 operator-facing observability 域固定拆成：

- `Overview`
  - 全局 SLO、告警摘要、最近异常、sink health
- `Requests`
  - request list/detail、最小执行摘要、trace correlation、projection-friendly diagnostics
- `Quality`
  - retrieval quality、citation coverage、refusal distribution、badcase sampling
- `Safety/Authz`
  - ACL decision summary、deny / fail-close posture、projection anomaly、restricted
    access diagnostics
- `Cost`
  - token usage、estimated cost、model / target / surface 分布
- `Audit`
  - request-scoped timeline、operator action timeline、governance explanation
- `Official Web`
  - `official_web` control plane；它仍是独立 operator domain，不退化成通用 infra console

这些域都属于 operator-facing read model，不等于 raw sink explorer。

## Ownership Model

### `apps/protected-panel-web`

- protected operator UI shell
- 只消费 runtime APIs
- 只承担 BFF / route shell / operator UX，不承担 operator truth synthesis

### `apps/app-api`

长期负责：

- operator request projection
- operator audit projection
- operator quality / safety / cost aggregate read surfaces
- operator-facing authz interpretation
- request identity、trace correlation、projection materialization 与 aggregate
  publication

它不负责：

- 让 panel 直接回放 raw execution payload
- 让 sink query 反向成为长期 operator API

### `apps/execution-gateway`

- 继续只是 execution engine
- 不承担 operator observability query backend
- Docker-side Go `apps/execution-gateway` runtime 可以产生 execution audit events，但只能通过
  `app-api` internal ingest 写入 app-owned outbox / projection，不直接服务 panel

### Telemetry / Evaluation Sinks

- 负责 debugging、high-volume analysis、sampled grading、release evidence
- 不承担 panel canonical read model

## Execution Audit Backflow

Go `apps/execution-gateway` runtime 负责 admission、queue/backpressure、timeout、
cancel 与 bridge failure 等 runtime kernel 事实。它产生的 execution audit
events 只能按以下路径进入 panel：

`execution-gateway execution event` -> `app-api internal ingest` ->
`runtime.projection_outbox` -> `operator.request_audit_projection` ->
`protected-panel-web`

第一版允许进入 audit timeline 的 execution event type 固定为：

- `execution.admission_rejected`
- `execution.cancel_requested`
- `execution.cancelled`
- `execution.bridge_failed`
- `execution.timed_out`

规则：

- `app-api` 继续是 audit projection owner；`execution-gateway` 不写 Postgres、不提供
  operator query backend
- `app-api` execution audit ingest 成功后必须调度 request-scoped projector drain；
  scheduled drain 只承担周期性一致性检查，不承担 answer path 的补救语义
- ingest payload 只允许 `request_id`、`trace_id`、lane、decision、failure kind、
  duration、queue wait、bridge duration、HTTP status、retryable 等 safe fields
- payload 禁止 raw prompt、raw answer、raw transcript、auth material、retrieval
  payload、provider raw response
- `Sentry` 与 `Axiom` 可以接收同类 sanitized event 用于 trace / analysis / alert，
  但 panel 不得直接查询这些 sink
- `app-api` 可以按 optional deep-link template 把 request trace / issue backlink 写入
  `operator.trace_backlink_projection`；这是 app-owned projection write，不是 panel
  route-time sink query
- Go `execution-gateway` 的 execution audit writer 开启后必须同步发送每个 safe audit
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
- `request-scoped observability fact` 属于 app-owned runtime fact family，不等于 panel
  list/detail read model

这些 family 都必须由 `app-api` 或其继任 shared app boundary 拥有；panel 不得通过 raw sink、数据库直连或
runtime-internal package import 拼装它们。

## Current Accepted Baseline

当前 merged truth 已经接受以下 observability baseline：

- panel `Requests` 继续只读 `app-api` projection / observability APIs
- `Sentry` 与 `Axiom` 只作为 sink、deep link 与分析面参与，不成为 panel canonical truth
- request-scoped observability fact 已经是 app-owned runtime fact family，而不是 sink
  query 的别名
- prompt identity 与 typed runtime branch 现已进入 observability-safe summary seam，但
  raw prompt 仍禁止出现在 panel/read-model
- overview health 已经从 `runtime.projection_outbox` 派生 projection failure、
  pending、retry 与 stale outbox summary，不再把 projection failure 暂置为固定值
- intent governance 已经进入 operator-facing read model：request detail 保留 typed intent
  summary，`app-api` 另提供 intent summary / timeseries 聚合，用于 classifier、schema 与
  context-resolution drift 监控
- answer quality feedback 已进入 `Quality` read model：`chat.message_feedback` 通过
  `request_id` join `runtime.request_observability_fact`，生成 feedback coverage、
  helpful / unhelpful rate、no-answer unhelpful overlap，以及 `negative_feedback`
  eval candidate intake；它不是 panel-owned truth，也不反向改变 runtime routing
- admitted `multi_step` 的 workflow trace summary 现已保留 bounded final answer artifact
  usage 摘要：
  `answer_artifact_projection_ids` 与 `answer_artifact_kinds` 进入 operator / eval
  可见的 safe summary seam，用于证明最终答复依赖了哪些 repo-owned projection，而不是暴露
  raw artifact payload

当前尚未全部落成 merged truth 的，是更完整的 `Safety/Authz`、`Cost`、`Audit` operator
product surface；这属于 rollout 进度问题，不是 ownership 未定。

长期如果推进 full agentic retrieval，operator observability 还必须继续收口 planner / executor
/ query activity truth；这属于 target-state observability expansion，不应被误读成当前 merged
truth 已开放。

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
- refusal rate
  - 必须拆分 `no_answer`、`needs_clarification`、`approval_required`、`rejected`
- ACL anomaly rate
  - projection 缺失、冲突、fail-open suspicion、unauthorized evidence risk
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
- `selected_target`
- `requested_capability`
- `requested_scope`
- `principal_type`
- `collection` / `source family`
- `model`

## Raw Target And Derived Label Rule

`selected_target` 的长期职责固定为 raw runtime target dimension。

它继续用于：

- storage / filter truth
- telemetry sink correlation
- deterministic runtime assertions
- operator debug / drill-down 时的原始执行目标定位

它不直接承担：

- operator-facing capability family wording
- panel 默认展示标签
- report / summary 的 family grouping

如果 operator surface 需要展示或分组，必须通过显式 projection 派生，例如：

- `selected_target`
  - raw runtime target，例如 `rag-agent`
- `capability_family`
  - family wording，例如 `rag-agent`
- `selected_target_label`
  - operator-facing display label，例如 `检索专家`

固定约束：

- raw `selected_target` 不能被 schema rename、display copy 或 report summary 静默重载
- panel 默认展示 derived label / display label；只有 debug/filter surface 才直接暴露 raw
  target
- 如果未来 admission 新 runtime family，也必须先补 mapping / projection，再开放 operator-facing
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

长期 multi-agent workflow 至少还要补以下 operator-facing summary truth：

- `workflow_plan_summary`
  - workflow mode、planner version、selected step sequence、allowed agents /
    allowed tools、budget posture 与 terminal policy
- `agent_step_summary`
  - 每个 step 的 agent family、step input projection kind、step output projection kind、
    latency、status、business outcome 与 fail-close reason
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
- repo-owned `workflow_trace_summary` 仍是 canonical projection；OpenAI Agents SDK
  tracing 或其他外部 trace 只能作为 debug / grader input
- Python worker SDK-native readiness 必须使用稳定 fail-close reasons，例如
  `dependency_missing`、`provider_config_missing`、`provider_key_missing`、`model_missing`、
  `sdk_tool_missing`、`tool_not_admitted`、`plan_not_admitted`、`sdk_timeout` 与
  `sdk_guardrail_failed`；这些 reason 只能表达 degraded/fail-close，不得暗示存在
  alternate runtime path
- 对 `single_handoff` 不能包装成 `multi_step`；对 direct structured runtime 不能伪造 agent
  collaboration trace
- 需要区分“multi-agent 规划正确但某个 step 证据不足”和“顶层 routing / workflow plan 错误”

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
- ACL anomaly
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

当 `campus-services-agent` / `notice-agent` 这类 structured runtime lane 后续真的
admission 到产品主路径时，`request-scoped observability fact` 至少要保留以下 compact fields：

- `selected_target`
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
- notice 结果来自 public `official_web` 还是 restricted `internal_notice` source
  family

固定约束：

- 这些字段继续由 `app-api` owned request observability fact / audit projection 收口，不由
  `protected-panel-web`、`apps/execution-gateway` 或 sink query 直接拥有
- 它们必须保持 summary-only：不返回 raw query args、raw adapter response、raw notice/source
  bundle、raw prompt
- 如果 runtime lane 尚未 opening 或本次请求命中 fail-close，这份 summary 也必须记录 deterministic
  business outcome，而不是把 closed gate 模糊写成普通 success
- 如果 operator 需要 capability family / 产品命名标签，必须通过独立 projection 或 UI mapping
  派生，而不是改写 `selected_target`

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

- 这次 request 以什么 principal / entitlement snapshot 进入系统
- 进入了哪个 target / capability / surface
- 是否发生 retrieval、fail-close、approval gate、restricted deny
- 最终为什么
  `completed`、`needs_clarification`、`no_answer`、`approval_required`、`rejected` 或
  `error`
- 有没有 operator action 或治理异常需要追踪

长期 audit 允许展示：

- `request_id`
- `trace_id`
- principal class / entitlement snapshot id / policy projection version
- selected target
- status / reason code
- source doc id summary
- fail-close / deny / approval markers
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

- `public-chat-web -> app-api` 与 `protected-panel-web -> app-api` trace
  continuity
- downstream HTTP / timeout / retry failure
- Worker shell 与 app runtime exception capture
- request-level trace deep link

不应承接：

- panel primary query backend
- high-cardinality operator aggregate truth
- raw full prompt / answer / transcript archive

`app-api` 允许使用 `APP_API_OPERATOR_TRACE_LINK_TEMPLATE` 把 Sentry trace viewer 之类的
safe deep link 投影进 panel backlink。该模板只用 app-owned `requestId` / `traceId`
等 correlation field 渲染 URL，不从 Sentry 查询 raw event。

### `Axiom`

长期职责：

- high-volume structured runtime events
- retrieval / citation / ACL / serving / ingestion analysis
- long-window trend、slice、cohort comparison
- badcase slicing 与 rollup input

适合承接：

- retrieval summary events
- no-answer / clarification / refusal reason summary
- citation coverage summary
- ACL decision summary
- token / cost attribution
- official-web / ingestion / rebuild runtime events

不应承接：

- panel canonical request list/detail source
- 唯一错误调试面
- raw operator PII / auth material / transcript store

如果需要从 panel 跳转到 Axiom 查询页，只能通过
`APP_API_OPERATOR_ISSUE_LINK_TEMPLATE` 或 external internal producer 写入 safe deep
link；panel 不直接向 Axiom 发查询请求。

### OpenAI Trace / Eval Tooling

长期职责：

- workflow-level trace debugging
- sampled trace grading
- grader / eval experimentation

它可以帮助：

- 识别单纯 HTTP 指标看不到的 workflow-level quality failure
- 给 sampled badcase 产出 structured grade

它不改变 repo truth：

- panel 仍读 `app-api` owned read model
- grader output 需要经 app-owned projection / aggregate seam 才能进入 panel

### OTel / Collector / Adapter Seam

长期默认方向保持：

- `OTel schema -> collector / adapter -> Sentry + Axiom + optional
  grading/export path`

redaction、sampling、字段裁剪与 sink fan-out 优先放在这条 seam，而不是把厂商逻辑复制到每个 runtime
boundary。

runtime OTel 接入口径、事件 taxonomy、attribute allowlist、forbidden fields 与 runtime
ownership matrix 固定在
`docs/reference/runtime-otel-telemetry-taxonomy.md`。该 reference 的核心约束是：OTel SDK
只进入 `apps/*` runtime / adapter / deployment 层；`retrieval-core`、`rag-agent`、
`ingestion-core` 与 `contracts` 保持 vendor-neutral，不直接依赖 Sentry、Axiom、Collector
或 OpenTelemetry SDK。

当前 runtime bridge 已收口为：

- `apps/execution-gateway` 是 online trace owner，负责 request admission、bridge
  attempt 与 finalization 的 sanitized OTLP trace signal
- `apps/execution-gateway` 在启用 OTel 后对 configured product answer paths 采用
  fail-close 语义；telemetry 交付失败返回 `telemetry_delivery_failed`，sampling 丢弃仍只作为
  显式采样计数
- `apps/supervisor-agent-worker` 负责把 `retrieval.runtime_observation` 映射成 sanitized
  runtime event sink
- `apps/ingestion-worker` 负责 offline run-level started/completed/failed telemetry
- `infra/otel/` 提供 repo-owned local debug Collector config 与 staging Sentry/Axiom
  fan-out template
- `docs/runbooks/runtime-otel-collector-pipeline.md` 提供 local debug、staging env、
  closeout smoke 与 drop diagnosis 操作口径

## Cost Model

长期成本治理固定分成两层：

- near-real-time runtime estimated cost
  - request-level、operator trend、异常波动 detection
- reconciled provider cost
  - 小时 / 日级对账、预算追踪、财务口径校正

因此：

- panel 可以展示 request-level estimated cost 与 rollup trend
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

- 不把 panel 做成 `Sentry` 或 `Axiom` 的嵌入式 viewer
- 不让 raw audit log 直接成为 operator query data plane
- 不让 `apps/execution-gateway` 承担 observability query backend
- 不把 production aggregate、sampled grades、release-gate eval truth 混成一张表
- 不把 token / cost / ACL / citation 口径硬编码在前端
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
- `docs/decisions/adr-0016-app-api-request-projection-and-panel-query-ownership.
  md`
- `docs/decisions/adr-0023-operator-observability-control-plane-and-sink-partici
  pation.md`
- `docs/decisions/adr-0022-campus-identity-and-restricted-document-authorization
  .md`

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
