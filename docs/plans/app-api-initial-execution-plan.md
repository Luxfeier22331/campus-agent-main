---
doc_type: plan
status: completed
created: 2026-03-28
updated: 2026-03-28
---

# App API 前三步执行计划

## 文档边界

这份文档只覆盖 `apps/app-api` 落地的前三步执行计划：

1. Worker foundation
2. 数据库与 auth 基线
3. chat command path 与 `app-api -> supervisor-api` adapter

它补充但不替代以下文档：

- 总体实施基线：`docs/plans/app-api-worker-foundation.md`
- runtime 边界：`docs/architecture/app-api-architecture.md`
- 产品层 HTTP contract：`docs/contracts/app-api-http.md`
- execution contract：`docs/contracts/app-api-supervisor-execution.md`
- request lifecycle：`docs/contracts/app-api-request-lifecycle.md`
- error model：`docs/contracts/app-api-error-model.md`
- 数据模型：`docs/data/app-api-schema.md`

这份文档不覆盖：

- `request_projection` materialization 与 `GET /api/operator/requests*`
- `public-chat-web` / `protected-panel-web` 的接线改造
- panel 的 `Jobs` / `Operations`

## 完成状态

这份前三步计划现在已经完成，且当前实现已经略微超出原始计划边界。

仓库内现已具备：

- `apps/app-api` Worker runtime、Hono app、`GET /healthz`、`GET /readyz`
- Drizzle schema / migration baseline、Better Auth handler、`GET /api/me`
- `POST /api/chat/requests` 与显式 `app-api -> supervisor-api` execution adapter
- `runtime.request_execution` 与 `runtime.projection_outbox` 的 command-side durable write

在这份计划闭合之后，又继续落地了：

- `request_projection` materialization 与 `GET /api/operator/requests*`
- `public-chat-web` 与 `protected-panel-web` 对 shared `app-api` 的接线

因此，这份文档现在只作为前三步已完成的历史执行基线保留；剩余未完成的 `conversation` API 属于 `docs/plans/app-api-worker-foundation.md` 的后续缺口，而不再属于本文件的未完成项。

## 目标

在不重开已冻结边界的前提下，把 `apps/app-api` 的前三步实现成一个可持续推进的代码底座：

- 有真实 Worker runtime 壳，而不是继续停留在文档层
- 有统一的 auth/schema/migration baseline，而不是先写一套临时后端
- 有最小可验证的 chat command mainline，可以把请求收口到 `app-api`

## 全局约束

- `app-api` 是唯一的 product-layer auth/session/principal owner
- `apps/supervisor-api` 只做 internal caller admission，不恢复最终业务 actor
- `app-api -> supervisor-api` request body 必须显式携带 `actor`
- `runtime.request_execution` 与 `runtime.projection_outbox` 是 canonical durable truth
- queue 不进入前三步主实现，只允许在后续 outbox 已成立后再引入
- 不为了先跑通而在 `public-chat-web` 或 panel 内部再复制一套 backend

## Step 1: Worker Foundation

### 目标

建立 `apps/app-api` 的最小 Worker runtime 与工程骨架，使其能作为后续所有实现的稳定宿主。

### 范围

- 创建 `apps/app-api/`
- 建立 Worker 入口、Hono app、route mounting 基线
- 建立 `wrangler` 配置与本地开发命令
- 建立配置加载与 env schema
- 提供 `GET /healthz`
- 提供 `GET /readyz`
- 建立最小测试运行方式
- 建立模块目录骨架：
  - `auth`
  - `chat`
  - `runtime-command`
  - `operator-query`
  - `projection`
  - `integration`

### 不做

- 不接 Better Auth
- 不接数据库
- 不实现 chat/operator 业务接口
- 不接 `public-chat-web` 或 `protected-panel-web`

### 实现要点

- 入口 shape 以 Hono 为准，不引入第二层 HTTP framework
- `readyz` 只检查“配置是否齐备 / 依赖是否已配置”，不在这一步做真实 DB ping
- config 模块应为后续 Hyperdrive、service binding、auth secret 预留字段
- 测试基线优先保证 Worker app 可在 `vitest + @cloudflare/vitest-pool-workers` 下启动

### 验收标准

- 仓库内出现 `apps/app-api` 的独立 Worker 项目骨架
- `GET /healthz` 返回与 contract 一致的最小 liveness 响应
- `GET /readyz` 返回与 contract 一致的最小 readiness 响应
- 本地测试可启动 Worker app 并对上述两个接口做断言
- 目录结构能承接后续 `auth/chat/runtime/operator` 模块，不需要下一步再重构入口

### 测试

- `apps/app-api` 内的 Worker 路由单测：
  - `GET /healthz -> 200`
  - `GET /readyz -> 200`
  - 未知路由返回预期 `404`
- config 测试：
  - 缺关键 env 时能 fail-close
  - readiness 依赖状态映射符合 contract

## Step 2: 数据库与 Auth 基线

### 目标

建立 `app-api` 的统一数据访问与身份基线，使后续 command path 直接落在 accepted schema/migration 之上，而不是临时内存态或另一套 migration 世界观。

### 范围

- 引入 Drizzle schema 代码组织
- 建立 `auth.*` / `chat.*` / `runtime.*` / `operator.*` 四个逻辑分域的 schema 文件结构
- 配置 runtime DB connection 与 migration connection
- 接入 Better Auth handler
- 实现 `GET /api/me`
- 建立 principal mapping 基线：
  - `public_user` 走 Better Auth session
  - `operator` 先保留受控 trusted identity bridge

### 不做

- 不在这一步完成完整 conversation CRUD
- 不在这一步实现 `POST /api/chat/requests`
- 不在这一步实现 request projection query
- 不在这一步引入独立 operator end-user user system

### 实现要点

- Drizzle schema 必须共用一套 codebase
- Better Auth adapter-owned 表与 app-domain 表共用一条 migration pipeline
- runtime DB access 通过 Hyperdrive 封装
- migration / drift check / schema push 使用 direct management connection
- `GET /api/me` 的 response shape 必须对齐 `docs/contracts/app-api-http.md`
- `operator` principal 只作为受控入口能力存在，不额外创建第二套用户系统

### 验收标准

- `apps/app-api` 内存在可运行的 Drizzle schema 与 migration 配置
- Better Auth 能在 `app-api` 内挂载到 `ALL /api/auth/*`
- `GET /api/me` 可以返回当前 principal/session/permissions 结构
- 数据库连接职责被明确拆成 runtime path 与 migration path 两套配置入口
- schema 组织与文档一致，不出现 auth/app-domain 双 migration pipeline

### 测试

- schema/config 测试：
  - runtime connection 使用 Hyperdrive 配置
  - migration config 使用 direct connection 配置
- auth handler / session 测试：
  - 未登录访问 `GET /api/me` 返回 `401` 或等价 `session_required`
  - 已登录 public user 返回 `principal.type=public_user`
  - trusted operator bridge 命中时返回 `principal.type=operator`
- contract 测试：
  - `GET /api/me` response shape 与 HTTP contract 一致
  - 错误 envelope 与 `app-api-error-model.md` 一致

## Step 3: Chat Command Path 与 Execution Adapter

### 目标

把 `POST /api/chat/requests` 打通成最小可验证主链路：`app-api` 接请求、做 ownership 与 principal mapping、写 command-side truth、显式调用 `supervisor-api`、返回产品层响应。

### 范围

- conversation ownership guard 的最小实现
- `chat.messages` user / assistant message 写入
- `runtime.request_execution` 写入
- `runtime.projection_outbox` 写入
- `Idempotency-Key` 最小实现
- `app-api -> supervisor-api` HTTP adapter
- `POST /api/chat/requests` handler
- execution outcome 到产品层 response 的映射

### 不做

- 不在这一步实现 `operator.request_projection` 物化
- 不在这一步实现 `GET /api/operator/requests*`
- 不在这一步实现 streaming
- 不在这一步做 queue consumer

### 实现要点

- 请求进入后先完成 session/principal lookup 与 conversation ownership 校验
- `requestId` 与 `traceId` 由 `app-api` canonical 分配
- 对 `supervisor-api` 的调用必须显式传 `actor`
- `request_execution` 与 `projection_outbox` 必须在 command-side commit 中 durable 写入
- `200 + handled execution error` 与 HTTP transport error 必须严格区分
- `chat.messages` 只承接 UX truth，不反向承担 operator request truth

### 验收标准

- `POST /api/chat/requests` 可以完成一次最小同步问答调用
- `app-api` 调 `supervisor-api` 时使用 execution contract 中定义的 snake_case internal payload
- `runtime.request_execution` 至少写入 `accepted` 和最终状态
- `runtime.projection_outbox` 至少写入 `request.accepted` 与最终事件
- `Idempotency-Key` 能区分重复重放、进行中冲突和 fingerprint 冲突
- 返回给前端的响应 shape、header、错误模型与 contract 一致

### 测试

- handler/integration 测试：
  - 成功路径：`completed`
  - 澄清路径：`needs_clarification`
  - 安全无答案路径：`no_answer`
  - handled execution error：`200 + result.kind=error`
- ownership/auth 测试：
  - conversation 不属于当前 user 时 fail-close
  - session 缺失时返回 `401`
- idempotency 测试：
  - 相同 fingerprint + 已完成请求返回原结果
  - 相同 fingerprint + `accepted` 返回 `409 request_in_progress`
  - 不同 fingerprint + 相同 key 返回 `409 idempotency_conflict`
- adapter 测试：
  - outbound request 包含显式 `actor`
  - outbound request/response 映射符合 `docs/contracts/app-api-supervisor-execution.md`
- persistence 测试：
  - `chat.messages`、`runtime.request_execution`、`runtime.projection_outbox` 的最小写入行为正确

## 提交边界建议

建议前三步至少拆成以下提交：

1. `feat: 初始化 app-api Worker foundation`
2. `feat: 添加 app-api 数据库与认证基线`
3. `feat: 打通 chat command 与 supervisor 执行适配`

如果第 2 步内部改动过大，可以继续拆成：

- `feat: 添加 app-api Drizzle schema 与 migration 配置`
- `feat: 接入 Better Auth 与 principal 基线`

## 完成定义

当这份文档覆盖的前三步全部完成时，应同时满足：

- `apps/app-api` 已经是可启动、可测试的 Worker app
- auth/schema/migration baseline 已按 accepted 方向落地
- `POST /api/chat/requests` 已形成最小可验证主链路
- 但 `operator.request_projection` 与 panel `Requests` query API 仍可保持未完成状态

这意味着：前三步完成后，仓库将拥有一个真实可推进的 shared app backend，而不是继续停留在架构文档阶段。

当前仓库状态已经满足并超出上述完成定义。
