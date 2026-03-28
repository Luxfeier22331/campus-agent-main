---
doc_type: architecture
status: active
created: 2026-03-28
updated: 2026-03-29
---

# App API Architecture

## 文档边界

这份文档只冻结 `apps/app-api` 的 runtime 形态、内部边界与 command/query 分离约束，不负责详细表结构、具体 auth provider、UI 框架或 rollout 计划。

它补充但不替代以下文档：

- shared web surface 与 product topology：`docs/architecture/shared-app-api-and-worker-web-surfaces.md`
- 长期 `apps/*` / `packages/*` 边界：`docs/architecture/long-term-architecture.md`
- Cloudflare delivery/topology：`docs/architecture/cloudflare-runtime-topology.md`
- execution engine 边界：`docs/architecture/supervisor-architecture.md`
- identity / memory / personalization 边界：`docs/decisions/adr-0015-user-identity-memory-and-personalization-boundaries.md`
- request projection ownership：`docs/decisions/adr-0016-app-api-request-projection-and-panel-query-ownership.md`
- supervisor execution admission：`docs/decisions/adr-0017-supervisor-internal-execution-admission.md`
- `official_web` control-plane ownership：`docs/decisions/adr-0018-app-api-official-web-control-plane-ownership.md`
- 产品层 HTTP contract：`docs/contracts/app-api-http.md`
- `official_web` control-plane HTTP contract：`docs/contracts/app-api-official-web-http.md`
- execution contract：`docs/contracts/app-api-supervisor-execution.md`
- request lifecycle：`docs/contracts/app-api-request-lifecycle.md`
- 数据模型：`docs/data/app-api-schema.md`
- `official_web` 数据模型：`docs/data/app-api-official-web-schema.md`
- `official_web` control-plane 架构：`docs/architecture/official-web-control-plane-on-app-api.md`
- 详细 MVP API/data/implementation baseline：`docs/plans/app-api-worker-foundation.md`

## 目标

这里要回答的问题只有四个：

- `apps/app-api` 到底是不是单独的长期 app boundary
- 它的 runtime 是否继续保持未冻结
- 它内部应采用什么架构而不重新长出第二个 orchestrator
- 它与 `apps/supervisor-api`、panel read model、`official_web` control plane、auth/session/conversation/identity/memory truth 的关系如何固定

## 核心结论

`apps/app-api` 现在固定为：

- shared application/control-plane backend
- internal-only Cloudflare Worker runtime
- modular monolith
- internal CQRS boundary

这意味着：

- `app-api` 不再保持 runtime-agnostic
- `app-api` 不采用 Docker-first 或单独 VM-first 作为默认长期形态
- `app-api` 不是第二个 supervisor/orchestrator
- `app-api` 是 chat、panel 与选定 operator control surfaces 的共享 application/control-plane backend，而不是 panel 专用 query service

## Runtime Conclusion

`apps/app-api` 的 runtime 现在冻结为 Worker。

固定调用拓扑如下：

`browser -> public-chat-web (Worker) -> app-api (Worker) -> supervisor-api`

`browser -> protected-panel-web (Worker) -> app-api (Worker) -> request projection read model`

`collector Docker -> app-api official_web control plane -> app-api outbox / operator projections -> ingestion-worker`

这里冻结的约束是：

- `app-api` 默认不拥有 public hostname
- browser 不直接调用 `apps/supervisor-api`
- public/protected web surfaces 通过内部 Worker runtime seam 调用 `app-api`
- `app-api` 再通过受控内部 transport 调用 `apps/supervisor-api`

具体使用 Cloudflare Service Bindings、Hyperdrive、Queues、Cron 或其他 Worker-compatible substrate，属于实现细节；但长期 runtime 形态不再是“以后再决定”。

## Why Worker

选择 Worker runtime 的长期理由固定如下：

- public chat 与 protected panel 本身已经冻结为 Worker web surface
- shared `app-api` 与它们处于同一平台，更容易保持 internal-only service seam
- 不需要为一个服务 Worker web surfaces 与选定 control-plane seams 的共享后端再引入独立 Docker 运维面
- auth/session/chat ingress 这类 browser-facing API 更适合作为 edge-adjacent runtime 存在

这里冻结的是 runtime 形态，不是具体框架或库。

## Boundary Responsibilities

`apps/app-api` 负责：

- auth
- session
- principal mapping / actor handoff
- service-principal admission for declared control-plane surfaces
- account / identity projection
- profile memory
- conversation / message persistence
- explicit conversation draft create 与首轮 lazy create
- chat ingress
- request correlation
- request ledger / projection input 写入
- operator-facing read APIs
- `official_web` crawl-run admission、artifact refs 与 operator query surface
- 调用 `apps/supervisor-api`

`apps/app-api` 不负责：

- supervisor routing / delegation / response policy
- retrieval internals
- crawl execution
- ingestion execution
- panel UI
- public chat UI
- 把 `request_projection` 反向变成同步 answer execution 查询

## Internal Architecture

`app-api` 的推荐内部拆分固定为模块化单体，而不是多个产品后端：

- `auth`
  session、account、登录态与访问控制入口
- `profile`
  canonical identity 映射、profile memory 管理与 typed context projection
- `chat`
  conversation/message 等 consumer product truth
- `runtime-command`
  chat 请求进入、ledger/outbox 写入、execution request 发起
- `operator-query`
  request projection 的只读查询面
- `official-web-control`
  collector start / heartbeat / finalize、artifact refs、handoff/outbox 与 site/run operator projections
- `projection`
  outbox 消费与 read model 物化
- `integration`
  `app-api -> supervisor-api`、数据库、队列或其他外部依赖适配

这里冻结职责，不强制具体目录名。

## Official Web Control-Plane Extension

`official_web` 不会为 crawler 再新增一个平行 backend。

accepted direction 固定为：

- collector Docker 向 `apps/app-api` 上报 run lifecycle
- `app-api` durable 写入 crawl-run ledger、artifact refs 与 outbox
- `apps/ingestion-worker` 只消费 handoff，并执行 offline data-plane 工作
- `apps/protected-panel-web` 只通过 `app-api` 的 `official_web` query surface 查看 site/run/detail

这意味着：

- `app-api` 可以同时拥有 browser-facing product APIs 与 non-browser control-plane APIs
- 但它仍然不是 crawl executor，也不是 ingestion orchestrator

## Canonical Identity And Memory Ownership

长期上，`app-api` 是以下 truth 的 canonical owner：

- verified identity
- profile memory
- session / conversation truth

长期硬约束：

- Worker / edge admission 不是 canonical app identity truth
- `app-api` 必须把 runtime-boundary identity material 映射为最小化 actor claims
- `profile memory` 与 `session memory` 必须与 `verified identity` 区分语义，不得混成单一“memory blob”
- memory record 应至少具备 source、confidence、visibility、staleness / last-verified 语义

## Projection To Supervisor

`app-api -> supervisor-api` 默认只投影最小化 typed context，而不直传 raw product state。

长期允许的 projection 内容包括：

- stable actor id / principal id
- role / group / campus / cohort / major 等 typed claims
- profile memory summary
- session summary / confirmed slots
- correlation / trace metadata

长期默认不允许跨边界直传：

- raw JWT、raw auth header、raw cookie
- raw long-term memory 文本
- 未裁剪的完整 conversation transcript
- 产品层 provider payload

## Command / Query Split

虽然 `app-api` 是一个 shared backend，但内部必须保持 command/query 分离。

### Command path

chat command path 至少包含：

- session / ownership 校验
- conversation resolution 与首轮 lazy create
- user message 写入
- `runtime.request_execution` 写入
- `runtime.projection_outbox` 写入
- 向 `apps/supervisor-api` 发起受控执行请求
- 执行结果与最小运行元数据落盘

### Query path

operator query path 至少包含：

- 只读取 `operator.request_projection`
- 不回放 answer execution
- 不把 consumer conversation store 当 operator request truth
- 只接受 allowlisted operator identity 与匹配 internal shared secret 的受控 panel bridge，而不是裸信任 `x-app-operator-*` 头

## Data Ownership

`app-api` 下的推荐逻辑分域固定为：

- `auth.*`
- `profile.*`
- `chat.*`
- `official_web.*`
- `runtime.*`
- `operator.*`

第一版允许这些逻辑分域先共用一个关系数据库。

这里不冻结物理拆库，只冻结 ownership：

- 共库不等于共边界
- `verified identity` truth 不等于 `profile memory` truth
- `conversation/message` truth 不等于 operator request truth
- `official_web` crawl-run truth 不等于 ingestion worker 的内部 execution truth
- `request_execution`、projection outbox 与 read model 必须逻辑分离

## Background Processing Rule

如果 `request_projection` 需要异步物化，长期上也应保持在 `app-api` boundary 内解决。

接受的形态包括：

- `app-api` Worker 内的异步消费者
- Worker-compatible queue consumer
- Worker-compatible scheduled projector

但固定前提是：

- canonical truth 必须先落到同库 `runtime.request_execution` 与 `runtime.projection_outbox`
- queue 只能作为 outbox 之后的加速或 fan-out 手段
- projector failure 必须有 backoff / terminal-failure 语义，不能对坏事件无限热循环

不接受的形态包括：

- 为了 projector 重新长出一个新的产品后端
- 让 panel 在读取时临时拼 projection
- 让 `apps/supervisor-api` 顺手承担 panel list/detail API

## Forbidden Shapes

以下形态不再接受：

- `app-api` 继续保持 runtime 未冻结
- `app-api` 作为 Docker-first backend 成为默认长期形态
- `app-api` 吸收 supervisor orchestration 语义
- 为 `official_web` 再造第二个 crawler-intake backend
- Worker / edge identity 被直接当作 canonical actor truth
- browser 直接调用 `apps/supervisor-api`
- panel 直接查询数据库、audit sink 或 telemetry sink
- chat 与 panel 再次拆回两套独立产品后端

## 当前仓库状态

当前 `protected-panel-web` worktree 已经正式落地 `apps/app-api` 的完整 Worker foundation。

已落地的实现事实包括：

- internal Worker runtime、health/readiness 与 Hono 路由入口
- Better Auth、Drizzle schema / migration baseline 与 `GET /api/me`
- conversation list/detail/create 与首轮 lazy create 的 chat contract
- `POST /api/chat/requests`、`runtime.request_execution`、`runtime.projection_outbox`
- `request_projection` 与 `GET /api/operator/requests*`
- `public-chat-web` / `protected-panel-web` 对 shared `app-api` 的当前接线

同时，`develop` 长期集成线已经把 `ContextProjection` / `SupervisorResponse` 视为 shared seam。当前 worktree 在回 `develop` / `main` 时，必须继续保持这条 contract，不得把旧 `snapshot` 形态重新带回 merged truth。

以下内容仍然是 canonical truth：

- `apps/app-api` 是 Worker runtime
- `apps/public-consumer-chat` 只是历史实现参考
- `apps/protected-panel-web` 是当前受保护前端表面的 canonical app boundary
- `apps/supervisor-api` 保持 execution engine
- `official_web` control-plane ownership 已由 `app-api` 承接并完成首版 code path，包含 schema、collector command/query endpoints、operator projections 与 scheduled handoff dispatch

Python `campus_app_api` package 现在作为同目录下的 companion typed projection helper 保留；它补充 execution-side context projection，不改变 `apps/app-api` 已经是 shared Worker product backend 的事实。
