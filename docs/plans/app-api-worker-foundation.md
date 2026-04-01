---
doc_type: plan
status: completed
created: 2026-03-28
updated: 2026-03-31
---

# App API Worker Foundation 实施方案

**Goal:** 在不重开 `supervisor-api` / `packages/*` 边界的前提下，落地 `apps/app-api` 作为 Worker-native 的共享产品后端，承接 chat 与 panel 的产品层 API、auth/session、conversation、request ledger 与 operator read path。

**Architecture:** 本次实施固定采用 `public-chat-web/protected-panel-web -> app-api (Worker) -> supervisor-api (execution engine)`。`apps/app-api` 是 internal-only Worker runtime，内部采用模块化单体与 command/query 分离；它拥有产品层 auth/session/conversation、chat ingress、`request_execution` / `projection_outbox` 写入与 `request_projection` 读取，但不拥有 supervisor routing、specialist orchestration 或 retrieval internals。

**Tech Stack:** TypeScript, Cloudflare Workers, Wrangler, Hono, Zod, Better Auth, Drizzle ORM, `pg`, Hyperdrive for runtime DB access, direct management connection for migrations, Vitest, `@cloudflare/vitest-pool-workers`

## 状态说明

这份文档描述的是 `apps/app-api` 的 forward implementation baseline，同时记录当前 merged truth 已经落地的 shared Worker foundation。

当前 repo merged truth 已经具备完整 Worker runtime、auth/chat/operator API、Drizzle schema、projection data plane 与 web-surface integration。`ContextProjection` / `SupervisorResponse` shared seam 已在当前实现中对齐；后续工作应继续保持这条 seam，不得把旧 `snapshot` 合约重新带回主线。

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
- `docs/contracts/app-api-http.md`
- `docs/contracts/app-api-supervisor-execution.md`
- `docs/contracts/app-api-request-lifecycle.md`
- `docs/contracts/app-api-error-model.md`
- `docs/data/app-api-schema.md`
- `docs/architecture/cloudflare-runtime-topology.md`
- `docs/architecture/supervisor-architecture.md`
- `docs/decisions/adr-0012-shared-app-api-and-worker-web-surfaces.md`
- `docs/decisions/adr-0013-app-api-worker-runtime.md`
- `docs/decisions/adr-0015-user-identity-memory-and-personalization-boundaries.md`
- `docs/decisions/adr-0016-app-api-request-projection-and-panel-query-ownership.md`
- `docs/decisions/adr-0017-supervisor-internal-execution-admission.md`
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

这些选型的共同目标是：贴合 Worker runtime、保持显式 HTTP seam，并通过 repo root `pnpm-workspace.yaml`、共享 `pnpm-lock.yaml` 与 `turbo.json` 统一 JS/TS 工作区编排，避免把 `app-api` 误导成另一套 Node/Docker-first backend。

## 模块边界

推荐目录形态：

```text
apps/app-api/
├── package.json
├── tsconfig.json
├── wrangler.jsonc
├── drizzle.config.ts
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

1. 建立 `apps/app-api` Worker shell 与最小 health/readiness（已完成）
2. 落地 auth/session/conversation 基线（已完成）
3. 落地 chat command path 与 `app-api -> supervisor-api` adapter（已完成）
4. 落地 `request_execution` / `projection_outbox`（已完成）
5. 落地 `request_projection` 与 `GET /api/operator/requests*`（已完成）
6. 在 `app-api` 稳定后，再并发接入 `public-chat-web` 与 `protected-panel-web`（已完成）

前三步的逐步执行目标、验收和测试见：

- `docs/plans/app-api-initial-execution-plan.md`

对 panel 的直接含义：

- `Overview` 已通过 panel-local summary 起步
- `Requests` 已随着 `app-api` 的安全 query surface 落地而解锁
- `Jobs` / `Operations` 仍然延后，不默认并入第一波产品范围

## 非目标

- 不让 panel 直连数据库或日志系统
- 不让 `supervisor-api` 顺手提供 panel list/detail API
- 不把 consumer conversation store 升格成 operator request truth
- 不为了 panel 再复制一套 backend

## 当前状态

当前仓库已经正式落地 `apps/app-api`，并且 shared Worker product topology 也已经接上 `public-chat-web` 与 `protected-panel-web`。

已完成的基础能力包括：

- `apps/app-api` Worker runtime、health/readiness、模块目录骨架
- Better Auth、Drizzle schema / migration baseline 与 `GET /api/me`
- `GET/POST /api/chat/conversations`、`GET /api/chat/conversations/:conversationId`
- `POST /api/chat/requests` 与显式 `app-api -> supervisor-api` execution adapter
- `runtime.request_execution`、`runtime.projection_outbox`、`request_projection` 与 `GET /api/operator/requests*`
- `public-chat-web` / `protected-panel-web` 对 shared `app-api` 的当前接线

这份 foundation plan 现在已经完成：MVP API surface 已补齐 conversation endpoints，并且 `POST /api/chat/requests` 也已收口为“可直接首轮 lazy create”的长期 contract。

后续工作不再属于 foundation 收口，而是建立在这套 shared Worker backend 基线之上的上层产品实现与增量能力扩展。

已落地实现现在应继续把以下内容视为 canonical truth：

- `app-api` 是 shared Worker backend
- `docs/contracts/` 与 `docs/data/` 已冻结第一版 API / lifecycle / schema
- `protected-panel-web` 是当前 protected panel web surface
- `supervisor-api` 保持 execution engine

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
cd apps/app-api && pnpm test
cd apps/app-api && pnpm run typecheck
cd apps/app-api && pnpm run deploy -- --dry-run
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
