---
doc_type: architecture
status: active
created: 2026-04-02
updated: 2026-04-03
---

# Operator Observability Architecture

## 文档边界

本文冻结 protected panel、operator audit、quality monitoring、safety monitoring、cost monitoring 与 observability sink participation 的 supporting architecture。

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
- `apps/app-api` 是 operator-facing audit / quality / safety / cost read-model owner
- `Sentry`、`Axiom`、OpenAI trace / eval tooling 是 observability / debugging / grading sinks
- panel 只能消费 runtime-owned APIs，不直接读取 raw audit log、telemetry sink 或 `apps/supervisor-api`

因此长期主链路固定为：

`operator browser -> protected-panel-web -> app-api operator read surfaces`

与之并行的 observability chain 固定为：

`runtime boundary -> OTel-first telemetry / trace identity -> sink fan-out -> debugging / analysis / grading`

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
  - ACL decision summary、deny / fail-close posture、projection anomaly、restricted access diagnostics
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
- request identity、trace correlation、projection materialization 与 aggregate publication

它不负责：

- 让 panel 直接回放 raw execution payload
- 让 sink query 反向成为长期 operator API

### `apps/supervisor-api`

- 继续只是 execution engine
- 不承担 operator observability query backend

### Telemetry / Evaluation Sinks

- 负责 debugging、high-volume analysis、sampled grading、release evidence
- 不承担 panel canonical read model

## Read-Model Families

长期至少保留以下 operator-facing read-model family：

- `request projection`
  - request list/detail 的 canonical read model
- `request-scoped observability fact`
  - app-owned runtime fact family，用于 rollup、request observability detail、grading / reconciliation join
- `request audit projection`
  - request-scoped governance / timeline view
- `metric rollup`
  - time-window aggregate，用于 Overview / Quality / Safety / Cost
- `quality grade projection`
  - sampled trace grading、badcase review、grader output、人工复核结果

其中：

- `request projection`、`request audit projection`、`metric rollup`、`quality grade projection` 属于 operator-facing read model
- `request-scoped observability fact` 属于 app-owned runtime fact family，不等于 panel list/detail read model

这些 family 都必须由 `app-api` 或其继任 shared app boundary 拥有；panel 不得通过 raw sink、数据库直连或 runtime-internal package import 拼装它们。

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

这些指标默认至少按以下维度支持切分：

- `surface`
- `selected_target`
- `requested_capability`
- `requested_scope`
- `principal_type`
- `collection` / `source family`
- `model`

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

要求：

- 可从 trace / structured event / projection 触发抽样
- 输出可回流到 operator-facing quality grade projection

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
- 最终为什么 `completed`、`needs_clarification`、`no_answer`、`approval_required`、`rejected` 或 `error`
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

- `public-chat-web -> app-api` 与 `protected-panel-web -> app-api` trace continuity
- downstream HTTP / timeout / retry failure
- Worker shell 与 app runtime exception capture
- request-level trace deep link

不应承接：

- panel primary query backend
- high-cardinality operator aggregate truth
- raw full prompt / answer / transcript archive

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

- `OTel schema -> collector / adapter -> Sentry + Axiom + optional grading/export path`

redaction、sampling、字段裁剪与 sink fan-out 优先放在这条 seam，而不是把厂商逻辑复制到每个 runtime boundary。

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

- 默认发送 identity hash、snapshot id、reason code、count summary、latency、status、token、cost
- 默认不发送 raw prompt、raw answer、raw transcript、raw JWT、raw auth envelope、raw long-term memory
- citation / retrieval 只传 doc id、count、safe summary，不传 raw snippet dump

## Forbidden Shapes

- 不把 panel 做成 `Sentry` 或 `Axiom` 的嵌入式 viewer
- 不让 raw audit log 直接成为 operator query data plane
- 不让 `apps/supervisor-api` 承担 observability query backend
- 不把 production aggregate、sampled grades、release-gate eval truth 混成一张表
- 不把 token / cost / ACL / citation 口径硬编码在前端
- 不让 vendor-specific event schema 反向定义 `packages/contracts`

## 相关稳定文档

- `docs/architecture/product-runtime-architecture.md`
- `docs/architecture/identity-and-authorization-architecture.md`
- `docs/architecture/official-web-architecture.md`
- `docs/contracts/app-api-http.md`
- `docs/contracts/app-api-operator-observability-http.md`
- `docs/data/app-api-schema.md`
- `docs/decisions/adr-0010-observability-and-telemetry-stack.md`
- `docs/decisions/adr-0016-app-api-request-projection-and-panel-query-ownership.md`
- `docs/decisions/adr-0023-operator-observability-control-plane-and-sink-participation.md`
- `docs/decisions/adr-0022-campus-identity-and-restricted-document-authorization.md`
- `docs/plans/operator-observability-control-plane-foundation.md`

## 外部参考

- OpenAI Agent Evals
  - `https://platform.openai.com/docs/guides/agent-evals`
- OpenAI Trace Grading
  - `https://platform.openai.com/docs/guides/trace-grading`
- OpenAI Evaluation Best Practices
  - `https://platform.openai.com/docs/guides/evaluation-best-practices`
- OpenAI Agents SDK Tracing
  - `https://openai.github.io/openai-agents-js/guides/tracing/`
- OpenAI Usage / Costs API
  - `https://platform.openai.com/docs/api-reference/usage/costs`
- OpenTelemetry GenAI Metrics
  - `https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-metrics/`
- OpenTelemetry GenAI Spans
  - `https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-spans/`
