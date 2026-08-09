---
doc_type: reference
owner_boundary: runtime-observability
status: active
---

# 运行时遥测

## 边界

本文登记当前代码实际发出的仓库自有观测信号及其消费者。产品状态、Temporal history、PostgreSQL
投影和 Hindsight 数据不是遥测；配置、schema、测试 fixture 或文档表格本身也不能证明信号已经发出
或被环境接收。

每个保留信号必须有当前 producer、consumer 和删除条件。当前外部运行信号只有：

- app-api 的三个有界 application events，供 Cloudflare log destination 写入 Axiom logs；
- Campus Web 与 app-api 的 Sentry SDK 错误，以及 Campus Web browser 的生产采样性能 trace；
- Agent Runtime 的可选 Langfuse trace。

execution-control、ingestion-control、source-collector 和 Hindsight 不维护仓库自有 OTel exporter。
它们的产品投影、业务调用、Temporal 状态和普通进程日志不能据此改写成外部遥测合同。

## App API application events

`apps/app-api/src/modules/telemetry/runtime-event.ts` 维护字段白名单，
`apps/app-api/src/modules/telemetry/console.ts` 将受控事件写为单行 JSON console log。环境选择的
Cloudflare application-log destination 可以消费这些日志；app-api 不维护手写 OTLP exporter。

| 事件 | 用途 | 当前消费者 |
| --- | --- | --- |
| `request.accepted` | 产品请求已受理 | Axiom request log 查询 |
| `request.finalized` | 产品请求进入终态及有界 stage timing/usage 摘要 | Axiom request log 查询 |
| `request.transport_error` | app-api 到执行服务的传输失败 | Axiom request log 查询 |

未知 `event_type` 会在 producer 内被丢弃。周期 dispatcher、sweeper 和 credential check 的成功结果
保存在所属数据库或调用返回中，不再复制成周期性成功日志；未处理错误仍通过进程失败或 Sentry
错误边界表达。

产品关联字段为 `campus.request_id` 和 `campus.trace_id`。Axiom 的 Ops Web 查询只使用已保存
`requestId` 作为 durable business key；`traceId` 来自持久请求详情，只用于页面展示和人工关联，
不能成为第二个必填过滤条件。Axiom 和 Sentry 响应不携带 `traceId`、OTel correlation 或供应商
`searchQuery`。

Cloudflare application logs 保留平台提供的结构化 `body`，不经过本地 Collector。Ops Web 只从
固定 logs dataset 读取 `attributes.custom` 或 `body` 中允许的摘要字段，不返回任意原始 body、
attributes、header、query 或认证材料。

## Sentry

app-api 与 campus-web edge 使用 `@sentry/cloudflare`，campus-web browser 使用
`@sentry/react`。三者使用环境选择的 canonical Sentry project/DSN，并在发送前清除 Cookie、
header、query、正文、用户、breadcrumb 和未准入 span data。

Sentry 保存应用错误、release/source map，以及 Campus Web browser 为生产 Web Vitals 保留的采样
性能 trace。staging/local browser、campus-web edge 和 app-api 不发送性能 transaction。浏览器 TTFT
`chat.browser_ttft_ms` 已删除；没有消费者的自定义 metric 不属于当前合同。Sentry Issue 查询是
Ops Web 的按需外部读取，不参与 readiness 或产品终态。

## Agent Runtime trace

`apps/agent-runtime` 使用 OpenAI Agents SDK、OpenInference、Langfuse span processor 和 OTLP/HTTP
exporter。只有配置 OTLP endpoint 时才启用，且必须保持：

- `traceIncludeSensitiveData=false`；
- OpenInference `hideInputs=true`、`hideOutputs=true`；
- producer-side span/resource/metadata allowlist；
- 只发送 Agent/model/tool 名称、用量、阶段结果和
  `request_id`、`run_id`、`trace_id`、`turn_id` 关联字段。

执行编排、grounding 明细、Temporal activity、Hindsight 调用、queue、workflow 和
`activity_attempt` 不再复制到 Langfuse metadata。具体字段和个人数据删除见
`../contracts/langfuse-runtime.md`。

环境可以因配额停止 Langfuse ingestion。此时在线回答、PostgreSQL 投影和 Temporal 执行继续工作，
“没有新 trace”不是产品故障或发布失败。

## 字段与内容边界

受控运行信号不得包含：

- prompt、回答、聊天全文或用户原始问题；
- memory 文本、检索片段、source body、OCR 原文；
- provider 原始响应或任意未裁剪错误正文；
- Cookie、Authorization、JWT、session token、API key、数据库地址或对象存储凭据；
- 通过动态属性名或嵌套 payload 绕过白名单的内容。

app-api 的允许字段由 `RUNTIME_EVENT_ALLOWED_FIELDS_BY_EVENT_TYPE` 唯一维护。Agent trace 的允许
字段由 `apps/agent-runtime/src/telemetry-sanitizer.ts` 唯一维护。文档不复制完整字段清单，字段增删必须先
修改真实 producer 和测试。

## Collector 与下游

源码本地 Collector 只提供一个 Agent trace receiver：

- debug：`traces/agent -> debug`；
- prodlike：`traces/agent -> Langfuse`。

它不采集容器日志、kubelet metrics，不接收 execution-control 或 Hindsight，不向 Axiom 或 Sentry
导出。环境仓拥有实际部署是否启用、endpoint、Secret、资源和保留期；源码文件存在不证明某环境
已经部署或收到数据。

Cloudflare Worker application logs、Sentry SDK 与 Agent trace 是三条独立链路。任何一条链路失败
都不能改写 PostgreSQL 产品状态或 Temporal workflow 状态。

## 验证

修改 producer 或字段时运行所属测试；修改 Collector 配置时运行：

```bash
scripts/otel/validate-config.sh
```

外部平台是否收到信号只能由实际环境查询证明。Langfuse 配额策略明确停收时，不运行会把“无 trace”
误判为故障的 live gate。
