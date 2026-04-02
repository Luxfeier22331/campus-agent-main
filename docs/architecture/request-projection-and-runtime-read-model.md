---
doc_type: architecture
status: active
created: 2026-03-28
updated: 2026-04-02
---

# Request Projection And Runtime Read Model

## 文档边界

这份文档冻结 request projection 的长期 ownership、生产时机与 read-model 边界。

它补充但不替代以下文档：

- 仓库级长期边界：`docs/architecture/long-term-architecture.md`
- shared app backend / product topology：`docs/architecture/shared-app-api-and-worker-web-surfaces.md`
- `app-api` runtime 与内部边界：`docs/architecture/app-api-architecture.md`
- `app-api` request lifecycle：`docs/contracts/app-api-request-lifecycle.md`
- `app-api` 数据模型：`docs/data/app-api-schema.md`
- supervisor 与 runtime shell 分层：`docs/architecture/supervisor-architecture.md`
- protected panel runtime shell：`docs/architecture/protected-panel-runtime-shell.md`
- observability stack：`docs/decisions/adr-0010-observability-and-telemetry-stack.md`
- request projection ownership ADR：`docs/decisions/adr-0016-app-api-request-projection-and-panel-query-ownership.md`

这份文档不冻结：

- projection store 的具体数据库或托管产品
- panel 页面布局与交互
- retrieval ACL 最终治理闭环
- operator action / approval workflow

## 目标

这里要冻结的是：

- request projection 应该由谁生产
- 在什么时机生产
- 哪些数据面是 canonical truth，哪些不是
- panel 与 chat 如何在不重复造后端的前提下消费这类数据

## 核心结论

长期 canonical request projection 固定为：

- 在 shared `app-api` 的 command path 内一次产出 canonical request facts 与 projection input
- 由 `apps/app-api` 对应的 `apps/*` boundary 以 same-database outbox-first 方式持久化 `runtime.request_execution` 与 `runtime.projection_outbox`
- 由同一 `app-api` boundary 物化 `operator.request_projection` 并暴露 list/detail read API

第一 owner 固定为：

- `apps/app-api`

这意味着：

- panel 不生产 canonical request projection
- `public-chat-web` 不生产 canonical operator-facing request projection
- telemetry / audit sink 不承担 panel 的主读模型
- `apps/supervisor-api` 不承担 request list/detail API

## Canonical Flow

长期推荐链路固定为：

`browser -> public-chat-web / protected-panel-web -> app-api command/query boundary -> runtime.request_execution / projection_outbox -> projector -> operator.request_projection -> app-api read API -> panel BFF -> panel UI`

其中：

- command path 与 read-model path 属于同一个 shared app boundary
- durable request facts 与 projection input 必须在 chat request handling 内提交
- materialized request projection 可以在同一 boundary 内异步生成
- queue 可以在 outbox 之后用于 fan-out，但不是第一真相源
- panel 只读取 runtime-owned projection API，不直接读取底层存储

## Ownership Model

### App API command boundary owns

- 接收来自 public chat 的产品层请求
- 构造 canonical request identity 与 correlation fields
- 在一次处理内同时产出 request facts、execution correlation 与 request projection input
- 持久化 `runtime.request_execution` 与 `runtime.projection_outbox`
- 在同一 boundary 内负责 `request_projection` 物化
- 暴露 `GET /api/operator/requests` / `GET /api/operator/requests/:id` 一类 runtime-owned read APIs

直接含义：

- `apps/app-api` 是 request projection 的第一 owner
- `apps/app-api` 写 `runtime.request_execution` / `runtime.projection_outbox`
- `apps/app-api` 提供 panel 读取的 request list/detail query surface

### Execution engine owns

- 接收受控执行请求
- 进入 `packages/supervisor-core`
- 返回 execution result 与最小执行元数据

`apps/supervisor-api` 不拥有：

- request projection store host
- request list/detail HTTP API
- 面向 panel 的分页、过滤或 read-model persistence

### Supervisor core owns

- 最小 audit / trace projector
- route、capability、scope、status、source summary 等最小治理语义

`packages/supervisor-core` 不拥有：

- request projection store host
- request list/detail HTTP API
- 面向 panel 的分页、过滤或 read-model persistence

### Panel owns

- operator admission
- Worker-local BFF
- UI shell、authProvider、dataProvider 与 route organization

`apps/protected-panel-web` 不拥有：

- canonical request projection 生产权
- 直接读取 audit log / telemetry sink / consumer chat tables 的权限

## Non-Canonical Sources

以下数据面都不是 canonical request projection truth：

- `chat.*` conversation / message store
- JSONL audit sink
- `Axiom`、`Sentry` 或其他 telemetry sink
- raw trace dump

它们可以承担：

- UX history
- correlation
- observability
- debugging

但不能直接替代 runtime-owned request list/detail read model。

## Minimum Projection Boundary

长期 request projection 至少应稳定承载：

- `request_id`
- `trace_id`
- `surface` 或入口来源
- 相关 `conversation_id` 或等价关联标识
- 最小 principal / actor 摘要
- `requested_capability`
- `requested_scope`
- `selected_target`
- `status`
- `error_code`
- `source_doc_ids` 或等价来源摘要
- started/completed 时间与 duration

可以按受控方式增加：

- no-answer / clarification / failure reason summary
- answer summary 或问题摘要
- handbook policy-object resolution summary，例如 resolved policy title / doc id、rewritten query、clarification/no-answer reason code 与 retrieved title summary

默认不要求：

- raw prompt 全量暴露
- raw answer 全量暴露
- package-internal trace 结构直接暴露给 panel

补充规则：

- 这类 summary diagnostics 由 `apps/app-api` 在 command / projection path 内从 supervisor result 提取并物化
- `apps/protected-panel-web` 只能展示已物化字段，不能自行回放 retrieval 或从 evidence bundle 逆向合成诊断解释

## Current Repo Mapping

当前仓库已经落地完整的第一版 shared request-projection path：

- `apps/app-api` 已落地 Worker runtime、chat command path 与 operator query path
- `apps/app-api` 已写入 `runtime.request_execution` 与 `runtime.projection_outbox`
- `apps/app-api` 已物化 `operator.request_projection`
- `apps/app-api` 已提供 `GET /api/operator/requests` 与 `GET /api/operator/requests/:requestId`
- `apps/protected-panel-web` 的 `Requests` domain 当前应消费这些 runtime-owned APIs
- `packages/supervisor-core` 仍只产出最小 audit / trace 语义
- `apps/supervisor-api` 仍只承担 execution engine transport

因此当前正确读法是：

- panel `Requests` 已解锁
- panel 仍不得绕过 `app-api` 读取 audit log、telemetry sink、consumer chat tables 或 `apps/supervisor-api`
- consumer 会话存储只能继续作为关联参考，不承担 operator-facing request truth

## Non-Goals

- 不把 panel 变成第二个业务后端
- 不把 consumer app conversation store 升级成 operator read model
- 不让 telemetry 产品承担 canonical request list/detail truth
- 不把 request projection host 下沉到 `packages/*`
- 不让 `apps/supervisor-api` 顺手吸收 panel query backend 职责
