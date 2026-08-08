---
doc_type: reference
owner_boundary: runtime-observability
status: active
---

# 运行时遥测

## 边界

本文只登记当前代码实际发出的仓库自有 OpenTelemetry 事件、指标和字段边界。它不把目标
设计、测试样例或计划中的事件写成当前合同，也不复制 Collector 部署步骤。

判断一个事件是否存在，必须同时满足：

1. 生产代码存在 emitter 调用；
2. 事件名在 producer 的受控注册表或调用点中固定；
3. 所属测试验证名称和必要字段。

只有 schema、结构体、测试构造或文档表格，不足以证明事件已经发出。

## 当前生产者

### app-api

`apps/app-api/src/modules/telemetry/runtime-event.ts` 负责字段白名单，
`apps/app-api/src/modules/telemetry/console.ts` 将受控事件写为单行 JSON console log。Cloudflare
环境选择的 OpenTelemetry log destination 消费该 application log；`invocation_logs=false`，
app-api 也不维护手写 OTLP exporter。

| 业务事件 | console `event_type` | 用途 |
| --- | --- | --- |
| `request.accepted` | `request.accepted` | 产品请求已受理 |
| `request.finalized` | `request.finalized` | 产品请求已进入终态，并包含有界 stage timing 字段 |
| `request.transport_error` | `request.transport_error` | app-api 到内部执行服务的传输错误 |

未知 `event_type` 会在 producer 内被丢弃，不会透传成任意事件名。

app-api 与 campus-web edge 使用 `@sentry/cloudflare`；campus-web browser 使用
`@sentry/react`，三者共用环境唯一的 canonical Sentry project/DSN。Sentry SDK 数据不属于上述仓库
事件 taxonomy，且在发送前清除 Cookie、header、query、正文、用户、breadcrumb 和未准入 span data。

产品关联字段统一为 `campus.request_id` 和 `campus.trace_id`。它们可以用于 Axiom 关联查询和
Sentry tag 搜索，不替代 OTel `trace_id`/`span_id` 或 Sentry SDK 的原生 trace ID。

Collector 把准入的结构化日志字段保存到 Axiom `attributes.custom`，并把 Collector 事件的 `body`
收敛为普通字符串。Cloudflare application logs 走账号级 Axiom destination，保留结构化 `body`，不经过
Collector；这是另一条活跃日志入口。Ops Web 的日志查询明确同时支持这两条入口：Collector 从
`attributes.custom` 读取，Cloudflare 从 `body` 读取，再投影为统一的 `event_type`、`status`、`source`、
`duration_ms`、`error.code`、`campus.request_id` 和 `campus.trace_id`。不得把任一入口称为旧 fallback，
也不得假设 Cloudflare 字段会出现在 `attributes.custom`。

### execution-control

`apps/execution-control/internal/httpapi/temporal_step_projection_writer.go` 当前发出：

- `execution_control.temporal.step_observation`：一次已写入步骤投影的受控观测，包含步骤、
  activity、队列、耗时和终态摘要。`grounding.prepare` 额外包含受控的 grounding 路由、计数与
  阶段耗时摘要；候选数和阶段耗时只在本次检索提供对应诊断时发送，重放已有 context 时不补
  写缺失值；grounding 的非负计数和阶段耗时若缺失或非法则直接省略，不以 `0` 代替；
  execution-control 不发送模型用量。

新增事件必须先增加真实调用点、字段白名单和测试，再更新本文。

Temporal SDK tracing 在配置启用时产生 SDK 自有 workflow/activity span。其名称和字段遵循
Temporal OpenTelemetry integration，不在本文伪装成仓库自有事件族。

### agent-runtime

`apps/agent-runtime` 使用 OpenAI Agents SDK、Langfuse span processor 和 OTLP exporter 记录
受控的模型执行 trace，并保持 `traceIncludeSensitiveData=false`。它属于 Langfuse/SDK 观测面，
只发送模型、用量、阶段结果和关联元数据。具体边界见 `../architecture/system/langfuse.md` 和
`../contracts/langfuse-runtime.md`。

Agent instrumentation 唯一拥有 model generation。execution-control 的聚合 span 只记录编排和
关联 metadata，不声明 model、token 或 generation 语义。

## 当前指标

| 指标 | 生产者 | 标签边界 |
| --- | --- | --- |
| `campus.execution_control.runtime_requests` | execution-control | task queue、step/activity、tool、status、failure kind |
| `campus.execution_control.runtime_errors` | execution-control | 与 runtime request counter 相同的低基数标签 |
| `campus.execution_control.activity_duration_ms` | execution-control | 与步骤观测相同的低基数标签 |
| `campus.execution_control.schedule_to_start_ms` | execution-control | 与步骤观测相同的低基数标签 |
| `campus.execution_control.personal_memory.operations` | execution-control | operation、outcome、failure kind |
| `campus.execution_control.personal_memory.duration_ms` | execution-control | operation、outcome、failure kind |
| `campus.execution_control.personal_memory.selected_items` | execution-control | operation、outcome、failure kind |
| `campus.execution_control.personal_memory.selected_chars` | execution-control | operation、outcome、failure kind |
| `campus.execution_control.personal_memory.command_receipts` | execution-control | command kind、status、outcome |

请求 ID、用户 ID、会话 ID、run ID、trace ID、文档 ID 和原始错误正文不得成为 metric label。

## 字段边界

app-api 的允许字段由 `RUNTIME_EVENT_ALLOWED_FIELDS_BY_EVENT_TYPE` 唯一维护。主要类别包括：

- 关联标识：`campus.request_id`、`campus.trace_id`；
- 产品边界：`surface`、`principal_type`；
- 结果摘要：`status`、`error_code`、`retryable` 和有界数量；
- 性能：`duration_ms`、固定 stage timing 字段和汇总 budget state；
- 发布信息：`environment`、`release`、`occurred_at`。

execution-control 的允许字段由 `telemetry.Event` 到 OTel attribute 的显式映射维护，主要包括：

- `request_id`、`trace_id`、`run_id`、`workflow_id`、`step_id`；
- `activity_type`、`task_queue`、`activity_attempt`、`step_kind`；
- `duration_ms`、`schedule_to_start_ms`、`status`、`failure_kind`；
- `tool_name`、`fail_close_reason`、`projection_ref`；
- `grounding_mode`、`grounding_status`、受控 scope、候选/证据/token/context 计数和
  `grounding.embedding_ms`、`grounding.search_ms`、`grounding.rerank_ms`、`grounding.pack_ms`；其中
  `grounding.rerank_ms` 当前固定为零，仅为既有字段兼容，不表示外部 reranker；
- 编排 release、session/user 与 Langfuse request/run/trace/workflow metadata。

文档不复制完整字段清单；字段增删以 producer 映射和测试为准。

## 禁止内容

受控产品遥测不得包含：

- prompt、回答、聊天全文或用户原始问题；
- memory 文本、检索片段、source body、OCR 原文；
- provider 原始响应或任意未裁剪错误正文；
- Cookie、Authorization、JWT、session token、API key 或对象存储凭据；
- 通过动态属性名绕过白名单的嵌套 payload。

上述禁止内容同样适用于 Langfuse 运行 trace；Agent receiver 的独立网络边界不授权发送模型
输入输出、对话、工具原始载荷、记忆/检索正文、认证材料或 secret。

## Collector 与下游

OpenTelemetry Agent DaemonSet 采集第一方容器日志与 kubelet metrics，排除 Collector 和 Hindsight
stdout，并把清理后的 log/metric 发往 Gateway。Gateway Deployment 提供四个固定 OTLP/HTTP 入口：
通用信号进入 Axiom，execution-control 编排 trace 按白名单进入 Axiom 和所有环境共用的 Langfuse
`campus-agent` project，Agent 与 Hindsight 受信任 trace 只进入该 project。入口通过 NetworkPolicy
隔离，不使用集群内 bearer token；Gateway 不向 Sentry 导出。

环境仓把同一枚 Axiom runtime token 映射给 Gateway ingest 和 Ops Web query；该 token 覆盖当前三个
dataset 的 Query 与 Ingest，不能因消费者环境变量名称不同而推断为两枚凭据。Gateway exporter 使用
内存发送队列和最长 300 秒重试，不依赖 node-local 持久存储。Worker application log 与 Sentry SDK
链路不经过 Agent 或 Gateway。Cloudflare native invocation logs 和 native traces 当前关闭；它们只
提供补充边缘信号，不能替代由 execution-control 和 Collector 产生的产品 runtime trace。

当前 receiver、端口、字段转换和输出 pipeline 由 `../../infra/otel/README.md` 与 Collector YAML
维护；操作见 `../runbooks/otel.md` 和 `../runbooks/worker-otel.md`。实际启用的 exporter、dataset
和保留期由环境仓决定。

## 验证

修改 producer、字段或指标时至少运行所属测试：

```bash
pnpm --dir apps/app-api exec vitest run -c vitest.node-fast.config.mts \
  test/telemetry.console.test.ts test/telemetry.sentry.test.ts
go -C apps/execution-control test ./internal/telemetry ./internal/httpapi
```

修改 Collector 配置时执行 `../runbooks/otel.md` 的结构校验和本地 debug smoke。外部平台
是否收到信号只能由实际 Collector 和下游查询证明，不能由配置文件存在替代。

execution-control 的 `campus_execution_control_telemetry_submitted_total` 表示 span 已提交给异步
OTel exporter，不表示 Collector 或下游已经持久化；导出失败另见
`campus_execution_control_telemetry_failed_total`。
