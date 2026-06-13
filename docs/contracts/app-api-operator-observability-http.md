---
doc_type: contract
truth_scope: ops
owner_boundary: apps/app-api
status: active
created: 2026-04-03
updated: 2026-06-13
---

# App API Operator Observability HTTP Contract

<!-- markdownlint-disable MD013 -->

## Document Boundary

This file is the stable index for operator observability HTTP contracts.
It owns cross-cutting rules and endpoint grouping only. Detailed request,
response and ingest endpoint bodies live in the split documents below.

## Split Documents

- `app-api-operator-observability-http/eval-and-overview.md`
  - Eval and overview: coverage snapshot and overview endpoints
- `app-api-operator-observability-http/requests-and-quality.md`
  - Requests and quality index
- `app-api-operator-observability-http/request-detail.md`
  - Request detail observability endpoint
- `app-api-operator-observability-http/quality.md`
  - Quality summary, timeseries, badcase and eval-candidate endpoints
- `app-api-operator-observability-http/governance-safety-cost-audit.md`
  - Governance, safety, cost and audit: intent/authz/cost/audit endpoints
- `app-api-operator-observability-http/internal-ingest.md`
  - Internal ingest: operator diagnostic ingest endpoints

## Index-Owned Baseline

## 文档边界

这份文档冻结 `apps/app-api` 暴露给 `protected-panel-web` 的 operator observability query
contract。

它补充但不替代以下文档：

- browser-facing app contract：`docs/contracts/app-api-http.md`
- request lifecycle 与 request
  projection：`docs/contracts/app-api-request-lifecycle.md`
- eval benchmark ingress 与 publish
  correlation：`docs/contracts/app-api-eval-benchmark-http.md`
- product/control-plane
  ownership：`docs/architecture/system/product-runtime-architecture.md`
- operator observability supporting
  architecture：`docs/architecture/system/operator-observability-architecture.md`
- 领域导航：`docs/domains/operator-observability.md`
- ownership / sink participation 决策：`docs/decisions/adr-0023-operator-observabil
  ity-control-plane-and-sink-participation.md`
- 当前 merged-truth schema：`docs/data/app-api-schema.md`
- shared eval artifact
  contract：`docs/reference/eval-benchmark-artifact-contract.md`

这份文档不冻结：

- panel UI layout、卡片排列或交互细节
- telemetry sink vendor SDK 的逐字段接入方式
- 告警阈值、sampling ratio、retention 天数
- operator 写操作、acknowledge / resolve / override API
- raw log、raw trace、raw audit JSONL、raw grader payload 的直接查询能力

## 适用范围

长期 operator observability query path 固定为：

`operator browser -> protected-panel-web same-site /api/* -> app-api`

这里冻结的都是只读 query endpoints。

它们共享以下前提：

- operator principal admission 继续复用 shared `app-api` operator access model
- panel 继续只消费 runtime-owned projections / rollups
- `Sentry`、`Axiom`、sampled grading / eval tooling 继续只是 sink 或输入来源，不直接充当 query
  backend
- grader / sink 如果要让 panel 消费结果，必须先通过 `app-api` owned internal ingest seam 写入
  projection

## Contract 与实现范围说明

这份文档冻结的是 forward contract，不表示 `develop` 已经完整实现文中所有 endpoint。

判断当前已实现子集时：

- 当前已落地能力以 `docs/architecture/current-architecture.md` 和代码为准
- 当前 accepted direction 与长期边界以本文、supporting architecture 与相关 ADR 为准

## Cross-Cutting Rules

- JSON body 使用 `camelCase`
- 时间戳使用 ISO 8601 UTC 字符串
- enum / code value 使用小写语义值，例如
  `completed`、`citation_missing`、`projection_lag_spike`
- 所有错误响应继续使用 `docs/contracts/app-api-error-model.md` 中定义的统一 envelope
- `requestId` 是业务级 correlation id；`traceId` 是 runtime trace correlation id
- panel-facing sink backlink 只允许返回安全的 deep link / fingerprint，不返回 raw sink event
  blob
- token / model / retrieval / citation / ACL facts 必须来自 execution-side typed
  telemetry seam 或 app-owned runtime fact family，不得由 panel query path 反推
- 所有 summary / timeseries / queue 都必须由 `app-api` owned projection、rollup 或 grade
  projection 提供；panel 不得直接查询 sink

### Common Query Parameters

所有聚合与队列类 endpoints 默认支持以下公共参数：

- `window`
  - 允许值：`15m`、`1h`、`24h`、`7d`、`30d`
  - 默认：`24h`
- `surface`
- `selectedCapability`
- `requestedCapability`
- `principalType`
- `collection`
- `modelName`

timeseries endpoints 额外支持：

- `granularity`
  - 允许值：`5m`、`15m`、`1h`、`1d`

list endpoints 额外支持：

- `limit`
- `cursor`

规则：

- 非空但不在允许集合内的 `window` 或 `granularity` 返回 `400 validation_failed`
- `window` 与 `granularity` 的非法组合返回 `400 validation_failed`
- 未传 filter 时表示查询当前 operator 可见范围内的全量 app-owned aggregate
- 过滤只作用于 app-owned projection / rollup 维度，不隐式回源 raw sink
- `selectedCapability` 继续只表示 raw capability filter，不表示 forward family
  label，也不直接承担 localized display wording
- 如果 operator surface 需要 capability family 或 display wording，必须通过独立 projection
  field / mapping 提供；不得把 `knowledge`、`navigation` 之类派生标签直接写回
  `selectedCapability`

## Endpoint Summary

### Overview

- `GET /api/operator/overview`

### Requests

- `GET /api/operator/requests`
  - summary / detail shape 继续由 `docs/contracts/app-api-http.md` 冻结
- `GET /api/operator/requests/:requestId`
  - summary / detail shape 继续由 `docs/contracts/app-api-http.md` 冻结
- `GET /api/operator/requests/:requestId/observability`

### Quality

- `GET /api/operator/quality/summary`
- `GET /api/operator/quality/timeseries`
- `GET /api/operator/quality/badcases`
- `GET /api/operator/quality/eval-candidates`

### Intent Governance

- `GET /api/operator/intent/summary`
- `GET /api/operator/intent/timeseries`

### Safety/Authz

- `GET /api/operator/safety/summary`
- `GET /api/operator/safety/anomalies`

### Cost

- `GET /api/operator/cost/summary`
- `GET /api/operator/cost/timeseries`

### Eval Coverage

- `GET /api/operator/evals/coverage`
- `POST /api/internal/operator/evals/coverage-snapshots`
- `POST /api/internal/operator/evals/diagnostic-badcases`

### Audit

- `GET /api/operator/audit`
- `GET /api/operator/audit/:auditEventId`

第一版不冻结：

- operator acknowledge / resolve / retry / export API
- ad-hoc SQL / log / trace explorer
- sink query passthrough API
- custom dashboard composition API

## Response Shapes

### Window

```json
{
  "from": "2026-04-03T00:00:00.000Z",
  "to": "2026-04-03T23:59:59.999Z",
  "granularity": "15m"
}
```

### Trace Backlinks

```json
{
  "traceLink": "https://sentry.example/organizations/campus/traces/trace_01HQ",
  "issueLink": "https://sentry.example/organizations/campus/issues/123",
  "issueFingerprint": "timeout:execution-control"
}
```

规则：

- `traceLink`、`issueLink`、`issueFingerprint` 都是 panel-friendly backlink
- 没有关联对象时允许返回 `null`
- 不返回 sink 原始 payload 或 query 语句
- 当前 forward contract 接受这些字段最终由 `operator.trace_backlink_projection` 提供
- `app-api` 可以在 request lifecycle 中按
  `APP_API_OPERATOR_TRACE_LINK_TEMPLATE` / `APP_API_OPERATOR_ISSUE_LINK_TEMPLATE`
  自动写入 trace / issue backlink；模板只渲染 deep link，不查询 sink，不改变
  panel truth owner

### Metric Ratio

```json
{
  "value": 0.041,
  "count": 12,
  "eligibleCount": 290
}
```

规则：

- `count` 是命中数
- `eligibleCount` 是该指标合法分母；不适用时允许为 `null`

## Explicit Non-Goals

- 不把 `Sentry`、`Axiom`、OpenAI trace / eval tooling 提升成 panel canonical query
  backend
- 不让 `apps/execution-control` 暴露 operator observability HTTP surface
- 不让 panel BFF 查询数据库、audit JSONL 或 sink 后再自己拼 aggregate
- 不把 request observability detail 退化成 raw execution / trace dump
