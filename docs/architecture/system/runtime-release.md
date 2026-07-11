---
doc_type: architecture
truth_scope: ops
owner_boundary: docs/architecture/system
status: active
created: 2026-04-14
updated: 2026-07-10
---
# Runtime Delivery And Release Hardening Architecture

## 文档边界

本文冻结 campus-web、Operator Console implementation surfaces、shared `app-api`
这组 Worker surface 的长期 delivery / release hardening supporting architecture。

它回答的是：

- 哪些 deploy / release 约束属于 repo 级长期 runtime truth
- staging baseline、release identity、config gate 与 release closeout artifacts
  应如何分层
- 哪些发布动作属于 shared runtime closure，哪些仍是环境特定输入

它不负责：

- 一次具体 deploy 的逐步操作命令
- 某次 smoke 的截图、artifact 或手工验收结果
- production hostname 何时启用

执行级 runbook 统一看：

- `docs/runbooks/execution-ops.md`
- `docs/runbooks/execution-ops.md`
- `docs/runbooks/execution-smoke.md`
- `docs/runbooks/worker-observability-smoke.md`

## 核心结论

三端 Worker surface 的长期发布闭环固定为：

`repo-owned config truth -> pre-deploy config/secret gate -> deploy-time release
identity injection -> post-deploy smoke -> release closeout artifact`

固定约束：

- `apps/campus-web`、Operator Console implementation surfaces、`apps/app-api` 必须共享一套
  release hardening discipline，但仍保持独立 deploy unit
- staging browser baseline 当前固定为 `campus-staging.mucwiki-edge.link` 与
  `panel-staging.mucwiki-edge.link`；docs 作为
  `campus-staging.mucwiki-edge.link/docs/*` 内部支撑面验收；web surfaces 通过
  Worker `APP_API` Service Binding 调用 `app-api-staging`
- `apps/execution-control` 的 repo-owned Docker Compose runtime 只保留 local
  diagnostics runtime projection；production target deploy substrate 已由 ADR-0056
  收口为 Kubernetes + KEDA。live staging/production substrate 必须由 applied resources、
  runtime env、operator projection 与 release closeout artifact 共同确认。
- `apps/execution-control` 仍不是 repo-level staging hostname truth；它继续通过显式 injected
  upstream 参与 staging execution seam
- repo-owned local diagnostics execution runtime shape 固定为
  `execution-control + Temporal + workflow-worker + activity-worker-core +
  activity-worker-agent + agent-runtime + activity-worker-knowledge +
  worker-autoscaler`；
  不允许新增第二条 dev-backed serving fallback path
- production target runtime 使用 KEDA Temporal scaler + Kubernetes HPA；
  Docker Compose autoscaler 只保留 local diagnostics projection
- `execution-control` readiness 代表 execution runtime 是否适合接收新请求；
  瞬时并发满载不单独定义为 runtime broken，queue full / draining / Temporal /
  projection / RAG runtime unhealthy 才进入 degraded posture
- 发布是否完成，不由 `/readyz` 单点决定，而由 config truth、runtime smoke 与
  release closeout artifacts 共同决定

## Staging Baseline

当前 accepted staging baseline 固定为：

- `apps/app-api` -> Worker `app-api-staging`，由 web surfaces 通过 `APP_API` Service
  Binding 调用
- `apps/app-api` optional machine / ops ingress -> `<https://api-staging.mucwiki-edge.link`>
- `apps/campus-web` -> `<https://campus-staging.mucwiki-edge.link`>
- `apps/operator-console-web` -> `<https://panel-staging.mucwiki-edge.link`>
- `apps/public-docs` -> removed; docs staging surface is `apps/campus-web /docs/*`

长期规则：

- `mucwiki-edge.link` 下项目隔离一级子域是当前 repo-owned staging truth
- `ayafeed.com` 与 `*.rag.ayafeed.com` 不再作为 campus-agent staging forward truth
- production hostname 应新增独立 env truth，而不是覆写 staging baseline
- `APP_API_BASE_URL` 与 `OPERATOR_CONSOLE_APP_API_BASE_URL` 在 Worker web
  surfaces 中固定为 `https://app-api.internal`，只用于 Service Binding request construction
- `api-staging.mucwiki-edge.link` 是 app-api public staging surface，不得被当作
  browser-internal upstream invariant

## Release Identity

release identity 的长期规则固定为：

- 每次 deploy 都必须显式生成当次 runtime release identity
- `SENTRY_RELEASE` 不得继续在 repo 中长期写死为某个历史值
- release identity 应优先从当前 git commit 或 CI release identifier 派生
- release identity 必须进入三端 runtime env，并作为 release closeout artifact 的主键之一

这意味着：

- release naming 是 deploy-time concern，不是静态配置文件事实
- observability、artifact 命名与 deploy 审计必须围绕同一 release identity 收口

## Staging Deployment Sequence

Staging deployment uses two ordered owners:

1. A source-repository `main` push deploys the Cloudflare product surfaces and
   checks their own health. It also publishes execution runtime images and
   opens an environment-repository promotion pull request.
1. Merging that promotion pull request lets Argo CD reconcile the pinned source
   SHA and image digests. The environment repository then waits for public
   `app-api /readyz` to report both runtime dependencies ready and the exact
   `execution-control` release selected by desired state.

The source-repository Worker deployment must not claim full runtime readiness
before the environment promotion is merged. A healthy stale runtime release is
not valid post-promotion evidence.

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
- internal shared secret、operator allowlist、campus-web origin allowlist 必须按跨 app
  invariant 收口
- `AUTH_SHELL_ORIGIN`、`APP_API_BASE_URL=https://app-api.internal`、
  `OPERATOR_CONSOLE_APP_API_BASE_URL=https://app-api.internal` 不能漂移

### Data Freshness / DB Gate

- shared Postgres schema 必须先和 repo 当前 snapshot 对齐
- `APP_API_DB` 与 `APP_API_DB_FRESH` 必须继续分 lane
- auth 与其他 read-after-write-sensitive path 必须走 fresh lane，不接受被缓存 negative lookup
  污染

### Upstream Execution Gate

- `app-api` staging deploy 必须包含 `EXECUTION_CONTROL_PRIVATE` Worker VPC Service
  binding，并显式配置非密的 `EXECUTION_CONTROL_PRIVATE_ORIGIN`
- staging forward deploy truth 是
  `app-api Worker -> Worker VPC Service -> cloudflared in staging K8s ->
  ClusterIP execution-control:8000`
- staging 不再要求旧的 execution-control public URL deploy 变量，也不再通过
  Cloudflare Access service-token 访问 execution-control public ingress
- `127.0.0.1`、repo placeholder、失效 tunnel 或被删除的 Ingress 不属于 deploy truth
- repo-owned staging runbook 只消费 app-api / campus-web / operator-console public
  product surfaces；execution-control readiness 由 app-api readyz 与 K8s/GitOps
  状态间接证明

### Execution Runtime Gate

Execution runtime 的 release gate 长期至少覆盖：

- `execution-control /healthz`、`/readyz` 与 `/metrics` 可达
- Temporal worker poller readiness 已被 `execution-control /readyz` 聚合
- configured global budget 与 per-tool budget 未漂移
- queue full、queue timeout、draining、tool runtime timeout 与 tool runtime
  unavailable 都有 typed failure fingerprint
- cancel / client disconnect path 不继续占用 Go request slot
- audit writer / runtime log sink 不阻塞 answer path，并暴露 dropped / last-error 状态
- audit writer 的批量、重试、spool 与 OTel sample/export/drop/failure 状态必须进入
  `/readyz` / `/metrics`
- `POST /internal/execution/runs` 只作为 app-api 内部 execution command seam 验证，不作为
  token streaming 或 browser 直连验收标准

Kubernetes production target 还必须覆盖：

- execution-control Service 只允许 trusted app-api / operator runtime caller 访问
- workflow-worker 与每个 activity-worker Deployment 均有 readiness、liveness、
  resource request / limit 与 rollout strategy
- 每个 Temporal task queue 只有一个 owner Deployment 与一个 KEDA ScaledObject
- KEDA operator / metrics server healthy，HPA 不存在 metric fetch failure
- ScaledObject 明确 min/max replicas、target queue size、polling interval、cooldown
  与 HPA scale-down behavior
- app-api operator runtime projection 能看到 fresh task queue metrics、KEDA/HPA
  scaler posture 与 scale event evidence

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

- online answer staging 使用 canonical smoke identity
- smoke identity 的创建、密码重置、旧聊天清理统一由 repo-owned script 执行
- operator smoke 继续使用真实 Access-admitted operator principal
- smoke identity 只属于 deploy / verification tooling，不写进产品文案、测试快照或 runbook 摘要正文

## Release Closeout Artifact Boundary

release closeout artifact 的长期 closure 固定为：

- `campus-web -> app-api` 至少一条真实 trace
- `Operator Console surface -> app-api` 至少一条真实 trace；当前 staging implementation
  surface 是 `operator-console-web`
- `app-api` 至少一条 runtime event / scheduled drain artifact
- 当次 release 的 closeout artifact 落盘

长期规则：

- `Sentry` / `Axiom` 是 verification sink，不是 canonical operator read model
- release hardening 的关闭条件是“真实请求和真实 runtime event 已进入 sink 并留存
  closeout artifact”，不是“SDK 已接入”
- closeout artifact 必须以 timestamp + release identity + environment 收口，供回归和发布审计复用

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
- 不把临时浏览器注册账号重新引回 deployment smoke 主路径
- 不把 runtime observability sink 反向当成 canonical app read model

## 相关稳定文档

- `docs/architecture/system/product-runtime.md`
- `docs/runbooks/execution-ops.md`
- `docs/runbooks/worker-observability-smoke.md`
- `docs/architecture/system/k8s-runtime.md`
- `docs/environment/README.md`
- `docs/decisions/adr-0010-observability-and-telemetry-stack.md`
- `docs/decisions/adr-0011-operator-console-worker-runtime.md`
- `docs/decisions/adr-0012-shared-app-api-and-worker-web-surfaces.md`
- `docs/decisions/adr-0013-app-api-worker-runtime.md`
- `docs/decisions/adr-0056-k8s-keda.md`
