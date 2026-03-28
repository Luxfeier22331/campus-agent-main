---
doc_type: plan
status: active
created: 2026-03-28
updated: 2026-03-28
---

# App API Worker Foundation 实施方案

**Goal:** 在不重开 `supervisor-api` / `packages/*` 边界的前提下，落地 `apps/app-api` 作为 Worker-native 的共享产品后端，承接 chat 与 panel 的产品层 API、auth/session、conversation、request ledger 与 operator read path。

**Architecture:** 本次实施固定采用 `public-chat-web/protected-panel-web -> app-api (Worker) -> supervisor-api (execution engine)`。`apps/app-api` 是 internal-only Worker runtime，内部采用模块化单体与 command/query 分离；它拥有产品层 auth/session/conversation、chat ingress、`request_execution` / `projection_outbox` 写入与 `request_projection` 读取，但不拥有 supervisor routing、specialist orchestration 或 retrieval internals。

**Tech Stack:** TypeScript, Cloudflare Workers, Wrangler, Hono, Zod, Better Auth, Drizzle ORM, `pg`, Hyperdrive, Vitest, `@cloudflare/vitest-pool-workers`

## 当前 main worktree 状态

这份文档描述的是 `apps/app-api` 的目标实现基线，不等于当前 main worktree 已经完整合入的代码状态。

截至当前 main：

- `apps/app-api` 只落地了最小 Python projection seam，用于 canonical identity / profile memory / session summary 到共享 `ContextProjection` 的构造
- shared contracts、supervisor、rag-specialist 与 retrieval side 的 intent / memory / ACL 边界已经在 main 推进
- 更完整的 Worker runtime、auth/chat/operator API、Drizzle schema、projection data plane 与 web-surface integration 仍在独立 worktree 推进

因此，在相关实现正式 merge 回 main 之前，本文仍应被读取为 forward implementation baseline，而不是 main 已完成现状。

## 摘要

这份方案只回答五个问题：

- `app-api` 具体承接哪些职能
- `app-api` 应该用什么框架与库
- `public-chat-web` / `protected-panel-web` 如何与它对接
- `app-api` 的最小 API surface 与数据模型是什么
- `app-api` 应如何分波次实施，才能不重新长出第二个 orchestrator

本轮明确不做：

- 不把 `apps/supervisor-api` 合并回 shared product backend
- 不为 panel 再建一套独立 query backend
- 不把 `packages/contracts` 扩展成 browser product API contract
- 不为了 projector 再单独长出一个产品后端
- 不在本轮重做 UI、panel workflow 或 retrieval 语义

## 设计输入

这份方案基于以下已冻结 truth：

- `docs/architecture/long-term-architecture.md`
- `docs/architecture/shared-app-api-and-worker-web-surfaces.md`
- `docs/architecture/app-api-architecture.md`
- `docs/architecture/cloudflare-runtime-topology.md`
- `docs/architecture/supervisor-architecture.md`
- `docs/decisions/adr-0012-shared-app-api-and-worker-web-surfaces.md`
- `docs/decisions/adr-0013-app-api-worker-runtime.md`

官方实现参考来自：

- Cloudflare Workers framework/runtime docs
- Cloudflare Service Bindings / Hyperdrive docs
- Hono 官方 Cloudflare Workers 文档
- Better Auth 官方 Hono 集成文档
- Drizzle 官方 PostgreSQL 文档

## 职责闭包

`apps/app-api` 负责：

- public chat 用户认证与 session
- protected panel 的受控 operator principal 入口
- account / identity projection
- conversation / message persistence
- chat request ingress
- request correlation、request ledger 与 projection input 写入
- 调用 `apps/supervisor-api`
- operator-facing request list/detail API

`apps/app-api` 不负责：

- supervisor routing / specialist orchestration
- retrieval strategy、evidence shaping 或 corpus logic
- public/protected web shell UI
- panel 业务动作编排
- 让 panel 查询时回放 answer execution

## Runtime Topology

浏览器不直接访问 `app-api` 的独立 public hostname。

MVP 调用路径固定为：

`browser -> public-chat-web same-site route -> app-api service binding -> supervisor-api`

`browser -> protected-panel-web same-site route -> app-api service binding -> operator.request_projection`

具体规则：

- `public-chat-web` 与 `protected-panel-web` 对浏览器暴露 same-site `/api/*` seam
- 它们在 server/runtime 侧通过 Service Binding 以 HTTP `fetch()` 调用 `app-api`
- `app-api` 再通过受控内部 HTTP adapter 调用 `apps/supervisor-api`
- `apps/supervisor-api` 保持 execution engine，不反向暴露给 browser

这里不采用 Service Binding RPC 作为默认主路径，原因是 `app-api` 需要保持显式 HTTP 语义、cookie、header 与状态码边界。

## 选型结论

### HTTP 框架

首选：`Hono`

原因：

- 它天然贴合 Worker runtime
- API-only 心智足够轻，不会把 `app-api` 误导成 full-stack UI host
- 对 Zod、OpenAPI、middleware、typed client 的支持够用
- Better Auth 已有官方 Hono 集成

不选：

- `TanStack Start`
  更适合 web surface，而不是 shared API Worker
- `Fastify` / `NestJS`
  对 Worker runtime 不贴边，会把 `app-api` 拉回 Node server 心智
- `tRPC` 作为唯一 contract
  对内部 TS 项目可以工作，但不如显式 HTTP contract 稳定

### Toolchain

首选：`Wrangler`

原因：

- `app-api` 是 backend/API Worker，不是前端 HMR 优先的应用
- 当前仓库已有 `apps/public-entry-worker` 的 `wrangler + vitest + typescript` 基线
- 可以避免把 repo 拉成新的 Node workspace

包管理建议：

- `app-api` 自带局部 `package.json`
- 使用 `npm` 与 checked-in `package-lock.json`
- 不引入 repo 根级 `pnpm-workspace.yaml`

### Auth

首选：`Better Auth`

原因：

- 已有官方 Hono 集成
- 可以直接承接 public chat 的 session/auth truth
- 当前仓库历史参考里已经验证过 Better Auth 与产品边界的匹配度

MVP 约束：

- public user path 使用 Better Auth session
- protected panel path 不做 self-serve operator 用户系统
- operator 访问通过 protected surface 的 trusted identity bridge 进入 `app-api`
- `app-api` 在内部映射 operator principal，而不是再做第二套 panel 登录产品

### 数据访问

首选：`Drizzle ORM + drizzle-kit + pg + Hyperdrive`

原因：

- Cloudflare 官方 Hyperdrive 文档直接支持现有 PostgreSQL driver / ORM
- `pg` 已经在仓库历史 app 里使用过，迁移成本更低
- Drizzle 对 schema、migrations、typed query 足够克制，适合模块化单体

不选：

- D1
  当前 accepted direction 已经是 Postgres truth，而不是把 auth/chat/runtime 再拆到 D1
- Prisma
  在 Worker runtime 下并非最贴边选择，额外 runtime 负担也更高

### 请求校验与 API 文档

首选：

- `zod`
- `@hono/zod-openapi`

原因：

- 可以把 runtime validation、类型推断和 OpenAPI 收在同一层
- 比单独再引 `chanfana` 更贴合 Hono 主栈

### Worker 测试

首选：

- `vitest`
- `@cloudflare/vitest-pool-workers`

原因：

- 与现有 `apps/public-entry-worker` 一致
- 适合直接验证 bindings、middleware、route handlers 与 env wiring

## 推荐开源库清单

必须层：

- `hono`
- `zod`
- `@hono/zod-openapi`
- `better-auth`
- `drizzle-orm`
- `drizzle-kit`
- `pg`
- `jose`
- `vitest`
- `@cloudflare/vitest-pool-workers`
- `typescript`
- `wrangler`

可选增强层：

- `@hono/client`
  如果后续 web surfaces 需要 typed internal client
- `pino`
  如果后续需要更统一的结构化日志包装

当前不建议先引：

- `tRPC`
- `Prisma`
- `Durable Objects`
- 任何 panel-only admin framework

## 模块边界

推荐目录形态：

```text
apps/app-api/
├── package.json
├── package-lock.json
├── tsconfig.json
├── wrangler.jsonc
├── drizzle.config.ts
├── src/
│   ├── index.ts
│   ├── app.ts
│   ├── env.ts
│   ├── lib/
│   │   ├── db.ts
│   │   ├── auth.ts
│   │   ├── http-client.ts
│   │   └── tracing.ts
│   ├── modules/
│   │   ├── auth/
│   │   ├── chat/
│   │   ├── runtime-command/
│   │   ├── operator-query/
│   │   └── projection/
│   └── routes/
│       ├── auth.ts
│       ├── chat.ts
│       ├── operator.ts
│       └── system.ts
└── test/
```

模块职责固定为：

- `auth`
  Better Auth、session lookup、principal mapping
- `chat`
  conversation/message 读写与 ownership guard
- `runtime-command`
  chat submit、`request_execution` 写入、supervisor 调用
- `operator-query`
  request projection 列表/详情读取
- `projection`
  outbox 消费与 read model 物化

## API Surface

MVP 最小 API 面固定如下。

### System

- `GET /healthz`
- `GET /readyz`

### Auth

- `ALL /api/auth/*`
  Better Auth handler
- `GET /api/me`
  返回当前 principal 的最小投影

### Chat

- `GET /api/chat/conversations`
  当前用户的会话列表
- `POST /api/chat/conversations`
  创建空会话
- `GET /api/chat/conversations/:conversationId`
  返回单个会话及其消息
- `POST /api/chat/requests`
  提交一条 chat 请求并触发 execution path

`POST /api/chat/requests` 的最小入参应包含：

- `conversation_id` 或 `null`
- `message`
- `requested_scope`
- `client_request_id`

最小返回应包含：

- `conversation_id`
- `request_id`
- `assistant_message`
- `request_status`
- `trace_id`

### Operator

- `GET /api/operator/requests`
  panel 请求列表
- `GET /api/operator/requests/:requestId`
  panel 请求详情

第一版 panel 不做写操作 API。

## 数据模型

### `auth.*`

由 Better Auth 管理的最小表集：

- `user`
- `session`
- `account`
- `verification`

### `chat.*`

最小产品表：

- `chat.conversation`
  `conversation_id`, `owner_principal_id`, `title`, `status`, `created_at`, `updated_at`, `last_message_at`
- `chat.message`
  `message_id`, `conversation_id`, `author_kind`, `request_id`, `body`, `status`, `created_at`

### `runtime.*`

最小 command-side 事实表：

- `runtime.request_execution`
  `request_id`, `conversation_id`, `principal_id`, `requested_scope`, `route_target`, `status`, `trace_id`, `started_at`, `completed_at`, `error_code`, `citations_json`
- `runtime.projection_outbox`
  `outbox_id`, `request_id`, `event_type`, `payload_json`, `created_at`, `processed_at`

### `operator.*`

最小读模型：

- `operator.request_projection`
  `request_id`, `conversation_id`, `principal_id`, `requested_scope`, `route_target`, `status`, `started_at`, `completed_at`, `latency_ms`, `citation_count`, `error_code`, `last_projected_at`

固定规则：

- `chat.message` 不是 operator request truth
- `runtime.request_execution` 不是 panel 直接读取面
- `operator.request_projection` 是 panel canonical source

## 身份与权限模型

### Public chat

- 使用 Better Auth session
- `app-api` 负责读取 session 并映射为 app principal
- conversation ownership 在 `chat.*` 层执行

### Protected panel

- protected surface 先完成外层 Cloudflare-protected access
- `protected-panel-web` 将 trusted operator identity 投影给 `app-api`
- `app-api` 对 operator principal 做 allowlist / mapping
- MVP 不做 panel 自助注册、密码找回或单独 operator 用户系统

这条设计的重点是：

- panel 仍然有 app-level authz
- 但不为 2-3 个内部使用者再做一套独立 auth 产品

## 请求流

### Chat command path

1. `public-chat-web` same-site API seam 收到浏览器请求。
2. web surface 通过 Service Binding 调用 `app-api`。
3. `app-api` 完成 session / ownership 校验。
4. `app-api` 写入 `chat.message(user)`、`runtime.request_execution` 与 `runtime.projection_outbox(initial)`。
5. `app-api` 调用 `apps/supervisor-api`。
6. `app-api` 持久化 assistant message、execution result 与 completion outbox。
7. 响应返回浏览器。

### Operator query path

1. `protected-panel-web` same-site API seam 收到浏览器请求。
2. web surface 通过 Service Binding 调用 `app-api`。
3. `app-api` 验证 operator principal。
4. `app-api` 只读取 `operator.request_projection` 并返回结果。

## Projection 物化

MVP 接受 eventual consistency。

推荐顺序：

1. 第一版先在 `app-api` 内保留 outbox 表与 projector 模块。
2. 如果单请求内同步更新 projection 会让边界复杂化，则改为：
   - Cloudflare Queue consumer
   - 或 scheduled projector Worker

但无论采用哪种实现：

- projector 都属于 `app-api` boundary
- panel 查询都不能回放 answer execution
- 不新增 `operator-query-api`

## 与 Web Surfaces 的契约

`public-chat-web` / `protected-panel-web` 不直接复用 `packages/contracts`。

MVP 约束：

- browser-facing contract 保持在 TypeScript/HTTP 层
- web surfaces 作为同站点 adapter / facade
- 如果需要共享 typed client，优先使用 `@hono/client` 或单独的 TS schema 包
- 不要把 Python-side supervisor contract 污染到 browser product API

## 与 `supervisor-api` 的契约

`app-api -> supervisor-api` 保持显式内部 HTTP adapter。

最小出站请求需要携带：

- `request_id`
- `trace_id`
- `conversation_id`
- principal projection
- `requested_scope`
- user goal / user message

最小回包需要包含：

- `status`
- assistant answer 或 follow-up
- citations / source locators
- confidence / response metadata
- error payload when needed

当前不把这条链路改成 shared runtime 或 shared DB direct call。

## 实施波次

### Wave 0: Worker Scaffold

- 建立 `apps/app-api` Worker 工程
- 接入 `wrangler`, `typescript`, `vitest`
- 接入最小 `Hono` app、`/healthz`、`/readyz`

### Wave 1: DB And Auth Foundation

- 接入 Hyperdrive
- 接入 Drizzle 与 migrations
- 挂载 Better Auth
- 实现 `GET /api/me`

### Wave 2: Chat Product Truth

- 落 `chat.conversation`
- 落 `chat.message`
- 实现会话列表、创建、详情读取

### Wave 3: Runtime Command Path

- 落 `runtime.request_execution`
- 落 `runtime.projection_outbox`
- 实现 `POST /api/chat/requests`
- 打通 `app-api -> supervisor-api`

### Wave 4: Operator Read Path

- 落 `operator.request_projection`
- 实现 projector
- 实现 `GET /api/operator/requests` 与详情接口

### Wave 5: Web Surface Integration

- `public-chat-web` 接上 same-site chat API seam
- `protected-panel-web` 接上 same-site operator API seam
- 保持 web surface 仍然是薄 adapter

### Wave 6: Verification And Cutover

- Worker runtime tests
- auth/session smoke
- conversation ownership tests
- command/query separation smoke
- projection eventual-consistency smoke

## 验证门禁

完成后至少要满足：

- `app-api` 不直接吸收 supervisor orchestration
- browser 不直接调用 `apps/supervisor-api`
- `conversation/message` 与 operator request truth 仍然分离
- web surfaces 只做 same-site adapter，不长出产品后端
- Worker tests 能覆盖 auth、chat command、operator query 与 supervisor adapter

## 计划内验证命令

实现后应具备这些命令：

```bash
cd apps/app-api && npm test
cd apps/app-api && npm run typecheck
cd apps/app-api && npm run deploy -- --dry-run
```

仓库级回归仍保留：

```bash
uv run --all-packages python -m unittest discover -s tests -t .
```

## Deferred

以下内容明确延后：

- panel 写操作与审批流
- 流式回答与增量 token transport
- 多租户 / 多组织 auth 模型
- 对 operator principal 的完整 RBAC UI
- 将 `supervisor-api` 迁到 Worker runtime
