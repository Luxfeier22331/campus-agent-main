---
doc_type: plan
status: active
created: 2026-03-28
updated: 2026-03-28
---

# App API Worker Foundation 实施方案

**Goal:** 在不重开 `supervisor-api` / `packages/*` 边界的前提下，落地 `apps/app-api` 作为 Worker-native 的共享产品后端，承接 chat 与 panel 的产品层 API、auth/session、conversation、request ledger 与 operator read path。

**Architecture:** 本次实施固定采用 `public-chat-web/protected-panel-web -> app-api (Worker) -> supervisor-api (execution engine)`。`apps/app-api` 是 internal-only Worker runtime，内部采用模块化单体与 command/query 分离；它拥有产品层 auth/session/conversation、chat ingress、`request_execution` / `projection_outbox` 写入与 `request_projection` 读取，但不拥有 supervisor routing、specialist orchestration 或 retrieval internals。

**Tech Stack:** TypeScript, Cloudflare Workers, Wrangler, Hono, Zod, Better Auth, Drizzle ORM, `pg`, Hyperdrive for runtime DB access, direct management connection for migrations, Vitest, `@cloudflare/vitest-pool-workers`

## 目标

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
- `docs/contracts/app-api-http.md`
- `docs/contracts/app-api-supervisor-execution.md`
- `docs/contracts/app-api-request-lifecycle.md`
- `docs/contracts/app-api-error-model.md`
- `docs/data/app-api-schema.md`
- `docs/architecture/cloudflare-runtime-topology.md`
- `docs/architecture/supervisor-architecture.md`
- `docs/decisions/adr-0012-shared-app-api-and-worker-web-surfaces.md`
- `docs/decisions/adr-0013-app-api-worker-runtime.md`
- `docs/decisions/adr-0015-supervisor-internal-execution-admission.md`
- `docs/plans/app-api-initial-execution-plan.md`

## 职责闭包

`apps/app-api` 负责：

- public chat 用户认证与 session
- protected panel 的受控 operator principal 入口
- product-layer principal mapping，并向 execution engine 显式提供 `actor`
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

## 选型结论

- HTTP framework：`Hono`
- auth：`Better Auth`
- data access：`Drizzle ORM + pg + Hyperdrive`
- migration / schema management：direct database management connection
- validation / API schema：`zod` + `@hono/zod-openapi`
- Worker tests：`vitest` + `@cloudflare/vitest-pool-workers`

这些选型的共同目标是：贴合 Worker runtime、保持显式 HTTP seam，并避免把 `app-api` 误导成另一套 Node/Docker-first backend。

## 模块边界

推荐目录形态：

```text
apps/app-api/
├── src/
│   ├── modules/
│   │   ├── auth/
│   │   ├── chat/
│   │   ├── runtime-command/
│   │   ├── operator-query/
│   │   └── projection/
│   └── routes/
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

## Identity And Projection Rules

实现时必须同时满足：

- `app-api` 是唯一的 product-layer auth/session/principal owner
- `app-api -> supervisor-api` request body 显式携带 `actor`
- `apps/supervisor-api` 只做 internal caller admission，不再恢复最终业务 actor
- `runtime.request_execution` 与 `runtime.projection_outbox` 是 canonical durable truth
- queue 只能在同库 outbox 之后作为加速手段引入

## MVP API Surface

### System

- `GET /healthz`
- `GET /readyz`

### Auth

- `ALL /api/auth/*`
- `GET /api/me`

### Chat

- `GET /api/chat/conversations`
- `POST /api/chat/conversations`
- `GET /api/chat/conversations/:conversationId`
- `POST /api/chat/requests`

### Operator

- `GET /api/operator/requests`
- `GET /api/operator/requests/:requestId`

第一版 panel 不做写操作 API。

## 分波次实施

推荐顺序固定为：

1. 建立 `apps/app-api` Worker shell 与最小 health/readiness
2. 落地 auth/session/conversation 基线
3. 落地 chat command path 与 `app-api -> supervisor-api` adapter
4. 落地 `request_execution` / `projection_outbox`
5. 落地 `request_projection` 与 `GET /api/operator/requests*`
6. 在 `app-api` 稳定后，再并发接入 `public-chat-web` 与 `protected-panel-web`

前三步的逐步执行目标、验收和测试见：

- `docs/plans/app-api-initial-execution-plan.md`

对 panel 的直接含义：

- `Overview` 可以在 app-api 完整落地前先用 panel-local summary 起步
- `Requests` 必须等 `app-api` 的安全 query surface ready 后再解锁
- `Jobs` / `Operations` 仍然延后，不默认并入第一波产品范围

## 非目标

- 不让 panel 直连数据库或日志系统
- 不让 `supervisor-api` 顺手提供 panel list/detail API
- 不把 consumer conversation store 升格成 operator request truth
- 不为了 panel 再复制一套 backend

## 当前状态

当前仓库尚未正式落地 `apps/app-api` 目录。

但从这份方案开始，后续实现必须把以下内容视为 canonical truth：

- `app-api` 是 shared Worker backend
- `docs/contracts/` 与 `docs/data/` 已冻结第一版 API / lifecycle / schema
- `public-consumer-chat` 是历史参考，不是 forward backend truth
- `protected-panel-web` 是当前 protected panel web surface
- `supervisor-api` 保持 execution engine
