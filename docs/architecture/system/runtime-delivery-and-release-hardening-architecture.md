---
doc_type: architecture
status: active
created: 2026-04-14
updated: 2026-04-25
---
# Runtime Delivery And Release Hardening Architecture

## 文档边界

本文冻结 campus-web、public chat、protected panel、shared `app-api` 这组 Worker surface 的长期
delivery / release hardening supporting architecture。

它回答的是：

- 哪些 deploy / release 约束属于 repo 级长期 runtime truth
- staging baseline、release identity、config gate 与 post-deploy evidence 应如何分层
- 哪些发布动作属于 shared runtime closure，哪些仍是环境特定输入

它不负责：

- 一次具体 deploy 的逐步操作命令
- 某次 smoke 的截图、artifact 或手工验收结果
- production hostname 何时启用

执行级 runbook 统一看：

- `docs/runbooks/staging-worker-deploy-runbook.md`
- `docs/runbooks/execution-control-staging-operations.md`
- `docs/runbooks/execution-control-staging-smoke-runbook.md`
- `docs/runbooks/worker-observability-smoke-runbook.md`

## 核心结论

三端 Worker surface 的长期发布闭环固定为：

`repo-owned config truth -> pre-deploy config/secret gate -> deploy-time release
identity injection -> post-deploy smoke -> observability evidence artifact`

固定约束：

- `apps/campus-web`、`apps/public-chat-web`、`apps/protected-panel-web`、
  `apps/app-api` 必须共享一套
  release hardening discipline，但仍保持独立 deploy unit
- staging browser baseline 当前固定为 `campus-staging.mucwiki-edge.link`、
  `chat-staging.mucwiki-edge.link`、`panel-staging.mucwiki-edge.link`；docs 作为
  `campus-staging.mucwiki-edge.link/docs/*` 内部支撑面验收；web surfaces 通过 Worker
  `APP_API` Service Binding 调用 `app-api-staging`
- `apps/execution-control` 的前向 deploy substrate 已冻结为 Docker-first internal execution
  service
- `apps/execution-control` 仍不是 repo-level staging hostname truth；它继续通过显式 injected
  upstream 参与 staging execution seam
- 当前 repo-owned staging execution runtime 已 hardcut 到 `execution-control + supervisor-agent-worker`
  双容器；legacy dev-backed supervisor host 不再是 active runback path
- `execution-control` readiness 代表 execution runtime 是否适合接收新请求；瞬时并发满载不单独定义为
  runtime broken，queue full / draining / bridge unhealthy 才进入 degraded posture
- 发布是否完成，不由 `/readyz` 单点决定，而由 config truth、runtime smoke 与 post-deploy evidence
  共同决定

## Staging Baseline

当前 accepted staging baseline 固定为：

- `apps/app-api` -> Worker `app-api-staging`，由 web surfaces 通过 `APP_API` Service
  Binding 调用
- `apps/app-api` optional machine / ops ingress -> `<https://api-staging.mucwiki-edge.link`>
- `apps/campus-web` -> `<https://campus-staging.mucwiki-edge.link`>
- `apps/public-chat-web` -> `<https://chat-staging.mucwiki-edge.link`>
- `apps/protected-panel-web` -> `<https://panel-staging.mucwiki-edge.link`>
- `apps/public-docs` -> retired/reference package, not a forward staging surface

长期规则：

- `mucwiki-edge.link` 下项目隔离一级子域是当前 repo-owned staging truth
- `ayafeed.com` 与 `*.rag.ayafeed.com` 不再作为 campus-agent staging forward truth
- future production hostname 应新增独立 env truth，而不是覆写 staging baseline
- `APP_API_BASE_URL` 与 `PANEL_RUNTIME_API_BASE_URL` 在 Worker web surfaces 中固定为
  `https://app-api.internal`，只用于 Service Binding request construction
- `api-staging.mucwiki-edge.link` 不得作为 browser surface upstream invariant；若保留，
  必须按 machine ingress 处理

## Release Identity

release identity 的长期规则固定为：

- 每次 deploy 都必须显式生成当次 runtime release identity
- `SENTRY_RELEASE` 不得继续在 repo 中长期写死为某个历史值
- release identity 应优先从当前 git commit 或 CI release identifier 派生
- release identity 必须进入三端 runtime env，并作为 post-deploy evidence 的主键之一

这意味着：

- release naming 是 deploy-time concern，不是静态配置文件事实
- observability、artifact 命名与 deploy 审计必须围绕同一 release identity 收口

## Pre-Deploy Gate

长期上，发布前 gate 至少分成四类：

### Config / Secret Gate

- required secret presence 必须在 deploy 前显式校验
- non-secret runtime truth 可以存在于 repo-owned config
- operator Access team domain、policy audience、deploy-side DB operator URL
  等环境值继续通过 shell / secret store 注入，不回写 repo

### Cross-App Invariants

- public/panel 都必须指向同一个 `app-api` staging origin
- public/docs/panel 的 `app-api` staging origin 是 `APP_API` Service Binding +
  `https://app-api.internal`，不是 public custom domain fetch
- internal shared secret、operator allowlist、public chat allowlist 必须按跨 app
  invariant 收口
- `PUBLIC_CHAT_WEB_ORIGIN`、`APP_API_BASE_URL=https://app-api.internal`、
  `PANEL_RUNTIME_API_BASE_URL=https://app-api.internal` 不能漂移

### Data Freshness / DB Gate

- shared Postgres schema 必须先和 repo 当前 snapshot 对齐
- `APP_API_DB` 与 `APP_API_DB_FRESH` 必须继续分 lane
- auth 与其他 read-after-write-sensitive path 必须走 fresh lane，不接受被缓存 negative lookup
  污染

### Upstream Execution Gate

- `app-api` deploy 时必须显式注入真实可达的 `EXECUTION_CONTROL_BASE_URL`
- forward deploy truth 应指向 Docker-first Go execution ingress
- 如果 Docker supervisor ingress 由 Cloudflare Access 保护，`app-api` 必须同时注入
  `EXECUTION_CONTROL_ACCESS_CLIENT_ID` 与 `EXECUTION_CONTROL_ACCESS_CLIENT_SECRET`
- `127.0.0.1`、repo placeholder 或失效 tunnel 不属于 deploy truth
- repo-owned staging runbook 只消费 `execution-control` execution origin；不再保留
  dev-backed compatibility path

### Execution Runtime Gate

Docker-side execution runtime 的 release gate 长期至少覆盖：

- `execution-control /healthz`、`/readyz` 与 `/metrics` 可达
- Python private bridge readiness 已被 `execution-control /readyz` 聚合
- configured global budget 与 per-lane budget 未漂移
- queue full、queue timeout、draining、bridge timeout 与 bridge unavailable 都有
  typed failure fingerprint
- cancel / client disconnect path 不继续占用 Go request slot
- audit writer / runtime log sink 不阻塞 answer path，并暴露 dropped / last-error 状态
- audit writer 的批量、重试、spool 与 OTel sample/export/drop/failure 状态必须进入
  `/readyz` / `/metrics`
- `POST /internal/execution/runs` 只作为 app-api 内部 execution command seam 验证，不作为
  token streaming 或 browser 直连验收标准

这些 gate 只判断 execution runtime 是否适合接收新请求；它们不替代 `app-api`
产品层 request projection、operator read model 或 browser smoke。

## Protected Access And Operator Admission

长期上，panel staging closure 固定依赖两层保护：

- upstream Cloudflare Access protects the hostname
- origin/runtime admission validates the Access JWT and operator allowlist

固定规则：

- `Missing Access JWT.` 只能说明入口保护未完成，不能当成 deploy success
- Access application audience 与 team domain 是 runtime admission contract，不是 repo
  placeholder
- operator allowlist miss 导致的 `operator_identity_not_admitted` 属于
  release-hardening miss，不属于 panel 产品逻辑问题

## Smoke Identity

长期上，发布 smoke 不依赖浏览器现场临时注册。

固定规则：

- public chat staging 使用 canonical smoke identity
- smoke identity 的创建、密码重置、旧聊天清理统一由 repo-owned script 执行
- operator smoke 继续使用真实 Access-admitted operator principal
- smoke identity 只属于 deploy / verification tooling，不写进产品文案、测试快照或 runbook 摘要正文

## Post-Deploy Evidence

post-deploy verification 的长期 closure 固定为：

- `public-chat-web -> app-api` 至少一条真实 trace
- `protected-panel-web -> app-api` 至少一条真实 trace
- `app-api` 至少一条 runtime event / scheduled drain evidence
- 当次 release 的 evidence artifact 落盘

长期规则：

- `Sentry` / `Axiom` 是 verification sink，不是 canonical operator read model
- release hardening 的关闭条件是“真实请求和真实 runtime event 已进入 sink 并留存证据”，不是“SDK 已接入”
- evidence artifact 必须以 timestamp + release identity + environment 收口，供回归和发布审计复用

## Out Of Scope

以下内容不属于本文维护：

- `official_web` collector live seam 是否与本次 staging 一起验收
- `authenticated_notice` live portal scheduling
- production rollout 的 hostname、证书或流量切换策略

这些仍由各自 domain architecture、runbook 与 `.planning/` 负责。

## Forbidden Shapes

- 不把静态 `wrangler.toml` 里的历史 `SENTRY_RELEASE` 当成长期正确发布方案
- 不把 panel Access placeholder 当成可接受的 staging protection truth
- 不把 `/readyz = 200` 误写成完整 deploy closure
- 不把临时浏览器注册账号重新引回 staging smoke 主路径
- 不把 runtime observability sink 反向当成 canonical app read model

## 相关稳定文档

- `docs/architecture/system/product-runtime-architecture.md`
- `docs/runbooks/staging-worker-deploy-runbook.md`
- `docs/runbooks/worker-observability-smoke-runbook.md`
- `docs/environment/README.md`
- `docs/decisions/adr-0010-observability-and-telemetry-stack.md`
- `docs/decisions/adr-0011-protected-panel-worker-runtime.md`
- `docs/decisions/adr-0012-shared-app-api-and-worker-web-surfaces.md`
- `docs/decisions/adr-0013-app-api-worker-runtime.md`
- `docs/decisions/adr-0043-execution-control-docker-first-runtime.md`
