---
doc_type: contract
owner_boundary: apps/app-api
status: active
---

# App API 观测边界

## 范围

App API 不提供请求列表、请求详情、运行健康、Temporal 队列、trace 正文或观测配置接口。
Operator Console 也不代理这些数据。

App API 只在产品请求生命周期内维护以下可关联事实：

- `chat.turn_dispatches` 保存受理与终态；
- `chat.messages` 保存用户和助手消息；
- `runtime.request_observability_fact` 保存受控诊断摘要；
- `request_id`、`run_id`、`trace_id` 和 `conversation_id` 用于跨系统关联。

字段与写入规则分别由 `docs/contracts/app-api/request-lifecycle.md` 和
`docs/data/app-api/runtime.md` 定义。

## 消费边界

- Ops Web 使用专用数据库角色直接读取允许的列，并与 execution-control 的内部 Temporal
  队列接口关联。
- Langfuse、Temporal UI 和 OpenTelemetry 后端保留各自原始观测能力。
- Provider 配置仍通过 app-api operator 接口管理，但它不是观测配置。

不得恢复 app-api Ops Index、request projector、execution audit backflow、replay capture 或
LLM debug trace 配置接口。

## 可执行来源

- `apps/app-api/src/db/schema/chat.ts`
- `apps/app-api/src/db/schema/runtime.ts`
- `apps/app-api/src/modules/runtime-command/`
- `apps/app-api/ops/db/ops-web-database.ts`
