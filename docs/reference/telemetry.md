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
`apps/app-api/src/modules/telemetry/otlp.ts` 将受控事件发送为 OTLP trace 和 log。

| 业务事件 | OTLP span/log 名称 | 用途 |
| --- | --- | --- |
| `request.accepted` | `runtime.request.accepted` | 产品请求已受理 |
| `request.finalized` | `runtime.request.finalized` | 产品请求已进入终态 |
| `request.stage_timing` | `runtime.request.stage_timing` | 受控阶段耗时 |
| `request.transport_error` | `runtime.request.transport_error` | app-api 到内部执行服务的传输错误 |
| `identity.endpoint` | `runtime.identity.endpoint` | 身份端点调用结果 |

未知 `event_type` 会在 producer 内被丢弃，不会透传成任意事件名。

### execution-control

`apps/execution-control/internal/httpapi/temporal_step_projection_writer.go` 当前发出：

- `execution_control.temporal.step_observation`：一次已写入步骤投影的受控观测，包含步骤、
  activity、队列、耗时、模型用量和终态摘要。

`apps/execution-control/internal/telemetry/emitter.go` 中保留的旧 answer 名称归一化逻辑和测试
构造不是额外的生产事件注册表。新增事件必须先增加真实调用点和测试，再更新本文。

Temporal SDK tracing 在配置启用时产生 SDK 自有 workflow/activity span。其名称和字段遵循
Temporal OpenTelemetry integration，不在本文伪装成仓库自有事件族。

### agent-runtime

`apps/agent-runtime` 使用 OpenAI Agents SDK、Langfuse span processor 和 OTLP exporter 记录
受信任的模型执行 trace。它属于 Langfuse/SDK 观测面，不把模型输入输出复制到 app-api
的受控产品事件中。具体边界见 `../architecture/system/langfuse.md` 和
`../contracts/langfuse-runtime.md`。

### 尚未登记的生产者

当前没有代码事实支持以下仓库自有 active event family：

- `execution.activity.*`
- `agent.tool.*`
- `retrieval.runtime_observation`
- `ingestion.run.*`
- `index.release.*`
- `telemetry.export.*`

以后如果实现，应由对应 runtime 拥有 emitter、字段白名单和测试；实现前不得加入 active
taxonomy。

## 当前指标

| 指标 | 生产者 | 标签边界 |
| --- | --- | --- |
| `campus.app_api.stage_duration_ms` | app-api | `stage_field`、`budget_state`、`selected_tool`、`status`、`surface` |
| `campus.execution_control.runtime_requests` | execution-control | task queue、step/activity、tool、status、failure kind |
| `campus.execution_control.runtime_errors` | execution-control | 与 runtime request counter 相同的低基数标签 |
| `campus.execution_control.activity_duration_ms` | execution-control | 与步骤观测相同的低基数标签 |
| `campus.execution_control.schedule_to_start_ms` | execution-control | 与步骤观测相同的低基数标签 |

请求 ID、用户 ID、会话 ID、run ID、trace ID、文档 ID 和原始错误正文不得成为 metric label。

## 字段边界

app-api 的允许字段由 `RUNTIME_EVENT_ALLOWED_FIELDS_BY_EVENT_TYPE` 唯一维护。主要类别包括：

- 关联标识：`request_id`、`trace_id`、`conversation_id`、经过哈希的 actor 标识；
- 产品边界：`surface`、`principal_type`、`requested_tool`、`selected_tool`；
- 结果摘要：`status`、`error_code`、`retryable`、数量和受控摘要；
- 性能：`duration_ms`、`stage_field`、`budget_state`；
- 发布信息：`environment`、`release`、`occurred_at`。

execution-control 的允许字段由 `telemetry.Event` 到 OTel attribute 的显式映射维护，主要包括：

- `request_id`、`trace_id`、`run_id`、`workflow_id`、`step_id`；
- `activity_type`、`task_queue`、`activity_attempt`、`step_kind`；
- `duration_ms`、`schedule_to_start_ms`、`status`、`failure_kind`；
- `selected_tool`、`fail_close_reason`、`projection_ref`；
- provider、model 和 token usage 的受控字段。

文档不复制完整字段清单；字段增删以 producer 映射和测试为准。

## 禁止内容

受控产品遥测不得包含：

- prompt、回答、聊天全文或用户原始问题；
- memory 文本、检索片段、source body、OCR 原文；
- provider 原始响应或任意未裁剪错误正文；
- Cookie、Authorization、JWT、session token、API key 或对象存储凭据；
- 通过动态属性名绕过白名单的嵌套 payload。

Langfuse 受信任 trace 可以按其合同保存诊断所需的模型输入输出，但仍不得包含认证材料和
secret。两类数据不能相互复制或混称。

## Collector 与下游

运行时通过 OTLP 进入 Collector，不直接在业务代码中集成 Sentry、Axiom 或其他日志平台。
Collector 配置拥有字段删除、批处理、重试、采样和 exporter 路由：

- Sentry：trace；
- Axiom：按环境配置接收 trace、log 和 metric；
- Langfuse：受控 LLM trace；
- 本地 debug exporter：开发诊断。

实际启用哪些 exporter 由环境仓和 Collector 配置决定，不能从本文推断。配置和操作见
`../runbooks/otel.md`，仓库配置说明见 `../../infra/otel/README.md`。

## 验证

修改 producer、字段或指标时至少运行所属测试：

```bash
pnpm --dir apps/app-api exec vitest run -c vitest.node-fast.config.mts test/telemetry.otlp.test.ts
go -C apps/execution-control test ./internal/telemetry ./internal/httpapi
```

修改 Collector 配置时执行 `../runbooks/otel.md` 的结构校验和本地 debug smoke。外部平台
是否收到信号只能由实际 Collector 和下游查询证明，不能由配置文件存在替代。
