---
doc_type: product_requirement
truth_scope: product
owner_boundary: docs/product
status: active
created: 2026-06-19
updated: 2026-06-28
---

<!-- markdownlint-disable MD013 -->

# Operator Diagnosis PRD

## 1. 背景

校园问答在线系统同时使用 app-api projection、Temporal、Sentry、Axiom、Langfuse 和
OTel Collector。产品需要一套统一的 operator diagnosis model，让 operator 从
request-centered projection 出发定位运行问题，而不是在多个 sink 中猜测哪一个才是产品真相。

本 PRD 定义 operator-facing diagnosis 的产品要求。架构 owner、telemetry taxonomy、HTTP
contract 和 runbook 由对应文档冻结，本 PRD 只拥有用户体验、边界和验收标准。

## 2. 问题

1. 外部 sink 容易被误当作产品请求真相。
1. Axiom / Sentry / Langfuse / Temporal 的职责边界需要在 operator 体验中可见。
1. 一次请求需要稳定关联 request id、trace id、workflow id、run id 和 sink backlink。
1. Operator Console 必须能在不直连 sink 的情况下展示可诊断摘要。

## 3. 目标

- Operator Console 以 app-api sanitized projection 作为唯一请求真相。
- Sentry、Axiom、Temporal、Langfuse 只作为 drill-down destination 或 substrate truth。
- `trace_id`、`request_id`、`workflow_id`、`run_id`、`langfuse trace id` 构成稳定
  correlation spine。
- Sink-bound payload 和 backlink payload 遵守 forbidden-field policy。
- 外部 sink 不可用时不改变 request truth。

## 4. 非目标

- 不把 Sentry、Axiom、Langfuse 或 Temporal 变成 Operator Console 的直接数据源。
- 不把 Langfuse 变成 repo eval truth。
- 不把 Temporal raw history 暴露到浏览器或 Operator Console。
- 不新增终端用户可见的观测页面。
- 不把 OTel、Sentry、Axiom、Langfuse SDK 类型泄漏进 `packages/contracts`。
- 不展示 raw prompt、raw answer、transcript、retrieved snippet、provider raw response、
  auth header、cookie、JWT、API key、database URL 或 provider secret。

## 5. 产品模型

Operator diagnosis 从 repo-owned projection 开始：

```text
Operator Console
  -> app-api Ops Index
  -> request projection + minimal runtime health / correlation fields
  -> safe links:
       Sentry trace / issue
       Axiom query
       Temporal workflow identity
       Langfuse trace / eval backlink
```

Sink 是 drill-down destination，不是 request state 的第一查询路径，也不是 app-api
需要复制的 dashboard 数据源。

## 6. 功能要求

### 6.1 Role Ownership

- Operator request list/detail 读取 app-api / Postgres sanitized Ops Index。
- Sentry 负责 error issue、trace / performance drill-down 和 release regression。
- Axiom 负责 runtime log/event query、dashboard 和 alert。
- Temporal 负责 workflow history、activity attempt、retry、timeout、cancel 和 visibility。
- Langfuse 负责 LLM trace、GenAI observation、eval score 和 review artifact。
- OTel Collector 负责 redaction、sampling、batch、retry 和 sink fan-out，不是 truth source。

### 6.2 Controlled Telemetry Ingest

- Worker-origin telemetry 必须通过受控 OTLP ingest endpoint 进入 Collector。
- Browser client 不得直接写 telemetry ingest endpoint。
- Ingest endpoint 必须有认证、method/path allowlist、payload size limit、rate limit 和
  health diagnostics。
- Missing or invalid ingest credential 必须产生可诊断错误。

### 6.3 Axiom Boundary

- Runtime data 长期通过 Collector exporter 写入 Axiom。
- app-api 不应重新引入 direct Axiom REST adapter 或 Worker-local Axiom secret。
- Operator Console 不依赖 Axiom 可用性渲染 request state。

### 6.4 Sentry Boundary

- Worker surfaces 可用 Sentry SDK 处理 uncaught exception、request scope、release 和
  environment tagging。
- Sentry `sendDefaultPii` 必须保持关闭。
- Sentry backlink 必须来自 projection，不是 browser direct sink query。

### 6.5 Temporal Boundary

- Temporal raw workflow history 不进浏览器。
- Operator Console 只展示 projected workflow / run / step summary。
- 缺 Temporal projection 必须显示为 diagnostic gap，不能伪装成成功空状态。

### 6.6 Langfuse Boundary

- Runtime code 通过 Collector fan-out 写 sanitized Langfuse attributes。
- Eval tooling 可向 Langfuse 发布 sanitized score / backlink。
- Langfuse exporter outage 不阻断用户回答，但可以阻断 release / eval closeout。

### 6.7 Request-centered Triage

Operator Console request detail 至少展示：

- request status
- selected tool / capability
- terminal outcome / fail-close reason
- duration and token / cost summary
- source / citation / retrieval summary
- workflow trace summary
- safe external backlinks when available

Backlink 缺失展示为 “not linked yet” 或等价状态，不改变 request truth。

## 7. 数据边界

允许展示或投影：

- request id、trace id、conversation id、workflow id、run id、step id
- hashed actor identifier
- surface、status、selected tool
- duration、source count、cost/token summary
- low-cardinality failure kind / fail-close reason

禁止展示或写入 sink/backlink：

- raw prompt、raw answer、transcript
- retrieved snippet、source body、provider raw response
- memory text
- authorization、cookie、JWT、API key
- database URL、object-store secret、provider secret
- operator email

## 8. 验收标准

- Operator 可从 request detail 判断请求状态、运行路径、失败原因和可用 backlink。
- Request detail 不要求 Sentry、Axiom、Temporal 或 Langfuse 可用。
- Safe backlink 能把同一请求关联到 Sentry、Axiom、Temporal 和 Langfuse 中已有的数据。
- Sink 或 backlink payload 的 forbidden-field 检查有测试覆盖。
- app-api direct Axiom writes 不应重新出现。
- Browser 或 terminal user page 不暴露 observability ingest 或 raw sink explorer。
- 新代码不把 vendor telemetry SDK 类型导入 `packages/contracts`。

## 9. 相关文档

- [Ops Observability Architecture](../architecture/system/ops-observability.md)
- [Runtime OTel Telemetry Taxonomy](../reference/runtime-otel-telemetry-taxonomy.md)
- [App API Observability Contract](../contracts/app-api/observability.md)
- [Langfuse Runtime Contract](../contracts/langfuse-runtime.md)
