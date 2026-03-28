---
doc_type: architecture
status: active
created: 2026-03-29
updated: 2026-03-29
---

# Official Web Control Plane On App API

## 文档边界

这份文档冻结 `official_web` source channel 采用 shared `apps/app-api` 作为 control-plane owner 的长期形态。

它回答的是：

- collector Docker 与 `app-api`、对象存储、`apps/ingestion-worker` 之间如何分层
- crawl run admission、artifact reporting、operator query 与 ingestion handoff 分别属于谁
- protected panel 应如何承接 `official_web` operator domain

它不负责：

- 单个站点的 host allowlist、robots、sitemap 与正文抽取算法
- collector 镜像内部的 Crawlee 代码结构
- object storage bucket 命名细则
- ingestion worker 内部如何把 source-truth 投影成 document/chunk/index

对应文档：

- `official_web` source-channel 总边界：`docs/architecture/official-web-source-channel.md`
- crawl policy：`docs/architecture/official-web-crawl-policy.md`
- source-truth contract：`docs/architecture/official-web-source-truth-contract.md`
- `app-api` runtime 与 ownership：`docs/architecture/app-api-architecture.md`
- shared web/control surfaces：`docs/architecture/shared-app-api-and-worker-web-surfaces.md`
- `official_web` HTTP seam：`docs/contracts/app-api-official-web-http.md`
- run lifecycle：`docs/contracts/app-api-official-web-run-lifecycle.md`
- logical schema：`docs/data/app-api-official-web-schema.md`

## 核心结论

`official_web` control plane 的 accepted topology 固定为：

`external scheduler -> collector Docker -> object storage + app-api official_web APIs -> app-api ledger/outbox/read model -> ingestion-worker -> document registry -> chunk/index`

这条链路里的角色固定如下：

- collector 负责 crawl / normalize / artifact upload / run reporting
- `apps/app-api` 负责 control-plane admission、durable run truth、artifact refs、outbox/queue handoff 与 operator query surface
- `apps/ingestion-worker` 负责 offline execution，不直接承担 collector-facing admission
- `apps/protected-panel-web` 只通过 runtime APIs 消费 `official_web` 的 site/run/detail 视图

## 为什么是 `app-api`

选择 `apps/app-api` 作为 owner 的长期理由固定如下：

- 它已经是 shared app-owned admission、ledger、outbox 与 operator read-model host
- `official_web` 需要的是 control plane，不是第二个 ingestion executor
- 这条链路与现有 `request_execution -> projection_outbox -> operator projection` 形态同构
- 复用同一个 control owner，可以避免为 crawler 再造一条平行 backend

这里冻结的是 ownership，不是实现必须采用哪一种队列或哪一种 Cloudflare 绑定。

## 固定系统形态

### Command Path

collector run 的 command path 固定为：

1. collector 通过 service credentials 调用 `app-api` start endpoint
2. `app-api` 为这次 run 分配 canonical `runId`
3. `app-api` durable 写入 crawl-run ledger 与第一条 outbox/event 事实
4. collector 在 run 期间上传 object-storage artifacts，并定期回传 heartbeat
5. collector finalize 后，`app-api` durable 写入 terminal state、artifact refs 与下游 handoff event
6. ingestion worker 消费 handoff event 并开始 offline projection/index 工作

### Query Path

operator query path 固定为：

`protected-panel-web -> Worker-local BFF -> app-api official_web APIs -> app-api owned run/site projections`

因此：

- panel 不得直读对象存储、队列、Qdrant、数据库或日志
- panel 不得把 `Jobs`/`Operations` 泛化成官方站点控制台的替代品
- `Official Web` 第一波页面只消费 app-owned site/run/detail projections

## 职责划分

### Collector Docker

collector 负责：

- 读取 repo-tracked site config、host policy、seed URLs 与可选凭证
- 维护 crawl frontier、节流、重试、canonical URL 计算与 parser 提取
- 上传 `capture/`、`provider/`、`source-truth/` 与 run artifacts 到对象存储
- 向 `app-api` 上报 run start、heartbeat、finalize 与失败摘要

collector 不负责：

- document registry 写入
- chunking / embedding / indexing
- Qdrant release 或 alias
- 决定某份 source-truth 进入哪些下游 collection / corpus

### `apps/app-api`

`app-api` 负责：

- collector-facing admission 与 service credential verification
- crawl-run canonical id 分配
- crawl-run ledger durable truth
- artifact reference registration
- outbox / queue handoff
- operator-facing site/run/detail APIs
- panel `Official Web` 的 runtime-owned query surface

`app-api` 不负责：

- 运行 crawler
- 执行 raw asset registration 与下游 projection
- 直接写 Qdrant、document registry 或 query-serving alias

### `apps/ingestion-worker`

`apps/ingestion-worker` 负责：

- 消费 `app-api` 发出的 `official_web` handoff event
- 从对象存储读取 run artifacts 与 source-truth
- 执行 raw-asset registration、projection、document/chunk/index 相关流程
- 回写必要的 execution status 到 app-owned projection 或其他声明过的 read model

`apps/ingestion-worker` 不负责：

- collector-facing run admission
- operator-facing site/run/detail HTTP APIs
- 面向 panel 的底层对象存储或队列浏览能力

### `apps/protected-panel-web`

panel 负责：

- 提供受保护的 `Official Web` operator UI
- 通过 Worker-local BFF 调用 `app-api` official_web APIs
- 呈现 sites、crawl runs、run detail、failures 与 artifacts

panel 不负责：

- 自己拼 run 状态
- 直读底层对象存储、日志、Qdrant、队列或数据库
- 成为通用 ops console

## 数据分层

`official_web` control plane 的 durable truth 固定分成三层：

- 对象存储 artifacts
  `capture/`、`provider/`、`source-truth/`、`crawl-run.json`、`host-summary.json`、`url-results.jsonl`、`failures.jsonl`
- `app-api` crawl-run ledger
  run state、artifact refs、heartbeat、handoff intent、operator query projection 的上游真相
- ingestion execution outputs
  raw asset registry、document registry、chunk/index 与 serving metadata

这里冻结的关键约束是：

- DB 只保存 control-plane truth 与 artifact refs，不保存整页快照或 chunk payload
- object storage 是 retained artifact truth，不是 panel 直接读取面
- ingestion execution outputs 继续属于 offline data plane，而不是 control-plane ledger

## 状态与时序

accepted run lifecycle 至少包含：

- `accepted`
- `running`
- `completed`
- `completed_with_errors`
- `failed`
- `abandoned`

补充约束：

- crawl-run terminal status 与 ingestion terminal status 必须区分
- run 完成不等于下游 ingestion 已完成
- panel 需要同时看到 crawl status 与 ingestion handoff/dispatch status，但两者不能混成一个状态字段

## 认证与信任边界

collector 与 panel 的 trust model 固定分开：

- collector 调用 `app-api` 使用 machine-to-machine service credentials
- operator 使用 protected panel 的 trusted identity bridge
- 两类调用共享同一个 `app-api` boundary，但不共享 principal model

因此：

- collector 不复用 end-user session
- operator 不直接持有 collector secrets
- `app-api` 必须显式区分 service principal 与 operator principal

## 第一波 panel 能力域

`Official Web` 第一波 operator surface 固定聚焦以下视图：

- `Overview`
  概览站点数量、最近 run、失败与 dispatch 摘要
- `Official Web / Sites`
  站点级摘要、最近成功/失败、当前配置版本
- `Official Web / Crawl Runs`
  run 列表、状态筛选、时间筛选、site 筛选
- `Run Detail`
  run 摘要、artifact refs、failure 摘要、dispatch 状态

第一波明确不做：

- object storage browser
- queue browser
- Qdrant browser
- generic `Jobs` / `Operations` 控制台
- 原始 HTML / provider payload 直接渲染

## 当前状态

当前冻结的是 accepted direction：

- `app-api` 作为 `official_web` control-plane owner 已接受
- 对应 docs/contracts/data/plan 需要作为后续实现基线

当前尚未自动意味着：

- collector command endpoints 已经在代码中落地
- `app-api` 已经拥有 `official_web.*` schema
- panel 已经上线 `Official Web` pages

## 非目标

- 不在本文定义某个站点的 crawl 策略细项
- 不在本文规定 collector 必须使用哪一个部署平台
- 不在本文让 `app-api` 接管 ingestion execution
- 不在本文授权 panel 直接消费底层基础设施
