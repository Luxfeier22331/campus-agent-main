---
doc_type: architecture
status: active
created: 2026-03-28
updated: 2026-03-28
---

# Shared App API And Worker Web Surfaces

## 文档边界

这份文档冻结 public chat、protected panel 与 shared app backend 的长期形态，不负责详细 UI、具体表结构、auth provider 选型细节或 panel 功能清单。

它补充但不替代以下文档：

- 长期 `apps/*` / `packages/*` 分层：`docs/architecture/long-term-architecture.md`
- `app-api` 自身 runtime 与内部边界：`docs/architecture/app-api-architecture.md`
- supervisor 执行引擎边界：`docs/architecture/supervisor-architecture.md`
- protected surface trust model：`docs/architecture/protected-internal-panel-boundary.md`
- Cloudflare delivery/topology：`docs/architecture/cloudflare-runtime-topology.md`

## 目标

这里要冻结的不是某个具体前端框架，而是产品表面与共享后端的 repo/runtime shape。

要回答的问题只有四个：

- public chat 与 protected panel 是否继续各自带一个独立 app backend
- auth / session / conversation 由哪一层拥有
- chat 请求 ingress、审计、落盘、指标和 panel 查询由谁承接
- `apps/supervisor-api` 在这套设计里退到什么边界

## 核心结论

长期形态固定为：

- `apps/public-chat-web`
  public chat 的 Worker 前端
- `apps/protected-panel-web`
  protected panel 的 Worker 前端
- `apps/app-api`
  shared application backend，承接 auth/session/conversation、chat ingress 与 operator query；runtime 现已冻结为 internal Worker
- `apps/supervisor-api`
  answer execution engine，负责进入 `packages/supervisor-core -> specialist`

这意味着：

- chatbot 与 panel 不再各自维护独立产品后端
- `app-api` 是 shared app backend，而不是 panel 专用 query backend
- `supervisor-api` 不再承担产品层 auth/session/conversation 或 panel list/detail 查询
- `app-api` runtime 不再保持未冻结状态

## Surface Topology

固定调用拓扑如下：

`browser -> public-chat-web -> app-api -> supervisor-api -> packages/supervisor-core -> specialist`

`browser -> protected-panel-web -> app-api -> request projection / operator read model`

关键约束：

- browser 不直打 `apps/supervisor-api`
- panel 不直连数据库
- public 与 protected 仍然是两个外部 surface
- `app-api` 可以是 shared internal backend，但不因此把 public/protected surface 合并成一个 exposure model

## Repo Shape

未来 repo shape 固定为：

```text
apps/
├── public-chat-web
├── protected-panel-web
├── app-api
└── supervisor-api
```

这里冻结的是目标边界，不等于当前仓库已经完成目录迁移。

当前仓库中的 `apps/public-consumer-chat` 与 panel placeholder 可以作为历史实现参考，但不再是后续长期 shape 的 canonical truth。

## Web Surface Responsibilities

### `apps/public-chat-web`

只负责：

- public chat UI
- public route shell
- same-site browser interaction seam
- 将 chat 请求交给 `app-api`

不负责：

- auth/session/conversation truth
- request ledger / audit persistence
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
- conversation / message persistence
- chat request ingress
- request correlation / audit ingress / metrics recording
- request ledger 与 projection 输入写入
- 调用 `apps/supervisor-api`
- panel 读取 request projection 的 API
- 作为 internal Worker runtime 提供 shared app boundary

它不负责：

- supervisor routing / specialist orchestration 语义
- retrieval internals
- panel UI
- public/protected browser shell

## `supervisor-api` 的新边界

在这套设计里，`apps/supervisor-api` 固定退为 execution engine：

- 接收来自 `app-api` 的受控执行请求
- 进入 `packages/supervisor-core`
- 调用 specialist / retrieval
- 返回执行结果与最小执行元数据

它不再是：

- public chat 的产品后端
- panel 的查询后端
- auth/session/conversation 的 owner

## App API 内部的读写分离

虽然 `app-api` 是共享 backend，但内部仍然必须保持 command/query 分离。

至少需要区分：

- chat command path
  接受用户请求、落盘、记录指标、调用 execution engine
- operator query path
  只读取 request projection / operator read model

固定约束：

- panel 查询不能回放 answer execution
- conversation/message truth 不等于 operator request truth
- `request_execution`、projection outbox 与 `request_projection` 仍应逻辑分离

## Data Ownership

这套设计下的推荐关系型分域是：

- `auth.*`
  auth、session、account 相关 truth
- `chat.*`
  conversation、message 等 consumer product truth
- `runtime.*`
  request execution、projection input、审计入口相关 truth
- `operator.*`
  request projection 等 panel-facing read model

是否继续使用单个 Postgres、以及具体 auth provider / migration shape，留给后续详细设计。

这里冻结的只有一件事：

- auth/session/conversation 不再由 public chat app 自己单独持有
- 它们进入 shared `app-api` boundary

runtime 形态已不再 deferred：

- `apps/app-api` 固定为 internal Worker runtime
- 具体实现边界见 `docs/architecture/app-api-architecture.md`

## Forbidden Shapes

以下形态不再接受：

- `public-consumer-chat` 继续作为独立 full-stack app backend
- `operator-query-api` 继续作为与 chat backend 并列的独立产品后端
- browser 直接请求 `apps/supervisor-api`
- panel 直接查询数据库、audit log 或 telemetry sink
- 把 `app-api` 做成另一个 supervisor/orchestrator

## 当前实现状态

当前仓库已经存在的 `public-consumer-chat` 设计与实现，是前一版边界结论。

从这份文档开始，后续前台/后台实现的 canonical direction 改为：

- `public-chat-web`
- `protected-panel-web`
- shared `app-api`
- `supervisor-api` execution engine

详细 API contract、数据表、auth stack、frontend framework 和 migration sequence 留待后续设计讨论；`app-api` runtime freeze 见 `docs/decisions/adr-0013-app-api-worker-runtime.md`。
