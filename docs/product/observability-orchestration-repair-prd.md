---
doc_type: product_requirement
truth_scope: product
owner_boundary: docs/product
status: active
created: 2026-06-19
updated: 2026-06-22
---

<!-- markdownlint-disable MD013 -->

# Observability Orchestration Repair PRD

## 1. Background

当前在线系统已经接入多种观测能力，但编排口径仍不够统一：

- `execution-control` / Temporal workers 基本采用
  `OTel SDK -> Collector -> Sentry / Axiom / Langfuse`。
- `app-api` 使用 Sentry Cloudflare SDK 处理 Worker runtime exception / request
  scope，并通过受控 OTLP ingest endpoint 把 runtime lifecycle telemetry 交给
  Collector。
- Operator Console 主要读取 app-api / Postgres sanitized projection，但仍需要通过
  `trace_id`、`request_id`、`workflow_id` 与外部 sink 建立可诊断回链。
- Temporal 记录 workflow history / retry / timeout / cancel / visibility；它不是通用
  telemetry sink。
- Langfuse 是 LLM / GenAI trace 与 eval sink；它不是 request truth 或 repo eval truth。

因此当前问题不是“缺少观测工具”，而是观测编排需要从多入口、多语义、多消费者收口为一条清晰的
operator diagnosis model。

## 2. Problem Statement

当前实现存在三个产品级偏差：

1. **观测 sink 与产品真相边界容易混淆**
   Sentry、Axiom、Langfuse 与 Temporal 都有查询/观测能力，但 Operator Console
   的请求真相必须来自 repo-owned Postgres projection，而不是直接查询这些外部系统。

1. **Axiom 入口需要防回归**
   Axiom runtime 写入已收口到 Collector exporter；`app-api` 侧不应重新引入 direct REST
   ingest、独立 dataset 或 Worker-local Axiom secret。

1. **跨系统回链还没有形成统一验收口径**
   一次请求应能从 Operator Console detail 出发，稳定关联到 Sentry trace / issue、
   Axiom event query、Temporal workflow 与 Langfuse trace / eval backlink。当前已有部分
   projection 和 backlink 表，但缺少统一产品验收标准。

## 3. Goals

- 明确每个观测系统在产品中的职责，形成单一 operator diagnosis model。
- 保持 Operator Console 只消费 app-api operator APIs 和 sanitized projection。
- 收口 Axiom 入口，消除长期 Worker-local direct ingest 与 Collector ingest 双轨。
- 保留 Sentry Cloudflare SDK 对 Worker runtime exception / request scope 的合理价值。
- 让 `trace_id`、`request_id`、`workflow_id`、`run_id`、`langfuse trace id`
  成为跨系统诊断的稳定 correlation spine。
- 让所有 sink-bound payload 继续遵守 forbidden fields 与 low-cardinality taxonomy。

## 4. Non-goals

- 不把 Sentry、Axiom、Langfuse 或 Temporal 变成 Operator Console 的直接数据源。
- 不把 Langfuse 变成 repo eval truth。
- 不把 Temporal raw history 暴露到浏览器或 Operator Console。
- 不新增终端用户可见的观测页面；Operator Console 只补最小诊断信息和安全回链。
- 不要求 Cloudflare Worker 在没有受控 OTLP ingest endpoint 时强行直连内网 Collector。
- 不把 OTel、Sentry、Axiom、Langfuse SDK 类型泄漏进 `packages/contracts`。
- 不存储 raw prompt、raw answer、transcript、retrieved snippet、provider raw response、
  auth header、cookie、JWT、API key、database URL 或 provider secret。

## 5. Target Product Model

### 5.1 Source Of Truth

| Surface | Product role | Truth source |
| --- | --- | --- |
| Operator Console request list/detail | 运维请求真相、运行状态、诊断摘要 | app-api / Postgres projection |
| Sentry | error issue、trace/performance drill-down、release regression | Sentry project |
| Axiom | tool read model event / log query、dashboard、alert | Axiom dataset |
| Temporal | workflow history、activity attempt、retry、timeout、cancel、visibility | Temporal persistence / visibility |
| Langfuse | LLM trace、GenAI observation、eval score/review artifact | Langfuse project |
| OTel Collector | redaction、sampling、batch、retry、sink fan-out | deployment pipeline, not truth source |

### 5.2 Diagnosis Flow

Operator-facing diagnosis starts from repo-owned projection:

```text
Operator Console
  -> app-api operator request detail / observability detail
  -> request projection + request observability fact + run/step projection
  -> safe backlinks:
       Sentry trace / issue
       Axiom query
       Temporal workflow identity
       Langfuse trace / eval backlink
```

External sinks are drill-down destinations. They must not become the first query path for
request state.

## 6. Functional Requirements

### 6.1 Observability Role Ownership

The product must update existing owner documents instead of creating another
standalone source of truth.

Required owner documents:

- `docs/reference/runtime-otel-telemetry-taxonomy.md` owns runtime ownership
  matrix, signal taxonomy, allowed attributes and forbidden fields.
- `docs/architecture/system/ops-observability.md` owns
  Operator Console / sink participation boundaries.
- This PRD owns only product requirements and acceptance criteria.

The owner documents must consistently cover:

- owns
- does not own
- allowed consumers
- required correlation identifiers
- forbidden data classes

Acceptance:

- New implementation work can be reviewed against those owner documents instead
  of scattered sink-specific assumptions.
- The owner documents state that Sentry/Axiom/Langfuse are sinks and Operator
  Console does not query them directly.

### 6.2 Controlled OTLP Ingest For Worker Surfaces

Worker-origin telemetry target is:

```text
Cloudflare Worker surfaces
  -> controlled OTLP ingest endpoint
  -> Collector
  -> Sentry / Axiom / Langfuse
```

Required behavior:

- The controlled OTLP ingest endpoint accepts only trusted Worker-origin OTLP
  HTTP traffic.
- Browser clients must not write directly to the OTLP ingest endpoint.
- The endpoint must require authentication; anonymous public ingest is not
  allowed.
- The endpoint must enforce method/path allowlist, payload size limits, rate
  limits and health diagnostics.
- The endpoint must preserve trace correlation headers and resource attributes.
- The endpoint must reuse the repo forbidden-field policy before data reaches
  vendor exporters.
- The endpoint must be deployable without requiring Cloudflare Workers to reach
  an internal Docker network.

Acceptance:

- Worker-origin request lifecycle telemetry reaches the Collector through the
  controlled OTLP ingest path.
- Missing or invalid Worker ingest credentials fail closed for telemetry delivery
  and produce a diagnostic error.
- No terminal user browser request can post telemetry directly to the ingest
  endpoint.

### 6.3 Axiom Ingest Convergence

The product must converge Axiom writes to a single long-term pattern.

Target:

- `execution-control` / workers continue to emit OTLP to Collector.
- Worker surfaces emit telemetry through the controlled OTLP ingest endpoint.
- Collector exports runtime traces/logs to Axiom.
- `app-api` Worker-local Axiom REST adapter is retired; sanitized request
  lifecycle telemetry flows through controlled OTLP ingest.

Acceptance:

- app-api does not expose a direct Axiom REST adapter or direct Axiom env vars.
- Axiom runtime data is written through the Collector exporter after migration.
- Axiom dataset naming, endpoint edge domain and field allowlist are owned by
  the Collector/runtime telemetry configuration.
- Operator Console never depends on Axiom availability to render request state.

### 6.4 Sentry Boundary

Sentry Cloudflare SDK remains allowed for Worker surfaces.

Required behavior:

- Worker surfaces may use Sentry SDK for uncaught exceptions, request scope, release and
  environment tagging.
- Internal runtime traces may enter Sentry via Collector OTLP fan-out.
- Trace propagation must preserve correlation across browser / Worker / execution-control.

Acceptance:

- `SENTRY_DSN` absence disables Sentry event delivery without breaking request handling.
- Sentry `sendDefaultPii` remains disabled.
- Sentry events scrub auth headers, cookies, operator email and sensitive request payload fields.
- Sentry links shown to operators are projected safe backlinks, not live sink queries.

### 6.5 Temporal Boundary

Temporal remains execution substrate and execution history owner.

Required behavior:

- Temporal workflow/activity history, retry, timeout, heartbeat, signal and cancel semantics stay
  in Temporal.
- Operator Console receives only projected workflow/run/step summaries from app-api.
- Temporal search / visibility may support internal diagnosis, but does not replace Postgres
  request projection.

Acceptance:

- Request detail can show workflow identity and step timeline without querying Temporal from the
  browser.
- Missing Temporal projection is represented as a clear diagnostic gap, not fabricated as an empty
  successful state.

### 6.6 Langfuse Boundary

Langfuse remains LLM / GenAI observability and eval artifact sink.

Required behavior:

- Runtime code emits sanitized OTel attributes through Collector fan-out.
- Eval tooling may publish sanitized scores / backlinks to Langfuse.
- Operator Console reads Langfuse-related data only through app-api projection tables.

Acceptance:

- Langfuse trace/session/user/release/tags attributes are present on relevant runtime spans.
- Langfuse eval backlinks are ingested through internal app-api endpoints and stored as sanitized
  projection records.
- Langfuse exporter or sink outage does not block online answer serving.
- Runtime-to-Collector telemetry delivery failure still follows existing
  `execution-control` fail-close semantics for configured product answer paths.
- Langfuse outage can fail explicit release/eval closeout lanes, but not a user
  answer request by itself.

### 6.7 Projection-first Operator Experience

Operator Console must keep a minimum diagnostic view:

- request status
- selected tool / tool
- terminal outcome / fail-close reason
- duration and token/cost summaries when available
- source/citation/retrieval summary when available
- workflow trace summary when available
- safe external backlinks when available

Acceptance:

- Backlinks are optional fields; absence is shown as “not linked yet” rather than an empty sink
  result.
- External sink errors do not change request truth.
- Request detail can be understood without opening Sentry, Axiom, Temporal or Langfuse.

### 6.8 Deferred Operator Panel Observability Backlog

当前实现优先级回到 eval 平台与 RAG eval。Operator Console 观测面补全先作为
product backlog 记录，不进入当前 eval closeout 的阻塞项。

第一批应补的 panel 观测面是 request-centered triage：

- request detail：`GET /api/operator/requests/:requestId`
- request observability：`GET /api/operator/requests/:requestId/observability`
- Langfuse eval backlink：`GET /api/operator/langfuse/eval-backlinks`
- quality / eval summary：`GET /api/operator/quality/summary`、
  `GET /api/operator/quality/badcases`、
  `GET /api/operator/quality/eval-candidates`、
  `GET /api/operator/evals/coverage`
- runtime pressure：`GET /api/operator/runtime/temporal-task-queues`、
  `GET /api/operator/runtime/autoscaler/decisions`、
  `GET /api/operator/runtime/autoscaler/actuations`

第二批再补 overview 聚合面：

- `GET /api/operator/quality/timeseries`
- `GET /api/operator/intent/summary`
- `GET /api/operator/intent/timeseries`
- `GET /api/operator/safety/summary`
- `GET /api/operator/safety/anomalies`
- `GET /api/operator/cost/summary`
- `GET /api/operator/cost/timeseries`

明确不作为第一批观测主面的内容：

- 不把 official-web、wechat、authenticated-notice 或 campus-services domain ops
  页面混入 answer-path triage。
- 不在 panel 内直连 Axiom、Sentry、Langfuse 或 Temporal。
- 不 iframe 或代理 Langfuse UI；panel 只展示 app-api 投影出的 safe deep link。
- 不展示 raw prompt、raw answer、transcript、retrieved snippet、source body、
  provider raw response 或 memory text。
- 不做全局 raw audit browser；request detail 可先按 `request_id` / `trace_id`
  展示相关 audit 摘要。

Acceptance:

- 当前 eval 工作不被 Operator Console 观测面补全阻塞。
- 后续实现 panel 观测面时，只增加显式 allowlist proxy，不批量暴露全部
  app-api operator inventory。
- 新增 UI 从 request list drill down 到 request detail，并以 app-api sanitized
  projection 为唯一数据源。

## 7. Data Policy

All observability paths must enforce the repo forbidden-field policy.

Forbidden in sink payloads and backlinks:

- raw prompt / raw query
- raw answer
- transcript
- retrieved snippet / source body
- provider raw response
- memory text
- authorization / cookie / JWT / API key
- database URL / object-store secret / provider secret
- operator email

Allowed examples:

- `request_id`
- `trace_id`
- `conversation_id`
- hashed actor identifier
- `surface`
- `status`
- `requested_tool`
- `selected_tool`
- `selected_tool`
- `duration_ms`
- source count / summary
- `workflow_id`
- `run_id`
- `step_id`
- low-cardinality failure kind / fail-close reason

## 8. Implementation Workstreams

### 8.1 Documentation Alignment

- Update `docs/reference/runtime-otel-telemetry-taxonomy.md`.
- Update `docs/architecture/system/ops-observability.md`.
- Update app-api observability docs to state direct Axiom REST ingest is retired.
- Update operator observability docs to reference the PRD acceptance model.
- Ensure docs consistently state that external sinks are drill-down systems, not product truth.

### 8.2 Controlled OTLP Ingest Endpoint

- Define the Worker-origin OTLP HTTP ingest endpoint and authentication model.
- Add method/path allowlist, payload size limits, rate limits and health
  diagnostics.
- Reuse forbidden-field validation before Collector exporter fan-out.
- Ensure terminal user browsers cannot post directly to the ingest endpoint.
- Route Worker-origin telemetry to the existing Collector pipeline.

### 8.3 app-api Axiom REST Adapter Retirement

- Inventory all app-api Axiom event types.
- Map each event type to controlled OTLP ingest.
- Delete the direct adapter and direct Axiom env surface.
- Keep tests preventing direct Axiom exports from reappearing.

### 8.4 Collector Fan-out Validation

- Verify Worker-origin telemetry reaches Collector.
- Verify Collector exports runtime traces/logs to Axiom.
- Verify Collector exports traces to Sentry and Langfuse when configured.
- Verify metrics routing remains explicit and does not silently consume Axiom
  dataset quota.

### 8.5 Backlink Projection

- Ensure app-api has safe projection for:
  - Sentry trace / issue link
  - Axiom query link
  - Temporal workflow identity
  - Langfuse trace / eval link
- Keep backlinks optional and non-authoritative.
- Reject forbidden payload fields before writing backlink projection records.

### 8.6 Trace Correlation Verification

- Verify trace propagation across:
  - campus-web / operator-console-web
  - app-api
  - execution-control
  - Temporal workflow/activity workers
  - Collector fan-out
- Verify a single request can be correlated by `trace_id` and `request_id` across projection,
  Sentry, Axiom and Langfuse.

### 8.7 Operator Console Minimal View

- Keep Operator Console request detail projection-first.
- Show external links only when projected and safe.
- Do not add raw sink explorer UI.
- Do not expose Collector config, vendor auth, Axiom dataset controls or Temporal raw history.

## 9. Acceptance Criteria

This PRD is complete when:

- A reviewer can answer “where does this observability datum live?” from the
  updated owner documents.
- `execution-control` runtime telemetry still reaches Collector with forbidden-field deletion.
- Worker-origin telemetry reaches Collector through controlled OTLP ingest.
- Axiom runtime data is written through the Collector exporter after migration.
- app-api direct Axiom writes are retired, with tests preventing the adapter from
  reappearing.
- Operator Console request detail renders from app-api projection without requiring Sentry, Axiom,
  Temporal or Langfuse availability.
- Safe backlinks can connect one request to Sentry, Axiom, Temporal and Langfuse when those sinks
  have data.
- Tests cover forbidden-field rejection for sink-bound payloads and backlink projection payloads.
- No new code imports vendor telemetry SDKs into `packages/contracts` or core business packages.
- Terminal user pages do not expose observability UI or direct telemetry ingest.

## 10. Open Decisions

- Whether Axiom should receive traces and logs only, or also metrics after volume and quota are
  measured.
- Whether Sentry structured logs are worth enabling for Worker surfaces, given Axiom already owns
  tool read model event query.
- Which exact Operator Console fields should show external backlink availability in the first
  implementation pass.
