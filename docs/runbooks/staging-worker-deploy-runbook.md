---
doc_type: runbook
truth_scope: ops
owner_boundary: docs/runbooks
status: active
created: 2026-04-04
updated: 2026-06-09
---
# Staging Worker Deploy Runbook

## 用途

这份 runbook 固定首个真实 Worker 部署环境的最小执行面：

- environment: `staging`
- zone: `mucwiki-edge.link`
- staging hostname shape: `mucwiki-edge.link` 下一级子域
- `apps/app-api`: Worker `app-api-staging`；optional machine / ops ingress
  `https://api-staging.mucwiki-edge.link`
- `apps/campus-web`: `https://campus-staging.mucwiki-edge.link`
- `apps/public-chat-web`: `https://chat-staging.mucwiki-edge.link`
- `apps/protected-panel-web`: `https://panel-staging.mucwiki-edge.link`
- `apps/public-docs`: removed; docs deploy and smoke run through `apps/campus-web`
  `/docs/*`

它只回答：

- 当前 repo 应该如何表达 `staging` deploy truth
- Cloudflare 侧需要先 provision 哪些资源
- 首次 deploy 前后各要执行什么

它不回答长期 production hostname；未来切换到 `muc.wiki` 时，应新增 `production` env，而不是覆写这里的
`staging` truth。

当前补充真相：

- `apps/execution-control` 的前向 deploy substrate 已正式冻结为 Docker-first internal
  execution service
- 当前 repo-owned staging execution runtime 已收敛到 `nc-arm-6c` 上：
  - `otel-collector`
  - `execution-control`
  - `workflow-worker`
  - `activity-worker-context`
  - `agent-runtime`
  - `activity-worker-agent`
  - `activity-worker-knowledge`
  - `activity-worker-campus-services`
  - `activity-worker-notice`
  - `activity-worker-navigation`
  - `activity-worker-finalization`
  - `worker-autoscaler`
  - Temporal
- 这条 canonical execution runtime 的运维姿势、systemd connector、自愈与日志规则统一记录在
  `execution-control-staging-operations.md`
- Python public compatibility ingress 已退出 active staging path

## Hostname Constraint

- 当前 Cloudflare staging 下，不再把 `ayafeed.com` 或 `*.rag.ayafeed.com`
  作为 campus-agent staging custom domain 视为可依赖的 SSL deploy truth
- `mucwiki-edge.link` 是当前 repo-owned staging zone；`ayafeed.com` 不再视为本 repo
  可占用的 deploy truth
- staging browser forward truth 必须统一使用 `mucwiki-edge.link` 下的项目隔离一级子域：
  `campus-staging.mucwiki-edge.link`、`chat-staging.mucwiki-edge.link`、
  `panel-staging.mucwiki-edge.link`；docs 作为 `campus-staging.mucwiki-edge.link/docs/*`
  的内部支撑面验收
- `api-staging.mucwiki-edge.link` 如保留，只作为 `app-api-staging` 的 machine /
  ops ingress；web surfaces 不把它当成 upstream
- repo 中若再次出现 `ayafeed.com` 或 `*.rag.ayafeed.com` staging 配置、脚本断言或测试断言，只能视为待迁移实现残留，不能继续作为新资源
  provision 或 deploy 目标
- 依据：Cloudflare 官方文档说明 Universal SSL 默认覆盖 apex 与一级子域，更深层级需依赖不同证书能力，因此当前 tier
  下不再继续使用嵌套 staging 子域
  - <https://developers.cloudflare.com/fundamentals/setup/manage-domains/manage-subdomains/>

## Repo-Owned Config

本节描述的是必须收敛到 `mucwiki-edge.link` 的前向 deploy truth。

- `apps/app-api/wrangler.toml`
  - `env.staging` 的 Worker 名为 `app-api-staging`
  - `api-staging.mucwiki-edge.link` 如配置 custom domain，只作为受控 machine /
    ops ingress
  - `env.staging.hyperdrive` 持有 `APP_API_DB`（cached/read-mostly）与
    `APP_API_DB_FRESH`（no-cache/auth-sensitive）两条 staging binding
  - `env.staging.vars.PUBLIC_CHAT_WEB_ORIGIN=https://chat-staging.mucwiki-edge.link`
  - `env.staging.vars.AUTH_SHELL_ORIGIN=https://campus-staging.mucwiki-edge.link`
- `apps/app-api/package.json`
  - `pnpm deploy:staging` 要求显式注入 `STAGING_EXECUTION_CONTROL_BASE_URL`
  - `pnpm deploy:preflight:staging` 是 canonical preflight：固定执行 `doctor_env
    worker-staging-app-api`、Cloudflare secret presence、repo-owned staging config
    verification、`db:bootstrap:staging`、`db:migrate:staging` 与
    `db:reconcile-shared-drift:staging`
  - deploy 时通过 `--var EXECUTION_CONTROL_BASE_URL:<url>` 注入当前 execution-control
    upstream
  - `pnpm deploy:staging` 会在 publish 时自动注入
    `SENTRY_RELEASE=app-api@staging-<sha>`；只有需要固定 release 名时才覆写
    `STAGING_SENTRY_RELEASE`
  - 真实 deploy 直接使用当前 shell 的 `wrangler` 登录态；repo-local `.wrangler-home` 只保留给
    dev/test
- `apps/campus-web/wrangler.toml`
  - `env.staging` 应收敛到 `campus-staging.mucwiki-edge.link`
  - `env.staging.routes` 必须是 `custom_domain = true`
  - `env.staging.services.APP_API -> app-api-staging`
  - `env.staging.vars.APP_API_BASE_URL=https://app-api.internal`
  - `SENTRY_DSN` 是 optional runtime observability sink，不属于 campus
    staging deploy hard gate
- `apps/campus-web/package.json`
  - `pnpm build:staging` 使用 `CLOUDFLARE_ENV=staging`
  - staging build 使用 repo-owned `scripts/run-worker-staging-build.mjs`；campus 当前没有
    required runtime-only secret placeholder
  - `pnpm deploy:preflight:staging` 是 canonical preflight：固定执行
    `doctor_env worker-staging-campus-web`、Cloudflare secret presence、
    staging build 与 built config verification
  - `pnpm deploy:staging` 发布 staging build artifact，并在 publish 时自动注入
    `SENTRY_RELEASE=campus-web@staging-<sha>`
  - campus auth Turnstile posture 由 publish-time vars 注入：
    `STAGING_CAMPUS_AUTH_TURNSTILE_SITE_KEY` 必填，且必须是 admitted for
    `campus-staging.mucwiki-edge.link` 的真实 sitekey；测试 sitekey 只允许 local smoke
- `apps/public-chat-web/wrangler.toml`
  - `env.staging` 应收敛到 `chat-staging.mucwiki-edge.link`
  - `env.staging.services.APP_API -> app-api-staging`
  - `env.staging.vars.APP_API_BASE_URL=https://app-api.internal`
  - `env.staging.vars.AUTH_SHELL_ORIGIN=https://campus-staging.mucwiki-edge.link`
- `apps/public-chat-web/package.json`
  - `pnpm build:staging` 使用 `CLOUDFLARE_ENV=staging`
  - staging build 会通过 repo-owned `scripts/run-worker-staging-build.mjs`
    为缺失的 runtime-only Worker secrets 注入构建期占位值；wrapper 会在 build
    后删除生成的 `dist/**/.dev.vars`，并拒绝任何占位值进入其余 build artifact
  - `pnpm deploy:preflight:staging` 是 canonical preflight：固定执行 `doctor_env
    worker-staging-public-chat-web`、Cloudflare secret presence、staging build 与
    built config verification
  - `pnpm deploy:staging` 发布 staging build artifact，并在 publish 时自动注入
    `SENTRY_RELEASE=public-chat-web@staging-<sha>`
  - public auth Turnstile posture 由 publish-time vars
    注入：`AUTH_TURNSTILE_SITE_KEY` 必填，`AUTH_TURNSTILE_APPEARANCE` /
    `AUTH_TURNSTILE_EXECUTION` 可选；未显式覆写时默认 `interaction-only` / `render`
  - deploy 使用当前 shell 的 `wrangler` 登录态，不再强绑 repo-local `.wrangler-home`
- `apps/protected-panel-web/wrangler.toml`
  - `env.staging` 应收敛到 `panel-staging.mucwiki-edge.link`
  - `env.staging.services.APP_API -> app-api-staging`
  - `env.staging.vars.PANEL_RUNTIME_API_BASE_URL=https://app-api.internal`
  - `env.staging.vars` 只保留 non-secret runtime truth；`ACCESS_TEAM_DOMAIN` /
    `ACCESS_POLICY_AUD` 不再硬编码在 repo
- `apps/protected-panel-web/package.json`
  - `pnpm build:staging` 使用 `CLOUDFLARE_ENV=staging`
  - staging build 会通过 repo-owned `scripts/run-worker-staging-build.mjs`
    为缺失的 runtime-only Worker secrets 注入构建期占位值；wrapper 会在 build
    后删除生成的 `dist/**/.dev.vars`，并拒绝任何占位值进入其余 build artifact
  - `pnpm deploy:preflight:staging` 是 canonical preflight：固定执行 `doctor_env
    worker-staging-protected-panel-web`、Cloudflare secret presence、staging build
    与 built config verification
  - `pnpm deploy:staging` 通过 `scripts/deploy-staging.mjs` 发布 staging build
    artifact
  - deploy 时必须显式注入 `STAGING_ACCESS_TEAM_DOMAIN` 与 `STAGING_ACCESS_POLICY_AUD`
  - deploy 脚本会自动把当前 git commit 注入 runtime
    `SENTRY_RELEASE=protected-panel-web@staging-<sha>`；仅在需要覆写时才显式传入
    `STAGING_SENTRY_RELEASE`
  - deploy 脚本会拒绝 `https://team.cloudflareaccess.com` / `panel-audience`
    这类占位值
  - deploy 使用当前 shell 的 `wrangler` 登录态，不再强绑 repo-local `.wrangler-home`

说明：

- Wrangler environment 会把 Worker service 名派生为 `<name>-staging`
- 因此 staging web surfaces 必须绑定到 `app-api-staging`，不是 top-level `app-api`

## Cloudflare Provisioning Checklist

### 1. Worker hostnames

- 如需要 machine / ops ingress，创建 `api-staging.mucwiki-edge.link` custom domain，
  绑定到 `app-api-staging`，并使用 Cloudflare Access service token 或等价机器保护
- 创建 `campus-staging.mucwiki-edge.link` custom domain，绑定到 `campus-web-staging`
- 创建 `chat-staging.mucwiki-edge.link` custom domain，绑定到
  `public-chat-web-staging`
- 创建 `panel-staging.mucwiki-edge.link` custom domain，绑定到
  `protected-panel-web-staging`

### 2. Internal service bindings

- `public-chat-web-staging`
  - `APP_API -> app-api-staging`
- `protected-panel-web-staging`
  - `APP_API -> app-api-staging`

### 3. Database

- 为 `app-api-staging` provision `APP_API_DB` Hyperdrive binding
- 为 `app-api-staging` provision `APP_API_DB_FRESH` Hyperdrive binding，并显式关闭 SQL
  response caching
- 把真实 staging Hyperdrive resource id 写入 `apps/app-api/wrangler.toml` 的
  `[[env.staging.hyperdrive]]`
- 确认 staging Postgres 对 Hyperdrive 可达
- 单独准备 staging shared Postgres 的 operator/session-pooler 连接串，供 Drizzle migration
  / drift reconciliation 使用
- `Hyperdrive` 只覆盖 Worker runtime query path，不替代 deploy 前 schema migration
- `APP_API_DB` 负责 read-mostly/cached query path；`APP_API_DB_FRESH` 负责 auth 与其他
  read-after-write-sensitive product path，避免 `sign-up -> immediate sign-in` 被
  stale negative lookup 污染

### 4. Access

- 为 `panel-staging.mucwiki-edge.link` 建 Cloudflare Access application
- 生成并记录：
  - `ACCESS_TEAM_DOMAIN`
  - `ACCESS_POLICY_AUD`
- 确认 staging operator principal 有可用登录路径
- deploy `protected-panel-web` 时，把这两个值显式映射到 `STAGING_ACCESS_TEAM_DOMAIN` /
  `STAGING_ACCESS_POLICY_AUD`
- 判定 Access provision 完成的标准不是 `panel /readyz = 200`；真实浏览器首次访问必须先经过 Cloudflare
  Access 准入，不能停留在 worker 直接返回 `401 Missing Access JWT.`

### 5. Execution-control trusted machine ingress

- `apps/execution-control` 的前向 deploy substrate 已冻结为 Docker-first internal execution
  service
- `execution-control` 不是 public staging surface；用户、浏览器、panel、docs 与 chat
  都只进入 browser surface 或 `app-api`
- `apps/app-api` staging deploy 时必须显式注入真实可达的 trusted machine upstream：
  `STAGING_EXECUTION_CONTROL_BASE_URL=https://execution-control-staging.mucwiki-edge.link`
- `apps/app-api` staging deploy 还必须配置
  `STAGING_EXECUTION_CONTROL_ACCESS_CLIENT_ID` 与
  `STAGING_EXECUTION_CONTROL_ACCESS_CLIENT_SECRET`，并把它们投影为 Worker runtime
  `EXECUTION_CONTROL_ACCESS_CLIENT_ID` / `EXECUTION_CONTROL_ACCESS_CLIENT_SECRET`
- 当前 repo-owned staging execution-control runtime 由
  `infra/local/docker-compose.execution-control-runtime.yml` 承接
- canonical 常驻方式是 `nc-arm-6c` 上的 Docker Compose runtime，加 VM origin reverse
  proxy、Cloudflare proxied DNS 与 Cloudflare Access service-token policy
- 只要 production execution substrate 还没有接管，staging operator 就应优先维护
  `nc-arm-6c` 上的 canonical execution-control 常驻链路，而不是每轮重新发一个随机
  临时入口
- 当前 repo-owned execution upstream 实际来自：
  - `nc-arm-6c:/srv/apps/campus-agent/infra/local/staging/start-execution-control-staging.sh`
  - `execution-control-staging.mucwiki-edge.link` machine ingress
  - strict health gate
    `infra/local/staging/status-execution-control-staging.sh --check`
- `127.0.0.1` 只能留在 origin reverse proxy 所在机器的 process truth，不能作为
  Worker staging deploy truth
- 当前 canonical execution host 的常驻安装、冷启动恢复与 `status --check`
  health gate，见 `docs/runbooks/execution-control-staging-operations.md`

## Secret Matrix

### `apps/app-api`

在 `apps/app-api` 目录执行：

```bash
wrangler secret put BETTER_AUTH_SECRET --env staging
wrangler secret put AUTH_TURNSTILE_SECRET_KEY --env staging
wrangler secret put RESEND_API_KEY --env staging
wrangler secret put AUTH_RESET_EMAIL_FROM --env staging
wrangler secret put EXECUTION_CONTROL_SHARED_SECRET --env staging
wrangler secret put APP_API_INTERNAL_SHARED_SECRET --env staging
wrangler secret put APP_API_STAGING_SMOKE_AUTH_SECRET --env staging
wrangler secret put SENTRY_DSN --env staging
wrangler secret put AXIOM_TOKEN --env staging
```

只有当你需要独立 reply-to 地址时，才额外下发：

```bash
wrangler secret put AUTH_RESET_EMAIL_REPLY_TO --env staging
```

只有当当前 staging 同时启用 `official-web-collector -> app-api` live control-plane seam
时，才额外下发：

```bash
wrangler secret put APP_API_OFFICIAL_WEB_COLLECTOR_TOKEN --env staging
```

还需要在 Cloudflare env vars / secret store 中补齐：

- `APP_API_END_USER_EMAIL_DOMAIN_ALLOWLIST=muc.edu.cn`
- `APP_API_END_USER_EMAIL_ALLOWLIST=help_bot@outlook.com`
- `APP_API_OPERATOR_EMAIL_ALLOWLIST`
- `SENTRY_ENVIRONMENT=staging`
- `AXIOM_ENDPOINT`
- `AXIOM_DATASET`

deploy shell 还需要可用的 staging shared DB 管理连接：

- `STAGING_APP_API_OPERATOR_DATABASE_URL`
- 可选：`STAGING_APP_API_DATABASE_SSLMODE=require`
- `APP_API_FEDERATION_MUC_WIKI_CLIENT_SECRET`，仅用于
  `federation:provision-muc-wiki:staging`
- `APP_API_FEDERATION_MUC_WIKI_REDIRECT_URI`，首期为完整
  `Special:PluggableAuthLogin` callback URL
- `APP_API_FEDERATION_MUC_WIKI_POST_LOGOUT_REDIRECT_URI`，首期为显式 wiki logout /
  return URL
- `APP_API_STAGING_SMOKE_AUTH_SECRET` 或
  `STAGING_APP_API_SMOKE_AUTH_SECRET`，用于 `chat:e2e:staging`、
  `docs:gated:smoke:staging`、`account:smoke:staging` 与
  `federation:smoke:staging`；验收机 operator copy 可放在
  `nc-arm-6c:/srv/docker/campus-agent/staging/env/runtime.env`
- 只有在你手工运行低层 smoke identity reset 时，shell 才需要 `APP_API_SMOKE_IDENTITY_PASSWORD`

`STAGING_APP_API_OPERATOR_DATABASE_URL` 是 app-api schema/bootstrap/operator 管理连接，不是
execution-control retrieval runtime 数据面。`nc-arm-6c:/srv/docker/campus-agent/staging/env/runtime.env`
必须另外显式配置：

- `STAGING_INGESTION_SHARED_POSTGRES_URL`
- `STAGING_INGESTION_DOCUMENT_REGISTRY_DATABASE_URL`
- `STAGING_INGESTION_OBJECT_STORE_ENDPOINT`
- `STAGING_INGESTION_OBJECT_STORE_DERIVED_ACCESS_KEY`
- `STAGING_INGESTION_OBJECT_STORE_DERIVED_SECRET_KEY`
- `STAGING_INGESTION_QDRANT_URL`，必须是 self-hosted Qdrant HTTPS endpoint，例如
  `https://127.0.0.1:6333`
- `STAGING_INGESTION_QDRANT_API_KEY`，只用于 Qdrant service/admin lifecycle
- `STAGING_INGESTION_QDRANT_READ_ONLY_API_KEY`，投影为 online runtime
  `QDRANT_QUERY_API_KEY`
- `STAGING_INGESTION_QDRANT_TLS_CA_CERT_PATH`，指向 ops-owned CA bundle，例如
  `/srv/docker/campus-agent/staging/qdrant/tls/ca.pem`
- `STAGING_INGESTION_EMBEDDING_*`
- `STAGING_INGESTION_SPARSE_*`

supervisor staging lifecycle 只把这些 `STAGING_INGESTION_*` 投影进 Docker runtime；
不会从 root `.env`、app-api `.dev.vars` 或 `STAGING_APP_API_OPERATOR_DATABASE_URL`
推断 retrieval 数据面。

要求：

- `APP_API_OPERATOR_EMAIL_ALLOWLIST` 必须显式包含当前 panel smoke / operator Access
  身份；当前 staging 至少需要 `help_bot@outlook.com`
- 如果该 allowlist miss，`/api/operator/*` 会返回 `403
  operator_identity_not_admitted`，这是 operator admission 配置问题，不是 Access session
  失效
- `AUTH_RESET_EMAIL_FROM` 必须是当前 Resend 项目已验证的 sender identity；否则 password reset
  mail contract 不能视为 ready
- `SENTRY_RELEASE` 不作为 dashboard 静态 var 保存；`pnpm deploy:staging` 会在 publish
  时自动注入 `app-api@staging-<sha>`，只有需要固定 release 名时才用 `STAGING_SENTRY_RELEASE`
- `APP_API_SMOKE_IDENTITY_PASSWORD` 只属于低层手工 reset 命令的 shell / secret
  store 输入；不要把它写入 repo、runbook 产物或浏览器抓包摘要
- `APP_API_STAGING_SMOKE_AUTH_SECRET` 只属于 staging automation admission；它必须和
  Worker secret store 中的同名 secret 一致，不进入浏览器、supervisor 或 retrieval path
- `APP_API_FEDERATION_MUC_WIKI_CLIENT_SECRET` 只属于 app-api operator provision
  命令；它不进入 Worker vars、browser shell vars、文档示例真实值或 MediaWiki repo 文件
- `APP_API_OFFICIAL_WEB_COLLECTOR_TOKEN` 不属于当前最小 staging chat/panel/app-api
  闭环的必填项；它只在你准备同时验收 official-web live control-plane 时才应视为当前环境 gate

### `apps/public-chat-web`

在 `apps/public-chat-web` 目录执行：

```bash
wrangler secret put SENTRY_DSN --env staging
```

并补齐：

- `SENTRY_ENVIRONMENT=staging`
- deploy shell env `STAGING_AUTH_TURNSTILE_SITE_KEY=<real admitted sitekey for
  chat-staging.mucwiki-edge.link>`
- 可选 deploy shell env
  `STAGING_AUTH_TURNSTILE_APPEARANCE=<always|execute|interaction-only>`；默认
  `interaction-only`
- 可选 deploy shell env `STAGING_AUTH_TURNSTILE_EXECUTION=<render|execute>`；默认
  `render`
- `SENTRY_RELEASE` 不作为 dashboard 静态 var 保存；`pnpm --dir apps/public-chat-web
  deploy:staging` 会在 publish 时自动注入 `public-chat-web@staging-<sha>`，只有需要固定
  release 名时才用 `STAGING_SENTRY_RELEASE`

### `apps/campus-web`

campus staging 当前没有 required Worker secret。`SENTRY_DSN` 可下发到
`campus-web-staging` 用于 observability，但不属于 deploy hard gate：

```bash
wrangler secret put SENTRY_DSN --env staging
```

并补齐 deploy shell env：

- `STAGING_CAMPUS_AUTH_TURNSTILE_SITE_KEY=<real admitted sitekey for
  campus-staging.mucwiki-edge.link>`
- 可选 `STAGING_CAMPUS_AUTH_TURNSTILE_APPEARANCE=<always|execute|interaction-only>`；默认
  `interaction-only`
- 可选 `STAGING_CAMPUS_AUTH_TURNSTILE_EXECUTION=<render|execute>`；默认 `render`

说明：

- `STAGING_CAMPUS_AUTH_TURNSTILE_SITE_KEY` 是 auth flow hard gate；空值或 Cloudflare
  testing sitekey 会被 staging preflight 拒绝
- `SENTRY_DSN` 默认与其他 Worker 共用同一个 Sentry project；staging/prod 依赖
  `SENTRY_ENVIRONMENT`，surface 依赖 `surface` tag 区分
- `SENTRY_RELEASE` 不作为 dashboard 静态 var 保存；`pnpm --dir apps/campus-web
  deploy:staging` 会在 publish 时自动注入 `campus-web@staging-<sha>`，只有需要固定
  release 名时才用 `STAGING_SENTRY_RELEASE`

Federation seam note:

- Campus-web only forwards explicit federation seams to `app-api`: well-known
  discovery, `/api/federation/authorize`, `/api/federation/token`,
  `/api/federation/userinfo`, `/api/federation/jwks` and
  `/api/federation/logout`
- Campus-web does not own federation state and does not expose a generic
  `/api/federation/*` or `/api/*` proxy

### `apps/protected-panel-web`

在 `apps/protected-panel-web` 目录执行：

```bash
wrangler secret put PANEL_APP_API_SHARED_SECRET --env staging
wrangler secret put SENTRY_DSN --env staging
```

并补齐：

- `SENTRY_ENVIRONMENT=staging`
- `SENTRY_RELEASE` 不作为 dashboard 静态 var 保存；`pnpm --dir apps/protected-panel-web
  deploy:staging` 会在 publish 时自动注入 `protected-panel-web@staging-<sha>`，只有需要固定
  release 名时才用 `STAGING_SENTRY_RELEASE`

说明：

- `ACCESS_TEAM_DOMAIN` / `ACCESS_POLICY_AUD` 不写回 repo，也不再要求硬编码在 `wrangler.toml`
- staging publish 时通过 shell env `STAGING_ACCESS_TEAM_DOMAIN` /
  `STAGING_ACCESS_POLICY_AUD` 注入当前真实 Access 配置
- staging service-token smoke 使用 ignored shell env
  `STAGING_PANEL_ACCESS_CLIENT_ID` / `STAGING_PANEL_ACCESS_CLIENT_SECRET`；它们只用于
  Cloudflare Access envelope smoke，不代表 human operator identity

## Cross-App Invariants

- `PUBLIC_CHAT_WEB_ORIGIN` 必须精确等于
  `https://chat-staging.mucwiki-edge.link`
- `AUTH_SHELL_ORIGIN` 必须精确等于
  `https://campus-staging.mucwiki-edge.link`
- `AUTH_TURNSTILE_SITE_KEY` 必须是 `chat-staging.mucwiki-edge.link` admitted
  widget 的真实 sitekey；testing sitekey 只允许 local smoke
- `STAGING_CAMPUS_AUTH_TURNSTILE_SITE_KEY` 必须是
  `campus-staging.mucwiki-edge.link` admitted widget 的真实 sitekey；testing
  sitekey 只允许 local smoke
- `AUTH_TURNSTILE_APPEARANCE` / `AUTH_TURNSTILE_EXECUTION` 当前默认应分别收口到
  `interaction-only` / `render`；如 staging 需要临时不同姿态，也只能通过 deploy shell env
  override，不写回 repo 固定值
- `APP_API_END_USER_EMAIL_DOMAIN_ALLOWLIST` 当前应配置为
  `muc.edu.cn`；`APP_API_END_USER_EMAIL_ALLOWLIST` 当前应配置为 `help_bot@outlook.com`
- `APP_API_OPERATOR_EMAIL_ALLOWLIST` 必须覆盖当前真实 panel operator email；缺失时
  `panel-staging` Overview 可能正常，但 `Requests` / `official-web` 会在
  `/api/operator/*` 上收到 `403 operator_identity_not_admitted`
- `APP_API_INTERNAL_SHARED_SECRET` 必须精确等于 `PANEL_APP_API_SHARED_SECRET`
- `APP_API_BASE_URL` 与 `PANEL_RUNTIME_API_BASE_URL` 必须都指向
  `https://app-api.internal`，并通过 Worker `APP_API` Service Binding 调用
  `app-api-staging`
- `APP_API_DB_FRESH` 必须绑定到 caching-disabled Hyperdrive config；staging auth smoke
  必须覆盖 `sign-up -> immediate sign-in`
- `EXECUTION_CONTROL_BASE_URL` 在每次 staging deploy 时都必须显式注入，且当次值必须真实可达
- `STAGING_ACCESS_TEAM_DOMAIN` / `STAGING_ACCESS_POLICY_AUD` 必须都是真实 Access
  值，不能使用 repo 占位默认值
- `app-api /readyz` 必须先 ready，再允许 web surfaces 对外 smoke
- `public-chat-web /readyz` 与 `protected-panel-web /readyz` 会继续探测 shared
  `app-api /readyz`；如果 shared runtime 未 ready，web surfaces 不得标记 green
- `protected-panel-web` 只有在真实浏览器入口已经被 Cloudflare Access 接管时，才能视为 staging deploy
  完成；worker 侧的 `Missing Access JWT.` 只代表入口仍未完成真实保护
- `app-api` 的 shared Postgres schema 必须先与 repo 当前 Drizzle snapshot 以及
  shared-product `app_auth/chat` schema 对齐；`official_web` 或 chat surface 如果在
  staging 同时返回 `internal_error`，优先先检查 `db:bootstrap:staging` /
  `db:reconcile-shared-drift:staging` / `db:migrate:staging`

## Wrangler Auth Recovery

- `pnpm --dir <app> deploy:preflight:staging` 如果在
  `scripts.check_worker_secret_presence` 处报：
  - `Failed to fetch auth token`
  - `Not logged in`
  - `CLOUDFLARE_API_TOKEN` 先不要误判为 Worker secret 缺失。
- 这类错误优先表示本机 `wrangler` 登录态失效或当前 shell 没有 Cloudflare API token。
- 手工环境的恢复命令：

```bash
pnpm --dir apps/app-api exec wrangler login
pnpm --dir apps/public-chat-web exec wrangler login
pnpm --dir apps/protected-panel-web exec wrangler login
```

- CI / automation 不走交互式 OAuth，直接下发 `CLOUDFLARE_API_TOKEN`。
- `scripts.check_worker_secret_presence` 现在会在本机 OAuth metadata
  已过期时，把过期时间和上述恢复动作一并写进错误信息。

## Smoke Identity Contract

- staging smoke 不再依赖浏览器现场 sign-up；固定使用受控 smoke identity，并在需要时通过
  部署态 `app-api-staging` 内部 smoke endpoint 重置密码和清理旧聊天数据
- 当前 repo-tracked staging explicit end-user allowlist 仍固定包含
  `help_bot@outlook.com`；在 deploy env 未扩面前，它仍是 canonical chat smoke identity
- 当前 canonical automation 命令：

```bash
pnpm --dir apps/app-api chat:e2e:staging
pnpm --dir apps/app-api docs:gated:smoke:staging
pnpm --dir apps/app-api federation:smoke:staging
pnpm --dir apps/campus-web account:smoke:staging
```

- `docs:gated:smoke:staging` 默认读取
  `PUBLIC_DOCS_SYNC_MANIFEST_PATH`，未设置时使用 repo-root
  `var/public-docs-sync-manifest.staging.json`；它从 manifest 中选择第一个
  `gated_asset` reader，不再维护硬编码 gated reader path
- gated collection navigation 的匿名期望状态也由同一 manifest 推导：如果同一
  `corpus/collection` 同时存在 `public_static_asset`，匿名 navigation 应为 `200`；
  如果该 collection 只有 gated entry，匿名 navigation 应为 `404`
- 这些命令会在 shell 内生成临时随机密码，通过部署态 `app-api-staging`
  `POST /api/internal/staging-smoke/auth/session` 重置 smoke identity 并铸造真实
  staging session cookie，然后真实请求 `chat-staging.mucwiki-edge.link`、
  `campus-staging.mucwiki-edge.link`
- 如果 `chat:e2e:staging` 返回 `retrieval_failed` 且 supervisor trace 显示
  `qdrant retrieval failed`，不要在 retrieval/read path 增加 collection alias 或兜底查询；
  先在 `nc-arm-6c:/srv/apps/campus-agent` 执行
  `campus_ingestion_worker.probe_regulation_rag_release_runtime`。`qdrant_endpoint_not_ready`
  表示 ops-owned `runtime.env` 的 `STAGING_INGESTION_QDRANT_URL` 不是可用 Qdrant REST
  endpoint，必须修正 endpoint 后再重启 execution runtime。
- `chat:e2e:staging` 默认要求 chat request 返回 `answer`
  (`request.resultKind`)；如果返回 `error` 等 typed outcome，脚本会退出非零并输出对应
  `requestId` / `traceId`，避免把 supervisor timeout 或 upstream failure 误判为通过
- 它们要求当前 shell 有 `APP_API_STAGING_SMOKE_AUTH_SECRET` 或
  `STAGING_APP_API_SMOKE_AUTH_SECRET`；repo-owned wrapper 会自动加载 ignored
  `/srv/docker/campus-agent/staging/env/runtime.env`
- 它不要求本机 staging DB URL，不要求预先提供 `APP_API_SMOKE_IDENTITY_PASSWORD`，
  也不要求 agent 通过真实 Turnstile challenge
- `account:smoke:staging` 是 campus 身份功能链路的 canonical browser
  smoke。它必须在 `nc-arm-6c:/srv/apps/campus-agent` 执行，只访问
  `https://campus-staging.mucwiki-edge.link` 与
  `https://api-staging.mucwiki-edge.link/readyz`，并会拒绝 localhost /
  `127.0.0.1` 目标。它验证 campus 首页、`/account` 未登录态、带真实
  session 后的 account / identity / access / preferences / federation
  disabled 展示、preferences 写入与刷新保持、sign-out 回到未登录态，
  以及 unknown `/api/*` fail closed。
- `account:smoke:staging` 的结果会写入
  `.tmp/identity-acceptance/<timestamp>-campus-account-browser-smoke.md`；这份
  artifact 只记录功能检查和失败点，不评价 UI/UX 视觉设计质量。
- `federation:smoke:staging` 是 MUC Wiki OAuth/OIDC provider 的 canonical
  staging smoke。它必须在 `nc-arm-6c:/srv/apps/campus-agent` 执行，只访问
  `https://campus-staging.mucwiki-edge.link` 与
  `https://api-staging.mucwiki-edge.link/readyz`，并会拒绝 localhost /
  `127.0.0.1` 目标。它验证 discovery、JWKS、staging session mint、
  authorization code + PKCE redirect、token exchange 与 userinfo claims。
- `federation:smoke:staging` 要求当前 shell 有
  `APP_API_FEDERATION_MUC_WIKI_CLIENT_SECRET`，并继续要求
  `APP_API_STAGING_SMOKE_AUTH_SECRET` 或 `STAGING_APP_API_SMOKE_AUTH_SECRET`；
  repo-owned wrapper 会自动加载 ignored `.env.staging.local`。
- `federation:smoke:staging` 的结果会写入
  `.tmp/identity-acceptance/<timestamp>-federation-smoke.md`；artifact
  会记录 redacted authorization redirect，不记录 token、authorization code
  或 client secret。
- 身份验收不得使用 `apps/campus-web dev`、localhost 或本机 Vite
  dev server 作为完成标准；local dev smoke 只服务前端迭代，不替代
  `nc-arm-6c + staging Worker` 验收。
- 低层手动重置命令仍保留：

```bash
APP_API_SMOKE_IDENTITY_PASSWORD='<secret>' \
STAGING_APP_API_OPERATOR_DATABASE_URL=postgresql://<staging-operator-url> \
pnpm --dir apps/app-api smoke-identity:provision:staging -- --email \
  help_bot@outlook.com --name "Help Bot"
```

- 该命令会先清理该邮箱名下旧 `chat` 数据与旧 `app_auth.user` 记录，再通过真实 `/api/auth/sign-up/email`
  路由重建 canonical Better Auth 账号，并清掉脚本执行过程中创建的 session
- browser smoke 只使用这个固定 identity 登录；不要在 staging 页面继续创建 ad-hoc end-user 账号
- 如果未来 staging admit 了专用 `public-chat smoke` 邮箱，应直接复用同一脚本切换到新邮箱，不再改回浏览器临时注册
- 只有在明确做 transport-only 调试时，才允许临时执行
  `pnpm --dir apps/app-api chat:e2e:staging -- --expect-result-kind any`；
  该模式不作为 release / staging closeout gate
- 对真实 admitted Turnstile widget 的最终 staging smoke，必须使用真实浏览器 session；不要把
  Playwright / Selenium / Cypress 的 live-widget 结果当作 closeout gate。Cloudflare 官方
  testing 文档明确说明这些 automation suites 会被 Turnstile 识别为 bot，自动化只适用于 testing
  keys，不适用于真实 staging/prod widget。

## Pre-Deploy Repo Gates

```bash
pnpm --dir apps/app-api test:worker -- --reporter=verbose test/worker.test.ts
pnpm --dir apps/public-chat-web exec vitest run test/worker.test.ts \
  --reporter=verbose
pnpm --dir apps/protected-panel-web exec vitest run test/worker.test.ts \
  --reporter=verbose
```

```bash
pnpm --dir apps/app-api deploy:preflight:staging
pnpm --dir apps/public-chat-web deploy:preflight:staging
pnpm --dir apps/protected-panel-web deploy:preflight:staging
```

可选的本地 readiness 复核：

```bash
env UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m \
  scripts.check_worker_observability_env --json
pnpm --dir apps/app-api test:worker -- --reporter=verbose
pnpm --dir apps/public-chat-web test:worker -- --reporter=verbose -t \
  "smokes a chat request through public-chat-web into app-api"
pnpm --dir apps/protected-panel-web test:worker -- --reporter=verbose -t \
  "smokes request queries through protected-panel-web into app-api with \
  internal caller admission"
```

真实 deploy 前先确认当前 shell 的 Cloudflare 身份可用：

```bash
node scripts/run-wrangler-command.mjs --cwd apps/app-api whoami
```

三个 Worker 的 canonical `pnpm deploy:staging` 入口都会先执行 `deploy:preflight:staging`。
如果 `doctor_env`、`scripts.check_worker_secret_presence`、built config verification
或 `app-api` shared DB drift gate 失败，发布会在真正 `wrangler deploy` 前失败。 repo-owned
Wrangler 入口默认会剥离继承来的代理 env，再直连 Cloudflare API；如果本机存在全局 WSL/Windows
代理，这一步不是可选优化，而是 staging deploy gate 的一部分。

## Deploy Order

### 0. `apps/app-api` shared Postgres schema

先补齐 shared-product bootstrap：

```bash
STAGING_APP_API_OPERATOR_DATABASE_URL=postgresql://<staging-operator-url> \
pnpm --dir apps/app-api db:bootstrap:staging
```

再执行 drift 检查：

```bash
STAGING_APP_API_OPERATOR_DATABASE_URL=postgresql://<staging-operator-url> \
pnpm --dir apps/app-api db:reconcile-shared-drift:staging -- --json
```

如果输出显示 shared DB 仍落后于当前 repo schema，再执行：

```bash
STAGING_APP_API_OPERATOR_DATABASE_URL=postgresql://<staging-operator-url> \
pnpm --dir apps/app-api db:migrate:staging
```

这一步不是可选优化，而是 `official_web` operator surface 的 deploy gate。

Federation client provision 必须在 shared DB bootstrap / migrate / drift
收敛后执行：

```bash
APP_API_FEDERATION_MUC_WIKI_CLIENT_SECRET='<secret>' \
APP_API_FEDERATION_MUC_WIKI_REDIRECT_URI='https://muc.wiki/wiki/'\
'Special:PluggableAuthLogin' \
APP_API_FEDERATION_MUC_WIKI_POST_LOGOUT_REDIRECT_URI='https://muc.wiki/wiki/'\
'Special:UserLogout' \
STAGING_APP_API_OPERATOR_DATABASE_URL=postgresql://<staging-operator-url> \
pnpm --dir apps/app-api federation:provision-muc-wiki:staging
```

该命令同步两层 truth：

- `identity.federation_clients` 与 `identity.federation_claims_policies`：
  app-owned product policy
- `app_auth.oauthClient`：Better Auth provider runtime client record

不要通过 browser UI、MediaWiki 或 Better Auth public client CRUD endpoint 创建首期
`muc-wiki` client。

### 1. `apps/app-api`

```bash
STAGING_EXECUTION_CONTROL_BASE_URL=https://<current-supervisor-upstream> \
pnpm --dir apps/app-api deploy:staging
```

确认：

- `https://api-staging.mucwiki-edge.link/healthz`
- `https://api-staging.mucwiki-edge.link/readyz`

Federation discovery / JWKS 确认通过 campus staging origin：

```bash
curl -fsS https://campus-staging.mucwiki-edge.link/.well-known/openid-configuration
curl -fsS https://campus-staging.mucwiki-edge.link/api/federation/jwks
pnpm --dir apps/app-api federation:smoke:staging
```

discovery response issuer 必须是 `https://campus-staging.mucwiki-edge.link`，且
advertised federation endpoints 必须在同一 origin 下。

### 2. `apps/public-chat-web`

```bash
pnpm --dir apps/public-chat-web deploy:staging
```

确认：

- `https://chat-staging.mucwiki-edge.link/healthz`
- `https://chat-staging.mucwiki-edge.link/readyz`

### 3. `apps/protected-panel-web`

```bash
STAGING_ACCESS_TEAM_DOMAIN=https://<current-access-team-domain> \
STAGING_ACCESS_POLICY_AUD=<current-access-policy-aud> \
pnpm --dir apps/protected-panel-web deploy:staging
```

确认：

- `https://panel-staging.mucwiki-edge.link/healthz`
- `https://panel-staging.mucwiki-edge.link/readyz`

Access service-token envelope smoke:

```bash
STAGING_PANEL_ACCESS_CLIENT_ID=<access-service-token-client-id> \
STAGING_PANEL_ACCESS_CLIENT_SECRET=<access-service-token-client-secret> \
pnpm --dir apps/protected-panel-web access:smoke:staging
```

该 smoke 的预期是：

- 不带 service token 的 `/readyz` 返回 Cloudflare Access redirect
- 带 service token 的 `/healthz` 与 `/readyz` 返回 `200`
- 带 service token 的 `/api/overview` 仍返回 `401 Invalid Access JWT.`

最后一条是当前边界：Access service token 只证明 protected panel envelope
可由 automation 到达，不被投射为 human operator identity。

## Post-Deploy Verification

### MediaWiki OIDC relying-party rehearsal

Production `muc.wiki` login federation 只有在 `nc-arm-6c` 上完成 staging /
rehearsal smoke 后才能视为 ready。首期 MediaWiki posture：

- install and enable `PluggableAuth`
- install and enable `OpenIDConnect`
- provider URL:
  - staging: `https://campus-staging.mucwiki-edge.link`
  - production: `https://campus.muc.wiki`
- client ID: `muc-wiki`
- client secret: runtime secret, matching the app-api provision input
- scope: `openid profile email`
- code challenge method: `S256`
- auth method: `client_secret_basic`
- callback / redirect URI: full MediaWiki `Special:PluggableAuthLogin` URL,
  matching `identity.federation_clients.redirect_uris_json`

Forbidden integration shapes:

- no shared `.muc.wiki` cookie
- no MediaWiki user/password/session import into app-api
- no app-api import of MediaWiki groups, page permissions, content or media
- no browser-shell-owned provider state or federation admin UI

Smoke flow:

1. Open `Special:UserLogin`.
2. Start OpenID Connect login.
3. Redirect to campus/app-api authorization route.
4. Sign in with existing campus/app-api auth.
5. Return to `Special:PluggableAuthLogin`.
6. Verify wiki-local account creation or linking by OIDC subject/email.
7. Verify wiki-local logout.
8. Verify provider end-session only with an admitted post-logout redirect URI.

部署完成后，按 `docs/runbooks/worker-observability-smoke-runbook.md` 执行：

- `public-chat-web -> app-api`
- `protected-panel-web -> app-api`
- `app-api` controlled error
- `app-api` scheduled / projection drain

证据应落盘到：

- `.tmp/observability-smoke/<timestamp>/SUMMARY.md`
- `.tmp/observability-smoke/<timestamp>/sentry-trace-notes.md`
- `.tmp/observability-smoke/<timestamp>/axiom-runtime-events.md`

这轮 staging 的 `SUMMARY.md` 至少应写明：

- Environment: `staging`
- `public-chat-web` hostname: `chat-staging.mucwiki-edge.link`
- `protected-panel-web` hostname: `panel-staging.mucwiki-edge.link`
- `app-api` hostname: `api-staging.mucwiki-edge.link`
- Worker release: `<release>`
- panel operator smoke identity
- 如果 `panel-staging.mucwiki-edge.link` 的 `/api/operator/*` 返回 `401/403`，对应的 `error.code`
  与判定结果

## Exit Criteria

以下条件同时满足，才算 staging deploy 准备完成：

- repo 内 `staging` deploy config、脚本和测试全部落地
- Cloudflare custom domains / service bindings / Hyperdrive / Access 全部
  provision 完成
- 三个 Worker 已成功 deploy 到 staging
- 三个 `/readyz` 均为 ready
- post-deploy observability smoke 已落盘，并在 Sentry/Axiom 中确认真实 trace / runtime
  event 已进入 sink
