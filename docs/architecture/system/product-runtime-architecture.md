---
doc_type: architecture
status: active
created: 2026-04-02
updated: 2026-06-06
---
# Product Runtime Architecture

## 文档边界

本文冻结 public chat、protected panel、shared `app-api` 与 delivery/runtime seam 的
supporting architecture。

它回答的是：

- public/protected surface 如何接入 shared backend
- `apps/app-api` 的长期职责是什么
- request projection 与 operator read surface 属于谁
- protected panel 的 trust model 与 runtime shell 应怎样理解

## 核心结论

产品/runtime 主链路固定为：

`browser -> hub-web -> app launcher / account shell`

`hub-web same-site allowlisted /api/* -> app-api`

`browser -> public-chat-web -> app-api -> execution-control -> Temporal -> activity
worker -> supervisor-agent-worker private bridge`

`browser -> public-docs static reader assets`

`browser -> public-docs same-site /api/docs/* -> app-api`

`browser -> protected-panel-web -> app-api -> request projection / operator read
model`

这意味着：

- 当前已落地的 public/protected/docs surface 是 shared `app-api` 前面的并列 browser surface
- Worker surface 到 `app-api` 的长期调用形态是 Cloudflare Worker `APP_API` Service Binding；
  `APP_API_BASE_URL` / `PANEL_RUNTIME_API_BASE_URL` 只是构造内部 `Request` URL 的 origin
- `apps/hub-web` 是 app-set product entry surface；它拥有平面入口、launcher registry 与 account
  browser shell，但不拥有 backend truth
- `apps/public-chat-web` 与 `apps/public-docs` 都是 public-facing surface，但它们的内部 IA
  不自动升级成整个产品的顶层 IA
- `apps/public-docs` 是独立 docs-first browser surface
- `apps/app-api` 是 shared product/control-plane backend
- `apps/execution-control` 是 Docker-first internal execution engine
- 长期 chat execution 不是 browser HTTP request 直挂 agent execution；`apps/app-api`
  应创建 / 查询 / 取消 durable run，并把 browser streaming 建模为 run event
  subscription
- panel 不读数据库、不读 telemetry sink、不绕过 `app-api`
- ingestion/release task state machine 不属于 product runtime；它属于 offline data
  plane

补充结论：

- 当前 `public chat` 的 knowledge-only posture 只表示该 surface 当前开放的 capability set
- 它不等于整个产品的长期入口语义
- capability-neutral routing 与 surface capability policy 统一由 shared
  product/runtime + supervisor supporting architecture 表达

## Accepted Surface Shape

产品/runtime supporting architecture 当前已经冻结到以下粒度：

- `public-chat-web`
  - 当前是最成熟的公开助理入口，不再以旧 `public-consumer-chat` 为 forward truth
- `hub-web`
  - 当前是 `hub.muc.wiki` app-set entry surface
  - 使用 Cloudflare Worker + Vite React SPA + TanStack Router
  - 只为 `/` 与 `/account/*` 这类 hub-owned shell path 交付 SPA shell
  - sibling app 入口通过 launcher registry 的 `app_link` / `planned` / `external`
    target 表达，不在 hub 内创建 fake browser route shell
  - 只通过 allowlisted same-site app-api seams 消费 `/api/me` 与必要 auth endpoints
  - legacy Wiki 只作为 external-link card 指向 `https://muc.wiki`
- `public-docs`
  - 已是正式公开文档站 app；当前 docs shell 已落地，并通过 Worker `APP_API` Service
    Binding 消费 shared app-api 的 same-site `/api/docs/*` control-plane
  - 只代理 docs control-plane endpoints，不作为 public chat、operator 或 generic
    app-api BFF
- `protected-panel-web`
  - 当前只承接 app-owned operator domains；`Requests`、`Official Web` 与
    `Authenticated Notice Processing` 已是 accepted shape
  - `Jobs`、`Operations`、更完整 `Audit` 仍属于后续 rollout，不应被写成当前 merged truth
- `apps/app-api`
  - 已同时承担 product backend 与 selected operator control-plane backend
  - `official_web` control plane 已是 accepted runtime domain，不再是旁路后台
  - `official_web` control plane 不包括 release task claim / lease / retry /
    dead-letter / publish 状态机；这些状态属于 ingestion data plane
  - `authenticated_notice_processing` operator projection 已是 accepted app-owned
    read-only panel domain；它只展示处理状态，不成为 collector scheduler、queue
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

### `apps/public-chat-web`

- public chat UI
- same-site `/api/*` seam into `apps/app-api`
- chat-local auth browser routes are bounded compatibility redirects/shims to
  hub account routes with explicit `return_to`
- does not own account-shell UI, captcha widget runtime, or password-reset form
- browser auth handoff is
  `public-chat-web compat route -> hub-web /account/* -> /api/auth/* -> app-api`
- 不拥有 auth/session/conversation truth

### `apps/hub-web`

- flat app launcher for `hub.muc.wiki`
- single launcher registry with `internal` / `app_link` / `planned` / `external`
  target kinds
- account shell routes:
  - `/account`
  - `/account/login`
  - `/account/register`
  - `/account/forgot-password`
  - `/account/reset-password`
- same-site allowlisted auth and `/api/me` seams into `apps/app-api` via Worker
  Service Binding
- fail-closed unknown browser path handling, including sibling app slugs that are
  not hub-owned shell paths
- no generic app-api proxy
- no MediaWiki page/content/upload proxy
- no auth/session/principal backend ownership

### `apps/public-docs`

- public docs reader UI
- static reader asset delivery via Worker `ASSETS`
- same-site `/api/docs/*` seam into `apps/app-api` via Worker Service Binding
- 不拥有 auth/session/principal truth、docs visibility truth 或 generic app-api proxy

### `apps/protected-panel-web`

- protected operator UI shell
- 只消费 runtime APIs
- fail-closed by default
- 不导入 `packages/*`，不把自己做成 `apps/execution-control` 的 hidden admin mode

### `apps/app-api`

- auth / session / principal mapping
- surface capability policy
- conversation 与 chat ingress
- durable run creation / status / cancel / stream proxy 的 product-layer
  command / query surface
- `runtime.request_execution`
- `runtime.projection_outbox`
- `operator.request_projection`
- selected operator control-plane domains，例如 `official_web`
- selected operator-safe processing projections，例如 `authenticated_notice_processing`
- `official_web` 中只拥有 collector command ingress、operator-safe projection/query 与
  stable-reference approve/reject ledger；不拥有 selected-write admission/task truth、
  executor read route 或 executor callback route
- route exposure inventory 必须显式区分 `browser-surface`、`operator-via-panel`、
  `machine-internal`、`collector-machine` 与 `system`；新增 route 时必须同步 caller
  class 与 admission rule
- `api-staging.mucwiki-edge.link` 如存在，只能作为 staging machine / ops ingress
  与 readiness/smoke 入口，不是 browser product contract

## Surface Capability Policy

surface capability policy 的长期 owner 固定为 `apps/app-api`。

直接含义：

- `public-chat-web` 当前只开放 `knowledge`，是 current surface posture
- `public-docs` 是非执行 surface，不自动进入 capability routing
- future `服务状态`、`校园地图` 等 surface 可以开放不同 capability set
- `apps/execution-control` 不拥有 browser-facing capability allowlist truth

固定规则：

- 不把某个 surface 当前开放的 capability 直接写成整个 repo 的长期入口原则
- surface policy 先于 execution routing
- `app-api` 负责把 surface policy、identity / authz projection 与 request truth 组装为最小
  execution input

### `apps/execution-control`

- internal execution admission
- typed execution transport
- forward deploy substrate 已冻结为 Docker-first internal execution service
- Docker-side Go `execution-control` 承担 execution-level backpressure、timeout、readiness、
  bridge circuit breaker、metrics 与 graceful drain；它不拥有 product-level 用户限流或
  browser-facing capability policy
- 长期上，production run admission 与 workflow/activity dispatch 必须落在
  `execution-control` + Temporal execution plane；当前 Go 进程内 admission 只表达
  single-process protection
- 不承担 browser-facing product backend 责任

## App-api / Ingestion Boundary

产品 runtime 与 offline data plane 的分界固定为：

`app-api operator/collector control plane -> ingestion-worker release task runtime`

固定规则：

- `apps/app-api` 可以接收 collector lifecycle command、维护 crawl-run ledger、物化
  operator-safe projections，并记录 stable-reference release gate approve/reject ledger
- `apps/app-api` 不提供 official-web release executor read/callback routes
- `apps/app-api` 不保存 contact/service selected-write admission 或 task truth
- `packages/ingestion-core` 定义 release task contract 与状态推进
- `apps/ingestion-worker` 执行 release task，负责 claim、lease、retry、
  dead-letter、materialize、publish 与失败状态
- `apps/protected-panel-web` 不调用 release task mutation；它只展示 app-api/operator
  projection 或未来 ingestion 投影后的 read model

### Docker Execution Runtime Boundary

当前 Docker execution runtime 拆成：

- `apps/execution-control`
  - 当前 execution ingress
  - 当前 active chat execution path 已硬切到 Temporal-backed
    `ChatAnswerWorkflow`；run store、events 与 step ledger 是 app-api / panel /
    eval 消费的 sanitized projection store
  - 进程内 lifecycle、active count 与 bounded queue 只保留为本进程 runtime protection；
    canonical execution truth 在 Temporal workflow / task queue 中；旧 PG lease store
    只保留为 historical migration artifact
- Python `apps/supervisor-agent-worker`
  - current private semantic bridge worker, not the long-term online hot path target
  - 负责消费 Go 已投影的 private bridge request，并通过 worker 内部
    agent dispatcher 调用 agent
  - 负责在 semantic orchestration checkpoints 观测 Go 投递的 cooperative cancel
  - 不再拥有 public execution ingress、caller auth 或 transport admission

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
  semantic orchestration、domain-agent reasoning 或 retrieval planning 塞进 `apps/*`

## Operator Projection And Read Model

request projection 的 canonical durable truth 固定为：

- `runtime.request_execution`
- `runtime.projection_outbox`

panel `Requests` 的 canonical read path 固定为：

`apps/protected-panel-web -> apps/app-api -> operator.request_projection`

明确禁止：

- 直接读取 consumer chat tables 作为 request list/detail truth
- 直接读取 audit logs 或 telemetry sink 作为 request truth
- 让 panel 通过 `apps/execution-control` 旁路获取 operator list/detail

future operator-facing observability 域也遵循同一 ownership rule：

- audit / quality / safety / cost surface 仍由 `apps/app-api` 物化与提供
- authenticated notice processing 这类 ingestion/downstream visibility surface 也必须经
  `apps/app-api` 的 operator-safe projection 暴露，不能让 panel 回读 queue、object-store、
  operations 目录或 raw logs
- panel 只能读取 runtime-owned projection / aggregate APIs
- `Sentry`、`Axiom` 与其他 sink 继续只是 debugging / analysis / grading surface，不反向成为
  canonical panel read model

更完整的 operator observability supporting architecture 不在本文展开，统一看
`docs/architecture/system/operator-observability-architecture.md`。

## Protected Surface And Operator Access

protected panel 的长期 access model 固定为：

`approved operator principal -> upstream protected access -> origin admission ->
minimal operator context -> runtime APIs`

关键约束：

- protected panel 不需要自建 end-user 账户系统
- upstream access 不能替代 origin admission
- dynamic shell/API responses 默认 `no-store`
- 失去保护条件时直接 fail-closed

## Public Auth Runtime And Abuse Control

public auth family 的 runtime/product posture 固定为：

- `hub-web` 拥有 `/account/login`、`/account/register`、`/account/forgot-password`、
  `/account/reset-password` 这组 public account browser shell
- `public-chat-web` 的 `/login`、`/register`、`/forgot-password`、`/reset-password`
  只保留为 bounded compatibility redirects/shims，不再定义 account shell ownership
- `app-api` 通过现有 auth provider / plugin 拥有最终 auth admission 与 server-side
  verification
- auth family 的 human verification transport 固定走 same-site `hub-web ->
  /api/auth/* -> app-api`
- `public-chat-web` 不再注入 Turnstile runtime config，也不再持有 auth-page
  staging/live-smoke posture

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
- `apps/execution-control` 的部署 substrate 已冻结为 Docker-first internal execution service
- 这项冻结不等于提前冻结 `apps/execution-control` 的单一 Python/HTTP framework
- execution public ingress 已 hardcut 到 Go `apps/execution-control`；Python
  `apps/supervisor-agent-worker` 只保留 current private semantic bridge，长期退出
  online answer hot path

## Forbidden Shapes

- 不把 `apps/app-api` 重新拆回 consumer backend + panel backend
- 不把 `apps/execution-control` 重新长成 product backend
- 不把 panel 做成直接连 `packages/*` 或数据库的内部控制台
- 不把 request projection 退化成 chat transcript 或 telemetry replay 的别名

## 相关稳定文档

- `docs/contracts/app-api-http.md`
- `docs/contracts/app-api-operator-observability-http.md`
- `docs/contracts/app-api-request-lifecycle.md`
- `docs/contracts/app-api-supervisor-execution.md`
- `docs/architecture/system/capability-routing-and-admission-architecture.md`
- `docs/data/app-api-schema.md`
- `docs/decisions/adr-0011-protected-panel-worker-runtime.md`
- `docs/decisions/adr-0012-shared-app-api-and-worker-web-surfaces.md`
- `docs/decisions/adr-0013-app-api-worker-runtime.md`
- `docs/decisions/adr-0016-app-api-request-projection-and-panel-query-ownership.
  md`
- `docs/decisions/adr-0017-supervisor-internal-execution-admission.md`
- `docs/decisions/adr-0043-execution-control-docker-first-runtime.md`
- `docs/decisions/adr-0023-operator-observability-control-plane-and-sink-partici
  pation.md`
- `docs/architecture/system/operator-observability-architecture.md`
- `docs/architecture/system/runtime-delivery-and-release-hardening-architecture.md`
