---
doc_type: architecture
status: active
created: 2026-03-28
updated: 2026-03-30
---

# Shared App API And Worker Web Surfaces

## 文档边界

这份文档冻结 public chat、protected panel 与 shared app/control-plane backend 的长期形态，不负责详细 UI、具体表结构、auth provider 选型细节或 panel 功能清单。

它补充但不替代以下文档：

- 长期 `apps/*` / `packages/*` 分层：`docs/architecture/long-term-architecture.md`
- `app-api` 自身 runtime 与内部边界：`docs/architecture/app-api-architecture.md`
- `app-api` 产品层 HTTP contract：`docs/contracts/app-api-http.md`
- `official_web` control-plane contract：`docs/contracts/app-api-official-web-http.md`
- `app-api` request lifecycle：`docs/contracts/app-api-request-lifecycle.md`
- `app-api` 数据模型：`docs/data/app-api-schema.md`
- `official_web` control-plane 架构：`docs/architecture/official-web-control-plane-on-app-api.md`
- supervisor 执行引擎边界：`docs/architecture/supervisor-architecture.md`
- protected surface trust model：`docs/architecture/protected-panel-boundary.md`
- Cloudflare delivery/topology：`docs/architecture/cloudflare-runtime-topology.md`

## 目标

这里要冻结的不是某个具体前端框架，而是产品表面与共享后端的 repo/runtime shape。

要回答的问题只有四个：

- public chat 与 protected panel 是否继续各自带一个独立 app backend
- auth / session / conversation 由哪一层拥有
- chat 请求 ingress、request ledger / projection input、`official_web` control plane、审计入口、指标记录与 panel 查询由谁承接
- `apps/supervisor-api` 在这套设计里退到什么边界

## 核心结论

长期形态固定为：

- `apps/public-chat-web`
  public chat 的 Worker 前端
- `apps/protected-panel-web`
  protected panel 的 Worker 前端
- `apps/app-api`
  shared application/control-plane backend，承接 auth/session/conversation、chat ingress、request ledger / projection input、selected operator control-plane surfaces 与 operator query；runtime 现已冻结为 internal Worker
- `apps/supervisor-api`
  answer execution engine，负责进入 `packages/supervisor-core -> specialist`

这意味着：

- chatbot 与 panel 不再各自维护独立产品后端
- `app-api` 是 shared application/control-plane backend，而不是 panel 专用 query backend
- `supervisor-api` 不再承担产品层 auth/session/conversation 或 panel list/detail 查询
- `app-api` runtime 不再保持未冻结状态

## Surface Topology

固定调用拓扑如下：

`browser -> public-chat-web -> app-api -> supervisor-api -> packages/supervisor-core -> specialist`

`browser -> protected-panel-web -> app-api -> request projection / operator read model`

`collector Docker -> app-api official_web APIs -> app-api ledger / outbox -> ingestion-worker`

关键约束：

- browser 不直打 `apps/supervisor-api`
- panel 不直连数据库
- public 与 protected 仍然是两个外部 surface
- `app-api` 可以是 shared internal backend，但不因此把 public/protected surface 合并成一个 exposure model

## Repo Shape

repo shape 固定为：

```text
apps/
├── public-chat-web
├── protected-panel-web
├── app-api
└── supervisor-api
```

当前仓库已经落地这组目录；`apps/public-consumer-chat` 仅作为 04.7 历史实现参考保留，不再承担 forward backend truth。

## Web Surface Responsibilities

### `apps/public-chat-web`

只负责：

- public chat UI
- public route shell
- same-site browser interaction seam
- 将 chat 请求交给 `app-api`

不负责：

- auth/session/conversation truth
- request ledger / request projection truth
- 直连 `supervisor-api`

### `apps/protected-panel-web`

只负责：

- protected panel UI
- protected route shell
- 将 operator 查询交给 `app-api`

不负责：

- request projection truth
- 直连数据库
- 直连 `supervisor-api`

## Shared App API Responsibilities

`apps/app-api` 是这套设计的共享应用中间层。

它负责：

- auth
- session
- principal mapping / actor handoff
- conversation / message persistence
- chat request ingress
- request correlation、audit ingress 与 metrics recording
- `runtime.request_execution` 与 `runtime.projection_outbox` 写入
- 调用 `apps/supervisor-api`
- panel 读取 request projection 的 API
- `official_web` collector admission、crawl-run ledger、artifact refs、handoff/outbox 与 operator query APIs
- 作为 internal Worker runtime 提供 shared app boundary

它不负责：

- supervisor routing / specialist orchestration 语义
- retrieval internals
- crawl execution
- ingestion execution
- panel UI
- public/protected browser shell

## `supervisor-api` 的新边界

在这套设计里，`apps/supervisor-api` 固定退为 execution engine：

- 接收来自 `app-api` 的受控执行请求
- 只做 internal caller admission，并消费 `app-api` 显式提供的 `actor`
- 进入 `packages/supervisor-core`
- 调用 specialist / retrieval
- 返回执行结果与最小执行元数据

它不再是：

- public chat 的产品后端
- panel 的查询后端
- auth/session/conversation 的 owner
- request projection list/detail API 的 owner

## App API 内部的读写分离

虽然 `app-api` 是共享 backend，但内部仍然必须保持 command/query 分离。

至少需要区分：

- chat command path
  接受用户请求、落盘、写 `request_execution` / `projection_outbox`、调用 execution engine
- operator query path
  只读取 `request_projection` / operator read model
- `official_web` control path
  接受 collector 上报、落盘 crawl-run truth、写 handoff/outbox，并提供 site/run/detail query surface

固定约束：

- panel 查询不能回放 answer execution
- conversation/message truth 不等于 operator request truth
- `request_execution`、projection outbox 与 `request_projection` 仍应逻辑分离

## Data Ownership

这套设计下的推荐关系型分域是：

- `app_auth.*`
  auth、session、account 相关 truth
- `chat.*`
  conversation、message 等 consumer product truth
- `official_web.*`
  crawl-run ledger、artifact refs、handoff/outbox 等 control-plane truth
- `runtime.*`
  request execution、projection input、审计入口相关 truth
- `operator.*`
  request projection 与 `official_web` site/run 等 panel-facing read model

数据库与 auth 的具体实现 baseline 现已收口为：

- 单个 Postgres 可以作为第一版共库
- Worker runtime 通过 Hyperdrive 访问数据库
- Better Auth runtime 位于 `apps/app-api`，repo-owned schema 固定为 `app_auth.*`
- Supabase platform `auth.*` 保持平台保留 schema，不再被 repo migration owner 接管
- `apps/app-api` 运行时统一消费 `app_auth.*`、`chat.*`、`runtime.*`、`operator.*`
- `apps/public-consumer-chat` 当前保留 `app_auth.*` / `chat.*` shared-db bootstrap 能力
- 在当前 Supabase session pooler 上，`app_auth.*` 通过数据库角色默认 `search_path` 收敛，而不是只依赖连接字符串 override
- `apps/app-api` Drizzle journal 当前只拥有 `runtime.*` / `operator.*` / `official_web.*`
- migration / schema management 使用 direct database management connection

这里冻结的只有一件事：

- auth/session/conversation 不再由 public chat app 自己单独持有
- 它们进入 shared `app-api` product boundary，但 bootstrap owner 必须显式写明

runtime 形态已不再 deferred：

- `apps/app-api` 固定为 internal Worker runtime
- 具体实现边界见 `docs/architecture/app-api-architecture.md`

`official_web` 的额外固定规则：

- collector command surface 不另建第二 backend
- `app-api` 只拥有 control-plane truth，不直接执行 offline ingestion
- `apps/ingestion-worker` 继续只是 execution plane

## Forbidden Shapes

以下形态不再接受：

- `public-consumer-chat` 继续作为独立 full-stack app backend
- `operator-query-api` 继续作为与 chat backend 并列的独立产品后端
- `official_web` 再造独立 crawler-intake backend
- browser 直接请求 `apps/supervisor-api`
- panel 直接查询数据库、audit log 或 telemetry sink
- 把 `app-api` 做成另一个 supervisor/orchestrator

## 当前实现状态

当前仓库已经落地的 canonical direction 为：

- `public-chat-web`
- `protected-panel-web`
- shared `app-api`
- `supervisor-api` execution engine

`apps/public-consumer-chat` 仍保留为历史实现参考，但它不再定义 forward product topology、backend ownership 或 panel/query boundary。

同时，`official_web -> app-api` control-plane ownership 不仅已经被接受并写入 canonical docs，也已在当前实现中落地到 shared `app-api` 与 `protected-panel-web` 的 runtime-owned surface。

详细 API contract、request lifecycle、error model 与数据表现已冻结在以下文档：

- `docs/contracts/app-api-http.md`
- `docs/contracts/app-api-official-web-http.md`
- `docs/contracts/app-api-request-lifecycle.md`
- `docs/contracts/app-api-error-model.md`
- `docs/data/app-api-schema.md`
