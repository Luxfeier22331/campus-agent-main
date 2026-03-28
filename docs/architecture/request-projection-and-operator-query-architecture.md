---
doc_type: architecture
status: superseded
created: 2026-03-28
updated: 2026-03-28
---

# Request Projection And Operator Query Architecture

> Superseded on 2026-03-28 by `docs/architecture/shared-app-api-and-worker-web-surfaces.md` and `docs/decisions/adr-0012-shared-app-api-and-worker-web-surfaces.md`.
> 
> This file records the intermediate direction where request projection was served by a dedicated `apps/operator-query-api`. The accepted direction now folds that responsibility into shared `apps/app-api` while keeping command/query separation internally.

## 文档边界

这份文档冻结 operator-facing request visibility 的长期边界，不负责 panel UI、jobs/operations workflow 或通用 admin backend 设计。

它补充但不替代以下文档：

- 长期 `apps/*` / `packages/*` 分层：`docs/architecture/long-term-architecture.md`
- supervisor command-side 边界：`docs/architecture/supervisor-architecture.md`
- protected panel trust boundary：`docs/architecture/protected-panel-boundary.md`
- protected panel runtime shell：`docs/architecture/protected-panel-runtime-shell.md`
- public consumer chat 数据边界：`docs/architecture/public-consumer-chat-auth-and-data-boundary.md`

## 目标

这里要冻结的是 request truth 如何生成、如何投影、以及 operator 如何读取，而不是先实现一套新的后台产品。

要解决的具体问题只有三件事：

- `apps/supervisor-api` 负责回答执行时，哪些 request facts 在 command side 一次性产生
- 这些 facts 如何异步投影成 operator-facing read model
- protected panel 应该通过哪条 runtime path 读取这些投影

## 核心结论

operator-facing request visibility 固定采用 command/query 分离：

- `apps/supervisor-api`
  负责 command-side answer execution，并写入 durable request facts
- `projection_outbox`
  负责把 command-side 已提交的 request facts 转成可异步消费的投影输入
- projector
  负责把 outbox/facts 物化成 operator-facing read model
- `apps/operator-query-api`
  负责暴露 operator read APIs，例如 `GET /api/requests`
- `apps/protected-internal-panel`
  只消费 `apps/operator-query-api`，不直接读取数据库，也不把 `apps/supervisor-api` 当作后台查询 API

## 当前接受的存储拓扑

当前接受的第一版拓扑是同数据库，而不是同边界。

也就是说：

- `apps/supervisor-api` 与 `apps/operator-query-api` 可以先共用同一个关系数据库
- 不要求现在就物理拆库
- 但 command-side tables 和 operator read-model tables 必须保持逻辑分离

推荐的逻辑落点如下：

- `runtime.request_execution`
  command-side durable request facts
- `runtime.projection_outbox`
  command-side emitted projection records
- `operator.request_projection`
  operator-facing materialized request view

这里冻结的是 ownership 和数据流，不是 schema 名称必须逐字一致。

## 为什么不能直接复用 answer runtime 查询

`apps/supervisor-api` 不应直接承担 `GET /api/requests` 一类 operator read API，原因固定如下：

- command-side answer execution 与 operator query load 的目标不同，不应共用一个 app boundary
- request projection 的读取不应反向耦合到真实 agent answer path
- operator 面板不应依赖 raw audit logs、telemetry sink 或 consumer chat conversation store 作为 canonical truth
- 允许最终一致性，因此没有必要把 read model 强行做成回答链路上的同步查询

## 数据流

### 1. Command-side request execution

公共回答链路保持如下：

`public entry -> apps/supervisor-api -> packages/supervisor-core -> specialist`

当一次回答请求被接受后，command side 负责一次性产出 durable request facts。

这些 facts 至少应覆盖：

- request identity / trace identity
- actor / caller projection
- route / specialist target
- lifecycle status
- timing / timestamps
- cited source identifiers 或可回链 evidence locator

### 2. Projection pipeline

request projection 不在前端即时拼装，而由独立投影流程异步生成：

`runtime.request_execution -> runtime.projection_outbox -> projector -> operator.request_projection`

这条链路明确接受 eventual consistency。

也就是说：

- operator 刷新列表时可以短暂看不到刚完成的请求
- panel 不需要为“零延迟看到新记录”而反向挤压 answer runtime 边界

## 3. Operator read path

operator-facing 读取路径固定为：

`authorized operator -> apps/protected-internal-panel -> apps/operator-query-api -> operator.request_projection`

这里的长期约束是：

- panel 只调用 query-side runtime API
- query-side runtime API 只读取 read model，不回放 answer execution
- request list/detail truth 来自 `request_projection`，而不是 consumer conversation tables、raw JSONL audit、Axiom/Sentry logs 或临时脚本输出

## Ownership Matrix

| Concern | Owner | Not owner |
| --- | --- | --- |
| 回答执行、specialist 委派、最终响应 | `apps/supervisor-api` + `packages/supervisor-core` | `apps/operator-query-api`, panel |
| durable request facts / projection outbox 写入 | command-side runtime | panel |
| request projection 物化 | projector | `packages/supervisor-core` 直接 serving |
| `GET /api/requests` / `GET /api/requests/:id` | `apps/operator-query-api` | `apps/supervisor-api` |
| operator UI | `apps/protected-internal-panel` | `apps/supervisor-api`, `packages/*` |

## Forbidden Shortcuts

以下路径在长期上都不接受：

- panel 直接查询 `apps/supervisor-api` 来拿 request list
- panel 直接连数据库读取 `request_execution` 或 outbox
- 把 consumer chat 的 `conversation` / `message` 表当成 operator request truth
- 把 Axiom、Sentry、OTel sink 或 raw JSONL audit 直接当成 panel 主数据源
- 为了省事把 `apps/operator-query-api` 合并回 `apps/supervisor-api`

## 与 Public Consumer Chat 的关系

`apps/public-consumer-chat` 持有的是 consumer UX truth：

- app user
- session
- conversation
- message

它不是 operator-facing request truth。

因此：

- consumer conversation history 可以作为用户体验记录
- 但 operator request list/detail 必须来自 request projection path

## 当前实现状态

当前仓库还没有正式落地 `apps/operator-query-api`、projector 或 `request_projection` 表。

这份文档冻结的是后续实现目标，避免下一轮实现再次退回以下错误路径：

- 让 panel 直接请求 answer runtime 查列表
- 让 panel 从日志系统反查业务真相
- 让 consumer app 的 chat store 演变成后台运维视图真相
