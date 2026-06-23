---
doc_type: architecture
truth_scope: product
owner_boundary: app-api
status: active
created: 2026-04-02
updated: 2026-06-22
---
# Product Runtime Architecture

## 文档边界

本文冻结 `campus-web`、Operator Console、shared `app-api` 与 delivery/runtime seam 的
supporting architecture。

它回答的是：

- public/protected surface 如何接入 shared backend
- `apps/app-api` 的长期职责是什么
- request projection 与 operator read surface 属于谁
- Operator Console 的 trust model 与当前 runtime shells 应怎样理解

## 核心结论

产品/runtime 主链路固定为：

`browser -> campus-web -> student campus experience / account shell`

`campus-web same-origin allowlisted /api/* -> app-api`

`browser -> campus-web Q&A -> app-api durable chat lifecycle SSE
(/api/chat/requests/stream, /api/chat/runs/:runId/events/stream) ->
app-api chat conversation/run routes -> execution-control -> Temporal ->
workflow-worker / activity-worker-context / activity-worker-knowledge-plan /
activity-worker-knowledge-retrieval / activity-worker-knowledge-synthesis /
capability workers / activity-worker-finalization -> sanitized projection`

`browser -> campus-web /docs/* -> Rspress-powered canonical reader`

`browser -> operator-console-web explicit allowlist proxy -> app-api -> request
projection / operator read model / operator-safe operations domains`

这意味着：

- 当前已落地的 student-facing public surface 与 protected Operator Console 都在 shared
  `app-api` 前面；docs 已收口为 `campus-web /docs/*` 内部支撑面
- Worker surface 到 `app-api` 的长期调用形态是 Cloudflare Worker `APP_API` Service
  Binding；
  `APP_API_BASE_URL` / `OPERATOR_CONSOLE_APP_API_BASE_URL` 只是构造内部
  `Request` URL 的 origin
- `apps/campus-web` 是学生侧 product entry surface、account browser shell 与 docs
  browser route owner；它拥有 campus experience routes、账号浏览器页面、Rspress-powered
  `/docs/*` reader delivery、first-party Q&A assistant surface 与 same-origin app-api
  seam，但不拥有 backend truth
- `campus-web` Q&A 不再加载 ChatKit browser runtime；Q&A browser path 只消费
  durable chat lifecycle SSE、conversation read model 与明确 allowlisted support
  endpoints
- `apps/chatkit-adapter` 是 legacy internal ChatKit protocol adapter；当前
  `campus-web` 不消费它，它不拥有 product backend、conversation truth 或 execution
  engine 责任
- `apps/public-docs` 已删除；当前 docs browser surface 只由 `campus-web /docs/*`
  承担
- `apps/app-api` 是 shared product/control-plane backend
- `apps/app-api` 同时是 Identity Platform owner；Better Auth 只承担 credential/session
  runtime adapter role
- `apps/execution-control` 当前是 Docker-first internal execution engine；production
  target deployment substrate 已接受 Kubernetes + KEDA，但不改变 product/runtime owner
  boundary
- 长期 chat execution 不是 browser HTTP request 直挂 agent execution；`apps/app-api`
  应创建 / 查询 / 取消 durable run，并把 browser streaming 建模为 run event
  subscription
- Operator Console 不读数据库、不读 telemetry sink、不绕过 `app-api`
- ingestion/release task state machine 不属于 product runtime；它属于 offline data
  plane

补充结论：

- 当前 online answer surface posture 只表示学生侧 Q&A 当前开放的 capability set；它不等于
  整个产品的长期入口语义
- ordinary chat 的目标态 first decision 由 primary agent 在 admitted visible
  tool set 内完成；surface capability policy 仍由 shared `app-api` 表达，
  durable admission / projection 仍由 Execution Agent Layer 表达

## Accepted Surface Shape

产品/runtime supporting architecture 当前已经冻结到以下粒度：

- `campus-web`
  - 当前是 `campus.muc.wiki` student-facing product entry surface
  - 使用 Cloudflare Worker + Vite React SPA + TanStack Router
  - 为 `/`、`/c/:conversationId`、`/map`、`/dining`、`/feedback` 与
    `/account/*` 交付 SPA shell，并为 `/docs/*` 交付 Rspress-powered canonical reader
  - Q&A 主体验使用 first-party assistant chat surface，经由
    `/api/chat/requests/stream` 与 `/api/chat/runs/:runId/events/stream`
    进入 app-api/session gate 与 durable chat lifecycle stream
  - Q&A 主线程、composer 与会话历史 UI 由 `campus-web` 通过 assistant-ui
    primitives 承担；conversation truth、message truth、title truth、run truth 和
    execution truth 仍属于 `apps/app-api` / execution plane
  - account/auth UI 由 `better-auth-ui` 承接；通用控件使用 shadcn/Radix
    wrappers，表单状态与校验使用 `react-hook-form` + `zod`
  - map / dining 保留领域数据渲染、地图/楼层 adapter 与交互 glue；这些不是可替换的通用
    UI 产品组件，但其按钮、弹层、切换、搜索输入等通用 primitive 仍使用成熟组件库承接
  - 只通过 allowlisted same-origin app-api seams 消费 `/api/me/*`、必要 auth
    endpoints、implemented federation endpoints、durable chat lifecycle SSE、
    `/api/chat/conversations*`、`/api/docs/*` 与 campus experience endpoints
  - account browser shape 消费 Identity Platform product projection，不消费 Better Auth
    raw records
  - public production endpoint 固定为 `https://campus.muc.wiki`，staging endpoint 固定为
    `https://campus-staging.mucwiki-edge.link`
- `chatkit-adapter`（legacy）
  - internal protocol adapter for ChatKit custom server integration
  - maps ChatKit thread/item/action/event protocol to app-api conversation, message,
    run, feedback, cancel, and stream contracts
  - does not generate answers, own conversation truth, write DB rows, or call
    `apps/execution-control` directly
  - current `campus-web` allowlist does not expose `/api/chatkit`
- `Operator Console`
  - 长期是唯一受控 operator product concept，承接 read-only observability domains 与受控
    operations domains
  - 当前唯一 implementation surface 是 `operator-console-web`
  - 当前最小 implementation surface 只承载 `/requests` 与
    `/operations/provider-config`
  - 当前只通过 explicitly allowlisted request / runtime health / provider
    configuration routes 消费 `apps/app-api`
  - 通用控件使用 shadcn/Radix wrappers，配置表单使用 `react-hook-form` + `zod`，
    简单列表使用 shadcn-style table primitive；不维护第二套自研表单、select、button
    或 table widget
  - Official Web、Authenticated Notice、dining、Quality、Safety、Cost、standalone
    Audit 与离线 Eval 不是当前 `operator-console-web` 导航、路由或 proxy surface
  - `apps/app-api` 已有 `campus-services` operator routes，但当前
    `operator-console-web` 不承载校园服务校对与发布 workspace
  - 泛化 `Jobs` 不属于当前 Operator Console rollout；后台任务观察必须落到具体
    operator domain，不应被写成当前 merged truth
- `apps/app-api`
  - 已同时承担 product backend 与 selected operator control-plane backend
  - `official_web` control plane 已是 accepted runtime domain，不再是旁路后台
  - `official_web` control plane 不包括 release task claim / lease / retry /
    dead-letter / publish 状态机；这些状态属于 ingestion data plane
  - `authenticated_notice_processing` operator projection 已是 accepted app-owned
    Operator Console read-only domain；它只展示处理状态，不成为 collector scheduler、queue
    mutation API 或对象存储浏览器

前向约束：

- 未来可以继续增加 `服务状态`、`校园地图` 等并列 public surface
- 新增 surface 不得改写 shared `app-api` 的 auth / principal / request / operator
  ownership
- repo 级产品入口架构与某个 surface 自己的首页/导航信息架构必须分开表达

补充约束：

- 当前 merged truth 以 `docs/architecture/current-architecture.md` 为准
- release hardening supporting architecture 统一看
  `docs/architecture/system/runtime-delivery-and-release-hardening-architecture.md`
- staging runbook、Cloudflare Access 执行细节与 rollout closeout 证据统一看 runbooks 与
  `.planning/`

## Surface Responsibilities

### `apps/campus-web`

- student-facing campus UI and app grid
- conversation/map/dining/feedback browser shells
- assistant-ui-backed first-party assistant Q&A browser surface
- Rspress-powered `/docs/*` canonical reader delivery
- `/account/*` account browser shell, auth forms, password reset pages, federation
  consent/error pages
- same-origin allowlisted `/api/*` seam into `apps/app-api`
- no generic app-api proxy
- no auth/session/identity/federation backend ownership

### `apps/chatkit-adapter`（legacy）

- internal ChatKit custom server integration adapter for legacy Q&A experiments
- consumes signed app-api principal headers and calls app-api explicit chat routes
- maps ChatKit history, item, feedback, retry, cancel, and stream semantics to app-api
  contracts
- does not own account/session, conversation truth, execution truth, database writes,
  provider calls, or direct execution-control transport
- current `campus-web` does not consume this adapter

### Operator Console implementation surfaces

- `apps/operator-console-web` 是当前唯一 Operator Console Worker shell
- 当前 shell 只承载请求与运行值班台、模型服务配置两个最小上线 workflow
- 该 shell 只消费 `apps/app-api` runtime-owned APIs
- fail-closed by default
- 不导入 `packages/*`，不把自己做成 `apps/execution-control` 的 hidden admin mode，
  也不定义第二套 operator backend

### `apps/app-api`

- auth / session / principal mapping
- Identity Platform account / identity / access / preferences / federation
  policy boundary
- surface capability policy
- conversation 与 chat ingress
- durable run creation / status / cancel / stream proxy 的 product-layer
  command / query surface
- `runtime.request_execution`
- `runtime.projection_outbox`
- `operator.request_projection`
- selected operator control-plane domains，例如 `official_web`
- selected operator-safe processing projections，例如
  `authenticated_notice_processing`
- `official_web` 中只拥有 collector command ingress、operator-safe projection/query 与
  stable-reference approve/reject ledger；不拥有 selected-write admission/task
  truth、
  executor read route 或 executor callback route
- route exposure inventory 必须显式区分 `browser-surface`、`operator-via-panel`、
  `machine-internal`、`collector-machine` 与 `system`；新增 route 时必须同步 caller
  class 与 admission rule
- `api-staging.mucwiki-edge.link` 如存在，只能作为 staging machine / ops ingress
  与 readiness/smoke 入口，不是 browser product contract

## Surface Capability Policy

surface capability policy 的长期 owner 固定为 `apps/app-api`。

直接含义：

- `campus-web` Q&A 的 capability set 是 current surface posture
- `campus-web /docs/*` 是非执行 reader surface，不自动进入 capability routing
- future `服务状态`、`校园地图` 等 surface 可以开放不同 capability set
- `apps/execution-control` 不拥有 browser-facing capability allowlist truth

固定规则：

- 不把某个 surface 当前开放的 capability 直接写成整个 repo 的长期入口原则
- surface policy 先于 primary agent tool decision
- `app-api` 负责把 surface policy、account / session projection 与 request truth 组装为最小
  execution input
- `app-api` 不选择 product persona、surface prompt profile 或 agent instructions；
  first Execution Agent decision 由 primary agent runtime 在 `execution-control`
  裁剪后的 visible tool set 内完成

### `apps/execution-control`

- internal execution admission
- typed execution transport
- 当前 forward deploy substrate 是 Docker-first internal execution service；production
  target deploy substrate 是 Kubernetes internal execution-control Service + KEDA/HPA
  worker autoscaling
- Docker-side Go `execution-control` 承担 execution-level backpressure、timeout、readiness、
  bridge circuit breaker、metrics 与 graceful drain；它不拥有 product-level 用户限流或
  browser-facing capability policy
- 长期上，production run admission 与 workflow/activity dispatch 必须落在
  `execution-control` + Temporal execution plane；当前 Go 进程内 admission 只表达
  single-process protection
- 不承担 browser-facing product backend 责任

## App-api / Ingestion Boundary

产品 runtime 与 offline data plane 的分界固定为：

`app-api operator/collector control plane -> ingestion-control release task runtime`

固定规则：

- `apps/app-api` 可以接收 collector lifecycle command、维护 crawl-run ledger、物化
  operator-safe projections，并记录 stable-reference release gate approve/reject
  ledger
- `apps/app-api` 不提供 official-web release executor read/callback routes
- `apps/app-api` 不保存 contact/service selected-write admission 或 task truth
- `apps/ingestion-control` 定义并执行 release task lifecycle，负责 claim、lease、
  retry、dead-letter、materialize、publish 与失败状态
- `packages/ingestion-core` 保留 canonical data-plane contract 与 collection strategy
- Operator Console 不调用 release task mutation；它只展示 app-api/operator projection 或未来
  ingestion 投影后的 read model

### Docker Execution Runtime Boundary

当前 Docker execution runtime 拆成：

- `apps/execution-control`
  - 当前 execution ingress
  - 当前 active chat execution path 已硬切到 Temporal-backed
    `CapabilityExecutionWorkflow`；run store、events 与 step ledger 是 app-api /
    Operator Console / eval 消费的 sanitized projection store
  - online RAG 由 Go-owned `memory.recall` + RAG Temporal activity graph 执行，不经过 Python
    bridge
  - 进程内 lifecycle、active count 与 bounded queue 只保留为本进程 runtime protection；
    canonical execution truth 在 Temporal workflow / task queue 中；旧 PG lease store
    只保留为 historical migration artifact
- Retired Python semantic bridge code
  - 已从 active workspace 删除，只可通过 git history 追溯
  - 不参与 online answer serving、staging readiness 或 active product runtime
  - 不拥有 public execution ingress、caller auth、transport admission、provider hot path
    或 RAG step projection truth

长期边界固定为：

- `apps/app-api` 仍拥有 product-layer auth/session/principal、surface capability
  policy、conversation、request projection 与 operator read model
- `apps/app-api` 拥有 browser-facing run command / query / stream proxy；streaming
  是 run event subscription，不是 execution ownership
- Go execution runtime 不能反向拥有 browser-facing capability allowlist、用户级限流、
  duplicate-click UX、conversation truth 或 operator control plane
- 长期 `execution-control` 拥有 workflow command/query、admission、execution
  budget projection 与 finalization；Temporal 拥有 workflow history、task queue、
  retry、timeout 与 worker dispatch。process-local limiter 只能作为本进程 protection
- Go runtime 可以继续吸收 deterministic execution runtime kernel，但不能因此把
  semantic orchestration、explicit agent-as-tool reasoning 或 retrieval planning
  塞进 `apps/*`

## Operator Projection And Read Model

request projection 的 canonical durable truth 固定为：

- `runtime.request_execution`
- `runtime.projection_outbox`

Operator Console `Requests` 的 canonical read path 固定为：

`operator console surface -> apps/app-api -> operator.request_projection`

明确禁止：

- 直接读取 consumer chat tables 作为 request list/detail truth
- 直接读取 audit logs 或 telemetry sink 作为 request truth
- 让 Operator Console 通过 `apps/execution-control` 旁路获取 operator list/detail

future operator-facing observability 域也遵循同一 ownership rule：

- audit / quality / safety / cost surface 仍由 `apps/app-api` 物化与提供
- authenticated notice processing 这类 ingestion/downstream visibility surface
  也必须经
  `apps/app-api` 的 operator-safe projection 暴露，不能让 Operator Console 回读 queue、object-store、
  operations 目录或 raw logs
- Operator Console 只能读取 runtime-owned projection / aggregate APIs
- `Sentry`、`Axiom` 与其他 sink 继续只是 debugging / analysis / grading surface，不反向成为
  canonical Operator Console read model
- Temporal task queue snapshot、worker autoscaler decision / actuation 也属于
  operator runtime projection。当前 Docker Compose autoscaler 只能通过 app-api
  internal HTTP 发布 sanitized payload；production target 下 KEDA/HPA scale event 也必须
  先物化为 app-api operator-safe projection。Operator Console 和 eval 不直接读取
  Temporal history、Docker state、Kubernetes API、HPA/KEDA API 或 execution-control
  本地证据文件

更完整的 operator observability supporting architecture 不在本文展开，统一看
`docs/architecture/system/operator-observability-architecture.md`。

## Operator Console Access

Operator Console 的长期 access model 固定为：

`approved operator principal -> upstream protected access -> origin admission ->
minimal operator context -> runtime APIs`

关键约束：

- Operator Console 不需要自建 end-user 账户系统
- upstream access 不能替代 origin admission
- dynamic shell/API responses 默认 `no-store`
- 失去保护条件时直接 fail-closed

## Public Auth Runtime And Abuse Control

public auth family 的 runtime/product posture 固定为：

- `campus-web` 拥有 `/account/login`、`/account/register`、`/account/forgot-password`、
  `/account/reset-password` 这组 public account browser shell
- `app-api` 通过现有 auth provider / plugin 拥有最终 auth admission 与 server-side
  verification
- auth family 的 human verification transport 固定走 same-origin `campus-web ->
  /api/auth/* -> app-api`

长期 abuse-control 规则固定为：

- `sign-in`、`sign-up`、`request-password-reset` 采用 always-on verification
- `reset-password` token consumption 继续保持 fixed same-site token flow，不额外叠第二层
  challenge
- interactive challenge escalation 固定由 Cloudflare managed/adaptive posture
  决定，不引入 repo-owned “只有遇到攻击才手动打开 challenge” 开关
- public auth shell 必须保留显式 runtime config seam，允许在不分叉 auth flow 逻辑的前提下配置
  Turnstile widget posture

环境 posture 固定为：

- `local`
  - 允许使用 Turnstile testing credentials 做 dev / smoke
- `staging`
  - 必须使用真实、hostname-admitted widget credentials
  - 默认允许保持低摩擦 operator smoke posture，但不能改写 always-on verification truth
- `production`
  - 默认采用 Cloudflare `Managed` posture；仅在 risk elevated 时自适应提升到交互 challenge

这里的环境差异只影响 widget posture 与 delivery/runtime 配置，不允许分叉 auth owner、same-site
contract 或 auth family route/endpoint truth。

## Runtime / Delivery Posture

- shared `apps/app-api` runtime 已冻结为 Worker
- public/protected browser surface 可以是独立 Worker web surface
- public 与 protected surface 即使共享基础设施，也不合并成一个 exposure model 或 rollback unit
- `apps/execution-control` 当前部署 substrate 是 Docker-first internal execution service；
  production target substrate 是 Kubernetes + KEDA，详见
  `kubernetes-execution-runtime-architecture.md`
- execution public ingress 已 hardcut 到 Go `apps/execution-control`；retired Python
  semantic bridge code 已从 active workspace 删除，只可通过 git history 追溯，不参与
  online answer hot path

## Forbidden Shapes

- 不把 `apps/app-api` 重新拆回 consumer backend + operator backend
- 不把 `apps/execution-control` 重新长成 product backend
- 不把 Operator Console 做成直接连 `packages/*` 或数据库的内部控制台
- 不把 request projection 退化成 chat transcript 或 telemetry replay 的别名

## 相关稳定文档

- `docs/contracts/app-api-http.md`
- `docs/contracts/app-api-operator-observability-http.md`
- `docs/contracts/app-api-request-lifecycle.md`
- `docs/contracts/capability-execution.md`
- `docs/architecture/system/capability-routing-and-admission-architecture.md`
- `docs/data/app-api-schema.md`
- `docs/decisions/adr-0011-operator-console-worker-runtime.md`
- `docs/decisions/adr-0012-shared-app-api-and-worker-web-surfaces.md`
- `docs/decisions/adr-0013-app-api-worker-runtime.md`
- `docs/decisions/adr-0016-app-api-request-projection-and-operator-console-query-ownership.
  md`
- `docs/decisions/adr-0045-identity-platform-and-auth-runtime-boundary.md`
- `docs/architecture/system/identity-platform-architecture.md`
- `docs/architecture/system/identity-browser-experience-architecture.md`
- `docs/architecture/system/federation-and-mucwiki-login-architecture.md`
- `docs/decisions/adr-0017-supervisor-internal-execution-admission.md`
- `docs/decisions/adr-0056-kubernetes-keda-execution-runtime.md`
- `docs/decisions/adr-0023-operator-observability-control-plane-and-sink-partici
  pation.md`
- `docs/architecture/system/operator-observability-architecture.md`
- `docs/architecture/system/runtime-delivery-and-release-hardening-architecture.md`
