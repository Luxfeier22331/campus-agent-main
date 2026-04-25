---
doc_type: architecture
status: active
created: 2026-04-02
updated: 2026-04-24
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

`browser -> public-chat-web -> app-api -> supervisor-api -> supervisor-agent-worker
private bridge`

`browser -> public-docs`

`browser -> protected-panel-web -> app-api -> request projection / operator read
model`

这意味着：

- 当前已落地的 public/protected/docs surface 是 shared `app-api` 前面的并列 browser surface
- `apps/public-chat-web` 与 `apps/public-docs` 都是 public-facing surface，但它们的内部 IA
  不自动升级成整个产品的顶层 IA
- `apps/public-docs` 是独立 docs-first browser surface
- `apps/app-api` 是 shared product/control-plane backend
- `apps/supervisor-api` 是 Docker-first internal execution engine
- panel 不读数据库、不读 telemetry sink、不绕过 `app-api`

补充结论：

- 当前 `public chat` 的 knowledge-only posture 只表示该 surface 当前开放的 capability set
- 它不等于整个产品的长期入口语义
- capability-neutral routing 与 surface capability policy 统一由 shared
  product/runtime + supervisor supporting architecture 表达

## Accepted Surface Shape

产品/runtime supporting architecture 当前已经冻结到以下粒度：

- `public-chat-web`
  - 当前是最成熟的公开助理入口，不再以旧 `public-consumer-chat` 为 forward truth
- `public-docs`
  - 已是正式公开文档站 app；当前 docs shell 已落地，但仍在 document-site workstream 下继续收口 published
    reader assets、same-site docs control-plane 与 canonical reader 对齐
- `protected-panel-web`
  - 当前只承接 app-owned operator domains；`Requests` 与 `Official Web` 已是 accepted
    shape
  - `Jobs`、`Operations`、更完整 `Audit` 仍属于后续 rollout，不应被写成当前 merged truth
- `apps/app-api`
  - 已同时承担 product backend 与 selected operator control-plane backend
  - `official_web` control plane 已是 accepted runtime domain，不再是旁路后台

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
- 不拥有 auth/session/conversation truth

### `apps/protected-panel-web`

- protected operator UI shell
- 只消费 runtime APIs
- fail-closed by default
- 不导入 `packages/*`，不把自己做成 `apps/supervisor-api` 的 hidden admin mode

### `apps/app-api`

- auth / session / principal mapping
- surface capability policy
- conversation 与 chat ingress
- `runtime.request_execution`
- `runtime.projection_outbox`
- `operator.request_projection`
- selected operator control-plane domains，例如 `official_web`

## Surface Capability Policy

surface capability policy 的长期 owner 固定为 `apps/app-api`。

直接含义：

- `public-chat-web` 当前只开放 `knowledge`，是 current surface posture
- `public-docs` 是非执行 surface，不自动进入 capability routing
- future `服务状态`、`校园地图` 等 surface 可以开放不同 capability set
- `apps/supervisor-api` 不拥有 browser-facing capability allowlist truth

固定规则：

- 不把某个 surface 当前开放的 capability 直接写成整个 repo 的长期入口原则
- surface policy 先于 execution routing
- `app-api` 负责把 surface policy、identity / authz projection 与 request truth 组装为最小
  execution input

### `apps/supervisor-api`

- internal execution admission
- typed execution transport
- forward deploy substrate 已冻结为 Docker-first internal execution service
- Docker-side Go `supervisor-api` 承担 execution-level backpressure、timeout、readiness、
  bridge circuit breaker、metrics 与 graceful drain；它不拥有 product-level 用户限流或
  browser-facing capability policy
- 不承担 browser-facing product backend 责任

### Docker Execution Runtime Boundary

当前 Docker execution runtime 拆成：

- `apps/supervisor-api`
  - 当前 execution ingress
  - 拥有 execution-level lifecycle、explicit cancel、global / per-lane admission、
    queue、timeout、bridge circuit breaker、readiness、metrics、OTel telemetry seam 与
    graceful drain
- Python `apps/supervisor-agent-worker`
  - private orchestration bridge worker
  - 负责消费 Go 已投影的 private bridge request，并通过 worker 内部
    agent dispatcher 调用 agent
  - 负责在 semantic orchestration checkpoints 观测 Go 投递的 cooperative cancel
  - 不再拥有 public execution ingress、caller auth 或 transport admission

长期边界固定为：

- `apps/app-api` 仍拥有 product-layer auth/session/principal、surface capability
  policy、conversation、request projection 与 operator read model
- Go execution runtime 不能反向拥有 browser-facing capability allowlist、用户级限流、
  duplicate-click UX、conversation truth 或 operator control plane
- Go runtime 可以继续吸收 deterministic supervisor runtime kernel，但不能因此把
  semantic orchestration、domain-agent reasoning 或 retrieval planning 塞进 `apps/*`

## Request Projection And Read Model

request projection 的 canonical durable truth 固定为：

- `runtime.request_execution`
- `runtime.projection_outbox`

panel `Requests` 的 canonical read path 固定为：

`apps/protected-panel-web -> apps/app-api -> operator.request_projection`

明确禁止：

- 直接读取 consumer chat tables 作为 request list/detail truth
- 直接读取 audit logs 或 telemetry sink 作为 request truth
- 让 panel 通过 `apps/supervisor-api` 旁路获取 operator list/detail

future operator-facing observability 域也遵循同一 ownership rule：

- audit / quality / safety / cost surface 仍由 `apps/app-api` 物化与提供
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

- `public-chat-web` 拥有 `/login`、`/register`、`/forgot-password`、`/reset-password`
  这组 browser route shell
- `app-api` 通过现有 auth provider / plugin 拥有最终 auth admission 与 server-side
  verification
- auth family 的 human verification transport 固定走 same-site `public-chat-web ->
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
- `apps/supervisor-api` 的部署 substrate 已冻结为 Docker-first internal execution service
- 这项冻结不等于提前冻结 `apps/supervisor-api` 的单一 Python/HTTP framework
- execution public ingress 已 hardcut 到 Go `apps/supervisor-api`；Python
  `apps/supervisor-agent-worker`
  只保留 private orchestration bridge

## Forbidden Shapes

- 不把 `apps/app-api` 重新拆回 consumer backend + panel backend
- 不把 `apps/supervisor-api` 重新长成 product backend
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
- `docs/decisions/adr-0043-supervisor-api-docker-first-runtime.md`
- `docs/decisions/adr-0023-operator-observability-control-plane-and-sink-partici
  pation.md`
- `docs/architecture/system/operator-observability-architecture.md`
- `docs/architecture/system/runtime-delivery-and-release-hardening-architecture.md`
