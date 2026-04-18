---
doc_type: runbook
status: active
created: 2026-04-04
updated: 2026-04-19
---

# Staging Worker Deploy Runbook

## 用途

这份 runbook 固定首个真实 Worker 部署环境的最小执行面：

- environment: `staging`
- zone: `ayafeed.com`
- staging hostname shape: `ayafeed.com` 下一级子域
- `apps/app-api`: `https://campus-api-staging.ayafeed.com`
- `apps/public-chat-web`: `https://campus-chat-staging.ayafeed.com`
- `apps/protected-panel-web`: `https://campus-panel-staging.ayafeed.com`

它只回答：

- 当前 repo 应该如何表达 `staging` deploy truth
- Cloudflare 侧需要先 provision 哪些资源
- 首次 deploy 前后各要执行什么

它不回答长期 production hostname；未来切换到 `muc.wiki` 时，应新增 `production` env，而不是覆写这里的 `staging` truth。

当前补充真相：

- 在真正的 production execution substrate 上线前，`staging` 的 execution upstream accepted posture 就是这台开发机上的 dev-backed supervisor
- 这条主机级运维姿势、计划任务、自愈与日志规则统一记录在 `dev-backed-supervisor-staging-operations.md`

## Hostname Constraint

- 当前 Cloudflare tier 下，不再把 `*.rag.ayafeed.com` 这类深一级 staging custom domain 视为可依赖的 SSL deploy truth
- `ayafeed.com` 是共享 zone，generic 一级子域（例如 `api-staging.ayafeed.com`）不再视为本 repo 可占用的 deploy truth
- staging forward truth 必须统一使用 `ayafeed.com` 下的项目隔离一级子域：`campus-api-staging.ayafeed.com`、`campus-chat-staging.ayafeed.com`、`campus-panel-staging.ayafeed.com`
- repo 中仍残留的 `*.rag.ayafeed.com` staging 配置、脚本断言或测试断言，只能视为待迁移实现残留，不能继续作为新资源 provision 或 deploy 目标
- 依据：Cloudflare 官方文档说明 Universal SSL 默认覆盖 apex 与一级子域，更深层级需依赖不同证书能力，因此当前 tier 下不再继续使用嵌套 staging 子域
  - <https://developers.cloudflare.com/fundamentals/setup/manage-domains/manage-subdomains/>

## Repo-Owned Config

当前 repo 仍存在旧的 `*.rag.ayafeed.com` staging 引用；本节描述的是必须收敛到的前向 deploy truth，而不是这些旧值的继续合法化。

- `apps/app-api/wrangler.toml`
  - `env.staging` 应收敛到 `campus-api-staging.ayafeed.com`
  - `env.staging.hyperdrive` 持有 `APP_API_DB`（cached/read-mostly）与 `APP_API_DB_FRESH`（no-cache/auth-sensitive）两条 staging binding
  - `env.staging.vars.PUBLIC_CHAT_WEB_ORIGIN=https://campus-chat-staging.ayafeed.com`
- `apps/app-api/package.json`
  - `pnpm deploy:staging` 要求显式注入 `STAGING_SUPERVISOR_API_BASE_URL`
  - `pnpm deploy:preflight:staging` 是 canonical preflight：固定执行 `doctor_env worker-staging-app-api`、Cloudflare secret presence、repo-owned staging config verification 与 `db:reconcile-shared-drift:staging`
  - deploy 时通过 `--var SUPERVISOR_API_BASE_URL:<url>` 注入当前 dev-backed supervisor upstream
  - `pnpm deploy:staging` 会在 publish 时自动注入 `SENTRY_RELEASE=app-api@staging-<sha>`；只有需要固定 release 名时才覆写 `STAGING_SENTRY_RELEASE`
  - 真实 deploy 直接使用当前 shell 的 `wrangler` 登录态；repo-local `.wrangler-home` 只保留给 dev/test
- `apps/public-chat-web/wrangler.toml`
  - `env.staging` 应收敛到 `campus-chat-staging.ayafeed.com`
  - `env.staging.services.APP_API -> app-api-staging`
  - `env.staging.vars.APP_API_BASE_URL=https://campus-api-staging.ayafeed.com`
- `apps/public-chat-web/package.json`
  - `pnpm build:staging` 使用 `CLOUDFLARE_ENV=staging`
  - `pnpm deploy:preflight:staging` 是 canonical preflight：固定执行 `doctor_env worker-staging-public-chat-web`、Cloudflare secret presence、staging build 与 built config verification
  - `pnpm deploy:staging` 发布 staging build artifact，并在 publish 时自动注入 `SENTRY_RELEASE=public-chat-web@staging-<sha>`
  - deploy 使用当前 shell 的 `wrangler` 登录态，不再强绑 repo-local `.wrangler-home`
- `apps/protected-panel-web/wrangler.toml`
  - `env.staging` 应收敛到 `campus-panel-staging.ayafeed.com`
  - `env.staging.services.APP_API -> app-api-staging`
  - `env.staging.vars.PANEL_RUNTIME_API_BASE_URL=https://campus-api-staging.ayafeed.com`
  - `env.staging.vars` 只保留 non-secret runtime truth；`ACCESS_TEAM_DOMAIN` / `ACCESS_POLICY_AUD` 不再硬编码在 repo
- `apps/protected-panel-web/package.json`
  - `pnpm build:staging` 使用 `CLOUDFLARE_ENV=staging`
  - `pnpm deploy:preflight:staging` 是 canonical preflight：固定执行 `doctor_env worker-staging-protected-panel-web`、Cloudflare secret presence、staging build 与 built config verification
  - `pnpm deploy:staging` 通过 `scripts/deploy-staging.mjs` 发布 staging build artifact
  - deploy 时必须显式注入 `STAGING_ACCESS_TEAM_DOMAIN` 与 `STAGING_ACCESS_POLICY_AUD`
  - deploy 脚本会自动把当前 git commit 注入 runtime `SENTRY_RELEASE=protected-panel-web@staging-<sha>`；仅在需要覆写时才显式传入 `STAGING_SENTRY_RELEASE`
  - deploy 脚本会拒绝 `https://team.cloudflareaccess.com` / `panel-audience` 这类占位值
  - deploy 使用当前 shell 的 `wrangler` 登录态，不再强绑 repo-local `.wrangler-home`

说明：

- Wrangler environment 会把 Worker service 名派生为 `<name>-staging`
- 因此 staging web surfaces 必须绑定到 `app-api-staging`，不是 top-level `app-api`

## Cloudflare Provisioning Checklist

### 1. Worker hostnames

- 创建 `campus-api-staging.ayafeed.com` custom domain，绑定到 `app-api-staging`
- 创建 `campus-chat-staging.ayafeed.com` custom domain，绑定到 `public-chat-web-staging`
- 创建 `campus-panel-staging.ayafeed.com` custom domain，绑定到 `protected-panel-web-staging`

### 2. Internal service bindings

- `public-chat-web-staging`
  - `APP_API -> app-api-staging`
- `protected-panel-web-staging`
  - `APP_API -> app-api-staging`

### 3. Database

- 为 `app-api-staging` provision `APP_API_DB` Hyperdrive binding
- 为 `app-api-staging` provision `APP_API_DB_FRESH` Hyperdrive binding，并显式关闭 SQL response caching
- 把真实 staging Hyperdrive resource id 写入 `apps/app-api/wrangler.toml` 的 `[[env.staging.hyperdrive]]`
- 确认 staging Postgres 对 Hyperdrive 可达
- 单独准备 staging shared Postgres 的 operator/session-pooler 连接串，供 Drizzle migration / drift reconciliation 使用
- `Hyperdrive` 只覆盖 Worker runtime query path，不替代 deploy 前 schema migration
- `APP_API_DB` 负责 read-mostly/cached query path；`APP_API_DB_FRESH` 负责 auth 与其他 read-after-write-sensitive product path，避免 `sign-up -> immediate sign-in` 被 stale negative lookup 污染

### 4. Access

- 为 `campus-panel-staging.ayafeed.com` 建 Cloudflare Access application
- 生成并记录：
  - `ACCESS_TEAM_DOMAIN`
  - `ACCESS_POLICY_AUD`
- 确认 staging operator principal 有可用登录路径
- deploy `protected-panel-web` 时，把这两个值显式映射到 `STAGING_ACCESS_TEAM_DOMAIN` / `STAGING_ACCESS_POLICY_AUD`
- 判定 Access provision 完成的标准不是 `panel /readyz = 200`；真实浏览器首次访问必须先经过 Cloudflare Access 准入，不能停留在 worker 直接返回 `401 Missing Access JWT.`

### 5. Supervisor upstream

- 当前阶段不冻结 `apps/supervisor-api` 的 repo-level staging hostname
- `apps/app-api` staging deploy 时必须显式注入一个真实可达的 execution upstream
- 当前 accepted staging posture 不是 ad-hoc quick tunnel；而是这台开发机通过 named tunnel `supervisor-api-staging` 持续承接 `https://exec-staging.ayafeed.com`
- 只要 production execution substrate 还没有接管，staging operator 就应优先维护这台开发机上的长期常驻链路，而不是每轮重新发一个随机 quick tunnel
- 这个 upstream 可以来自：
  - 本地 `uv run --all-packages campus-supervisor-api-dev` + tunnel
  - 本地 Docker `supervisor-api` + tunnel
  - 其他临时 dev-backed execution origin
- `127.0.0.1` 只能留在本地 process truth，不能作为 Cloudflare staging deploy truth
- 当前这台开发机的常驻安装、冷启动恢复与 `status --check` health gate，见 `docs/runbooks/dev-backed-supervisor-staging-operations.md`

## Secret Matrix

### `apps/app-api`

在 `apps/app-api` 目录执行：

```bash
wrangler secret put BETTER_AUTH_SECRET --env staging
wrangler secret put SUPERVISOR_API_SHARED_SECRET --env staging
wrangler secret put APP_API_INTERNAL_SHARED_SECRET --env staging
wrangler secret put SENTRY_DSN --env staging
wrangler secret put AXIOM_TOKEN --env staging
```

只有当当前 staging 同时启用 `official-web-collector -> app-api` live control-plane seam 时，才额外下发：

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
- `STAGING_APP_API_MANAGEMENT_DATABASE_URL`（legacy alias）
- 可选：`STAGING_APP_API_DATABASE_SSLMODE=require`
- staging smoke identity reset 时，shell 还需要 `APP_API_SMOKE_IDENTITY_PASSWORD`

要求：

- `APP_API_OPERATOR_EMAIL_ALLOWLIST` 必须显式包含当前 panel smoke / operator Access 身份；当前 staging 至少需要 `help_bot@outlook.com`
- 如果该 allowlist miss，`/api/operator/*` 会返回 `403 operator_identity_not_admitted`，这是 operator admission 配置问题，不是 Access session 失效
- `SENTRY_RELEASE` 不作为 dashboard 静态 var 保存；`pnpm deploy:staging` 会在 publish 时自动注入 `app-api@staging-<sha>`，只有需要固定 release 名时才用 `STAGING_SENTRY_RELEASE`
- `APP_API_SMOKE_IDENTITY_PASSWORD` 只作为 shell / secret store 输入供 `pnpm --dir apps/app-api smoke-identity:provision:staging` 使用；不要把它写入 repo、runbook 产物或浏览器抓包摘要
- `APP_API_OFFICIAL_WEB_COLLECTOR_TOKEN` 不属于当前最小 staging chat/panel/app-api 闭环的必填项；它只在你准备同时验收 official-web live control-plane 时才应视为当前环境 gate

### `apps/public-chat-web`

在 `apps/public-chat-web` 目录执行：

```bash
wrangler secret put SENTRY_DSN --env staging
```

并补齐：

- `SENTRY_ENVIRONMENT=staging`
- `SENTRY_RELEASE` 不作为 dashboard 静态 var 保存；`pnpm --dir apps/public-chat-web deploy:staging` 会在 publish 时自动注入 `public-chat-web@staging-<sha>`，只有需要固定 release 名时才用 `STAGING_SENTRY_RELEASE`

### `apps/protected-panel-web`

在 `apps/protected-panel-web` 目录执行：

```bash
wrangler secret put PANEL_APP_API_SHARED_SECRET --env staging
wrangler secret put SENTRY_DSN --env staging
```

并补齐：

- `SENTRY_ENVIRONMENT=staging`
- `SENTRY_RELEASE` 不作为 dashboard 静态 var 保存；`pnpm --dir apps/protected-panel-web deploy:staging` 会在 publish 时自动注入 `protected-panel-web@staging-<sha>`，只有需要固定 release 名时才用 `STAGING_SENTRY_RELEASE`

说明：

- `ACCESS_TEAM_DOMAIN` / `ACCESS_POLICY_AUD` 不写回 repo，也不再要求硬编码在 `wrangler.toml`
- staging publish 时通过 shell env `STAGING_ACCESS_TEAM_DOMAIN` / `STAGING_ACCESS_POLICY_AUD` 注入当前真实 Access 配置

## Cross-App Invariants

- `PUBLIC_CHAT_WEB_ORIGIN` 必须精确等于 `https://campus-chat-staging.ayafeed.com`
- `APP_API_END_USER_EMAIL_DOMAIN_ALLOWLIST` 当前应配置为 `muc.edu.cn`；`APP_API_END_USER_EMAIL_ALLOWLIST` 当前应配置为 `help_bot@outlook.com`
- `APP_API_OPERATOR_EMAIL_ALLOWLIST` 必须覆盖当前真实 panel operator email；缺失时 `panel-staging` Overview 可能正常，但 `Requests` / `official-web` 会在 `/api/operator/*` 上收到 `403 operator_identity_not_admitted`
- `APP_API_INTERNAL_SHARED_SECRET` 必须精确等于 `PANEL_APP_API_SHARED_SECRET`
- `APP_API_BASE_URL` 与 `PANEL_RUNTIME_API_BASE_URL` 必须都指向 `https://campus-api-staging.ayafeed.com`
- `APP_API_DB_FRESH` 必须绑定到 caching-disabled Hyperdrive config；staging auth smoke 必须覆盖 `sign-up -> immediate sign-in`
- `SUPERVISOR_API_BASE_URL` 在每次 staging deploy 时都必须显式注入，且当次值必须真实可达
- `STAGING_ACCESS_TEAM_DOMAIN` / `STAGING_ACCESS_POLICY_AUD` 必须都是真实 Access 值，不能使用 repo 占位默认值
- `app-api /readyz` 必须先 ready，再允许 web surfaces 对外 smoke
- `public-chat-web /readyz` 与 `protected-panel-web /readyz` 会继续探测 shared `app-api /readyz`；如果 shared runtime 未 ready，web surfaces 不得标记 green
- `protected-panel-web` 只有在真实浏览器入口已经被 Cloudflare Access 接管时，才能视为 staging deploy 完成；worker 侧的 `Missing Access JWT.` 只代表入口仍未完成真实保护
- `app-api` 的 shared Postgres schema 必须先与 repo 当前 Drizzle snapshot 对齐；`official_web` 相关列表如果在 staging 同时返回 `internal_error`，优先先检查 `db:reconcile-shared-drift:staging` / `db:migrate:staging`

## Smoke Identity Contract

- `public-chat` staging smoke 不再依赖浏览器现场 sign-up；固定使用受控 smoke identity，并在需要时通过 repo-owned 脚本重置密码和清理旧聊天数据
- 当前 repo-tracked staging explicit end-user allowlist 仍固定包含 `help_bot@outlook.com`；在 deploy env 未扩面前，它仍是 canonical chat smoke identity
- 重置命令：

```bash
APP_API_SMOKE_IDENTITY_PASSWORD='<secret>' \
STAGING_APP_API_OPERATOR_DATABASE_URL=postgresql://<staging-operator-url> \
pnpm --dir apps/app-api smoke-identity:provision:staging -- --email help_bot@outlook.com --name "Help Bot"
```

- 该命令会先清理该邮箱名下旧 `chat` 数据与旧 `app_auth.user` 记录，再通过真实 `/api/auth/sign-up/email` 路由重建 canonical Better Auth 账号，并清掉脚本执行过程中创建的 session
- browser smoke 只使用这个固定 identity 登录；不要在 staging 页面继续创建 ad-hoc end-user 账号
- 如果未来 staging admit 了专用 `public-chat smoke` 邮箱，应直接复用同一脚本切换到新邮箱，不再改回浏览器临时注册

## Pre-Deploy Repo Gates

```bash
pnpm --dir apps/app-api test:worker -- --reporter=verbose test/worker.test.ts
pnpm --dir apps/public-chat-web exec vitest run test/worker.test.ts --reporter=verbose
pnpm --dir apps/protected-panel-web exec vitest run test/worker.test.ts --reporter=verbose
```

```bash
pnpm --dir apps/app-api deploy:preflight:staging
pnpm --dir apps/public-chat-web deploy:preflight:staging
pnpm --dir apps/protected-panel-web deploy:preflight:staging
```

可选的本地 readiness 复核：

```bash
env UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m scripts.check_worker_observability_env --json
pnpm --dir apps/app-api test:worker -- --reporter=verbose
pnpm --dir apps/public-chat-web test:worker -- --reporter=verbose -t "smokes a chat request through public-chat-web into app-api"
pnpm --dir apps/protected-panel-web test:worker -- --reporter=verbose -t "smokes request queries through protected-panel-web into app-api with internal caller admission"
```

真实 deploy 前先确认当前 shell 的 Cloudflare 身份可用：

```bash
node scripts/run-wrangler-command.mjs --cwd apps/app-api whoami
```

三个 Worker 的 canonical `pnpm deploy:staging` 入口都会先执行 `deploy:preflight:staging`。
如果 `doctor_env`、`scripts.check_worker_secret_presence`、built config verification 或 `app-api` shared DB drift gate 失败，发布会在真正 `wrangler deploy` 前失败。
repo-owned Wrangler 入口默认会剥离继承来的代理 env，再直连 Cloudflare API；如果本机存在全局 WSL/Windows 代理，这一步不是可选优化，而是 staging deploy gate 的一部分。

## Deploy Order

### 0. `apps/app-api` shared Postgres schema

先执行 drift 检查：

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

### 1. `apps/app-api`

```bash
STAGING_SUPERVISOR_API_BASE_URL=https://<current-supervisor-upstream> \
pnpm --dir apps/app-api deploy:staging
```

确认：

- `https://campus-api-staging.ayafeed.com/healthz`
- `https://campus-api-staging.ayafeed.com/readyz`

### 2. `apps/public-chat-web`

```bash
pnpm --dir apps/public-chat-web deploy:staging
```

确认：

- `https://campus-chat-staging.ayafeed.com/healthz`
- `https://campus-chat-staging.ayafeed.com/readyz`

### 3. `apps/protected-panel-web`

```bash
STAGING_ACCESS_TEAM_DOMAIN=https://<current-access-team-domain> \
STAGING_ACCESS_POLICY_AUD=<current-access-policy-aud> \
pnpm --dir apps/protected-panel-web deploy:staging
```

确认：

- `https://campus-panel-staging.ayafeed.com/healthz`
- `https://campus-panel-staging.ayafeed.com/readyz`

## Post-Deploy Verification

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
- `public-chat-web` hostname: `campus-chat-staging.ayafeed.com`
- `protected-panel-web` hostname: `campus-panel-staging.ayafeed.com`
- `app-api` hostname: `campus-api-staging.ayafeed.com`
- Worker release: `<release>`
- panel operator smoke identity
- 如果 `campus-panel-staging` 的 `/api/operator/*` 返回 `401/403`，对应的 `error.code` 与判定结果

## Exit Criteria

以下条件同时满足，才算 staging deploy 准备完成：

- repo 内 `staging` deploy config、脚本和测试全部落地
- Cloudflare custom domains / service bindings / Hyperdrive / Access 全部 provision 完成
- 三个 Worker 已成功 deploy 到 staging
- 三个 `/readyz` 均为 ready
- post-deploy observability smoke 已落盘，并在 Sentry/Axiom 中确认真实 trace / runtime event 已进入 sink
