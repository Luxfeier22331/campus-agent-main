---
doc_type: index
truth_scope: ops
owner_boundary: docs/environment
status: active
created: 2026-06-13
updated: 2026-06-13
---

# Provider And Secret Inventory App And Edge Providers

<!-- markdownlint-disable MD013 -->

Split from the former mega-doc during documentation SoT cleanup. This file
owns this section group; the original path remains the stable index.

## 6. Cloudflare Turnstile

默认放置位置：

- `apps/app-api/.dev.vars` 或 Cloudflare Worker secret store：
  - `AUTH_TURNSTILE_SECRET_KEY`
- `apps/campus-web/.dev.vars` 或 `apps/campus-web/wrangler.toml`
  `env.<name>.vars`：
  - `AUTH_TURNSTILE_SITE_KEY`
  - `AUTH_TURNSTILE_APPEARANCE`
  - `AUTH_TURNSTILE_EXECUTION`

当前 repo 约束：

- `AUTH_TURNSTILE_SECRET_KEY` 只供 `apps/app-api` Better Auth captcha plugin
  使用，不能下沉到浏览器
- `AUTH_TURNSTILE_SITE_KEY` 是公开 runtime string，由 `campus-web` Worker 注入
  public auth shell
- `AUTH_TURNSTILE_APPEARANCE` / `AUTH_TURNSTILE_EXECUTION` 是公开 runtime posture，由
  `campus-web` Worker 注入 auth shell；默认分别是 `interaction-only` / `render`
- Cloudflare widget `mode` 仍是 dashboard/widget truth，不在 repo 内复制一套
  `managed/non-interactive/invisible` 逻辑；repo 只表达 runtime `appearance/execution`
- staging deploy 不再把 `AUTH_TURNSTILE_SITE_KEY` / `AUTH_TURNSTILE_APPEARANCE` /
  `AUTH_TURNSTILE_EXECUTION` 固定在 repo；当前 operator posture 通过 deploy shell env
  注入真实 admitted sitekey 与可选 posture override
- captcha 只保护 `sign-in`、`sign-up`、`request-password-reset`
- local smoke 可使用 Cloudflare 官方 testing credentials；staging / production 必须换成目标
  hostname admitted 的真实 widget 配置
- Playwright / Selenium / Cypress 这类 automation suites 只允许搭配 Cloudflare testing
  credentials；对于真实 admitted staging / production widget，最终 smoke 必须使用真实浏览器
  session，而不是 automation browser
- production 前向 posture 固定为：使用 Cloudflare `Managed` widget，并配合
  `AUTH_TURNSTILE_APPEARANCE=interaction-only`、`AUTH_TURNSTILE_EXECUTION=render`
  达成 always-on verification + elevated-risk-only interactive challenge

获取方式：

1. 在 Cloudflare Dashboard 打开 `Turnstile`，为目标环境创建 widget。
1. 记录 widget 的 sitekey，填到 `AUTH_TURNSTILE_SITE_KEY`。
1. 记录 widget 的 secret key，填到 `AUTH_TURNSTILE_SECRET_KEY`。
1. 如需调整可见性或执行时机，再按需要设置 `AUTH_TURNSTILE_APPEARANCE` /
   `AUTH_TURNSTILE_EXECUTION`；未设置时默认是 `interaction-only` / `render`。
1. staging / prod 分环境独立建 widget，不要复用本地 testing credentials。

外部参考：

- <https://developers.cloudflare.com/turnstile/get-started/>
- <https://developers.cloudflare.com/turnstile/troubleshooting/testing/>

说明：

- repo 的架构语义是 `S3-compatible object storage`，不是某个特定云厂商
- bucket 命名是 repo truth；provider 品牌不是 repo truth

## 6. OCR provider

OCR 只属于 ingestion / replay / compare，不属于在线 query serving。

默认放置位置：

- 命令级 override 放在 `env/commands/*.env.example`
- domain/runtime config 持有 lane 级模型和 tuning

相关键：

- `OCR_BASE_URL`
- `OCR_API_KEY`
- `OCR_PROVIDER_MODE`
- `OCR_MODEL`
- `OCR_LANGUAGE`
- `OCR_ENABLE_FORMULA`
- `OCR_FORCE_OCR`
- `OCR_POLL_SECONDS`
- `OCR_TIMEOUT_SECONDS`
- `OCR_MINERU_BASE_URL`
- `OCR_MINERU_API_KEY`
- `OCR_MINERU_PROVIDER_MODE`
- `OCR_MINERU_MODEL`
- `OCR_MINERU_LANGUAGE`
- `OCR_MINERU_ENABLE_FORMULA`
- `OCR_MINERU_FORCE_OCR`
- `OCR_MINERU_POLL_SECONDS`
- `OCR_MINERU_TIMEOUT_SECONDS`

当前获取方式分两类：

- active OCR lane：
  - `OCR_PROVIDER_MODE` 必须显式写明当前命令实际使用的 provider
  - 当前可以是 Paddle provider，也可以是 `mineru_api`
  - 需要团队已部署好的 endpoint 与 service token
- additional MinerU lane：
  - `OCR_MINERU_PROVIDER_MODE=mineru_api`
  - 当前用于 task-registry-declared source-truth materialization 的
    `source_truth_only` 条件式 typed-PDF 路由、`generic_image` 双跑判型，
    以及内部 OCR 对比诊断模块
  - 它是 lane-specific 补充配置，不再代表 repo 级 “second provider canonical truth”

相关内部文档：

- [../../../apps/ingestion-worker/README.md](../../../apps/ingestion-worker/README.md)
- [../../decisions/adr-0033-internal-notice-pdf-cloud-ocr-default.md](../../decisions/
  adr-0033-internal-notice-pdf-cloud-ocr-default.md)

外部参考：

- MinerU API / model docs：<https://mineru.net/doc/docs/index_en/>
- MinerU output
  files（`full.md`、`content_list*.json`、`layout.json`）：<<https://ope>
  ndatalab.github.io/MinerU/reference/output_files/>

说明：

- active `OCR_*` lane 当前是 team-owned endpoint contract，不是 repo 内置的公共 SaaS 开户流程
- `OCR_PROVIDER_MODE=mineru_api` 已可作为 task-registry-declared extraction lane
  的 active provider；canonical lane 仍由 typed route 决定，不由 env 的“谁是
  primary”反向定义
- `OCR_MINERU_*` 现在只是受控补充入口：当前 repo 把它接入
  `source_truth_only` 的 typed-PDF 条件路由与 `generic_image` 双跑判型，并在
  MinerU 胜出时额外保留 `provider-response-raw.zip` provenance sidecar；
  `ocr-routing-decision.json` 会记录双跑后的 refined asset type 与 canonical
  provider 选择
- MinerU 官方文档虽然支持 Office 类型，但当前 repo 的 canonical raw-ingestion 归一化和
  split-manifest 仍是 PDF/image-first，因此 Office 接入继续归入 follow-up，不在当前默认 canonical
  scope

## 6A. FeedWe Public WeChat Article Acquisition

当前 owner：

- `wechat-official-account-public-source-channel` workstream

当前冻结用途：

- `wechat_official_account` public source channel acquisition
- 公众号公开文章进入 notice consumption 的上游采集

默认放置位置：

- `apps/wechat-official-account-collector/.env`
- production scheduler / deploy-side secret store

相关键：

- `FEEDWE_EMAIL`
- `FEEDWE_PASSWORD`
- `FEEDWE_BASE_URL`（当前 runtime 基线 `https://www.feedwe.top`）
- `WECHAT_OFFICIAL_ACCOUNT_APP_API_BASE_URL`
- `WECHAT_OFFICIAL_ACCOUNT_SERVICE_TOKEN`

获取方式：

1. 从 operator-managed credential store 获取 FeedWe 登录邮箱和密码。
1. 本地验证时只把凭证放到未跟踪的 `.env` 或命令级环境变量。
1. 生产调度时放入 deploy-side secret store，不写入 tracked config。

外部参考：

- FeedWe Apifox docs: <https://feedwe.apifox.cn/390426961e0>

说明：

- FeedWe 是 acquisition provider，不是 canonical truth owner。
- Provider response 只承担 discovery / audit；canonical body 与 media 必须来自后续的真实
  `mp.weixin.qq.com` 页面抓取。
- Provider response 必须先镜像进现有 MinIO-backed source bucket，并只通过 app-api
  control-plane 记录 artifact refs，再进入 notice consumption。
- 当前 accepted authenticated path 为 web API 登录流：`POST /api/auth/login` ->
  `GET /api/auth/me` -> `GET /api/subscriptions` -> `GET /api/articles`。
- `FEEDWE_EMAIL` / `FEEDWE_PASSWORD` 是高敏感 secret，不得进入 logs、planning docs、fixture
  或 sample output。

## 7. Better Auth

当前 merged truth 不要求任何 GitHub / Google / WeChat OAuth provider key。

`app-api` 当前只启用了：

- `emailAndPassword.enabled = true`
- `emailAndPassword.sendResetPassword`
- `emailAndPassword.onPasswordReset`

默认放置位置：

- `apps/app-api/.dev.vars`
- deploy-side secret store

相关键：

- `BETTER_AUTH_SECRET`

获取方式：

1. 自行生成高熵 secret。
1. 长度至少 32 个字符。
1. 推荐直接使用： `openssl rand -base64 32`

外部参考：

- <https://www.better-auth.com/docs/installation>

说明：

- 这不是第三方平台发的 credential
- 如果未来重新引入 social provider，再额外为对应 provider 增加 client ID / secret；那是未来范围，不是当前
  merged truth

## 7B. Resend Transactional Auth Mail

当前 owner：

- `apps/app-api`

当前冻结用途：

- Better Auth password reset email
- password changed confirmation email

默认放置位置：

- `apps/app-api/.dev.vars`
- deploy-side secret store

相关键：

- `RESEND_API_KEY`
- `AUTH_RESET_EMAIL_FROM`
- `AUTH_RESET_EMAIL_REPLY_TO`（可选）

获取方式：

1. 在 Resend dashboard 创建 API key。
1. 准备一个已验证的 sender identity，填入 `AUTH_RESET_EMAIL_FROM`。
1. 只有在需要独立 reply-to 地址时，才填写 `AUTH_RESET_EMAIL_REPLY_TO`。

外部参考：

- <https://resend.com/docs/send-with-cloudflare-workers>

说明：

- 当前 repo 把 end-user auth transactional mail provider 冻结为 `Resend over HTTPS`，因为
  `app-api` 的 canonical runtime 是 Cloudflare Worker，而不是 SMTP-only runtime
- `AUTH_RESET_EMAIL_FROM` 虽然不是高敏感 secret，但当前仍建议和 deploy secret store
  一起治理，避免把环境特定 sender identity 冻结进 repo 配置
- 如果未来要替换 provider，必须同步更新 `apps/app-api` runtime、deploy runbook 与这份 inventory
  truth

## 7A. Safety Identifier HMAC Secret

当前 owner：

- `apps/app-api`

默认放置位置：

- `apps/app-api/.dev.vars`
- deploy-side secret store

相关键：

- `APP_API_SAFETY_IDENTIFIER_HMAC_SECRET`

获取方式：

1. 自行生成高熵 secret。
1. 长度至少 32 个字符。
1. 推荐直接使用： `openssl rand -base64 32`

说明：

- 这不是第三方平台发的 credential
- 它只用于导出匿名 `safety_identifier`
- 不得与 `BETTER_AUTH_SECRET`、`APP_API_INTERNAL_SHARED_SECRET` 复用同一个值

## 8. Sentry

当前 owner：

- `apps/app-api`
- `apps/campus-web`
- `apps/operator-console-web`

默认放置位置：

- 各 app 的 `.dev.vars`
- deploy-side Cloudflare secret store
- ignored local convenience `.env` 只允许作为 fan-out source，不是运行面 owner，
  也不写入 root `.env.example`

运行面相关键：

- `SENTRY_DSN`
- `SENTRY_ENVIRONMENT`
- `SENTRY_RELEASE`

root convenience keys：

- `SENTRY_DSN`
- `SENTRY_API_TOKEN`

获取方式：

1. 当前仓库默认使用一个共享 Sentry project，例如 `campus-agent-workers`。
1. 从项目的 **Client Keys (DSN)** 页面复制 DSN。
1. 如果需要 repo-local API lookup、artifact 查询或 smoke 脚本访问 API，再创建 auth token。

外部参考：

- DSN 说明与获取入口：<https://docs.sentry.io/concepts/key-terms/dsn-explainer/>
- API auth token：<https://docs.sentry.io/api/auth/>
- 组织级 auth token 教程：<https://docs.sentry.io/api/guides/create-auth-token/>

说明：

- `SENTRY_API_TOKEN` 不是 Worker runtime secret，不应同步到 `.dev.vars`
- 默认用 `SENTRY_ENVIRONMENT` 区分 `staging` / `production`
- 默认用 `surface` tag 区分 `app-api`、`campus-web`、`operator-console-web`、`hub-web`
- 只有当告警归属、事件噪声、数据策略或 issue regression 已经实质冲突时，才拆分为多个 Sentry project

## 9. Axiom

当前 owner：

- `apps/app-api`

默认放置位置：

- `apps/app-api/.dev.vars`
- deploy-side Cloudflare secret store

相关键：

- `AXIOM_ENDPOINT`
- `AXIOM_DATASET`
- `AXIOM_TOKEN`

获取方式：

1. 在 Axiom 确认组织的 edge deployment。
1. 在 **Settings > Datasets and views** 创建 dataset。
1. 在 **Settings > API tokens** 创建 API token。
1. 把 edge deployment 对应的 base domain 作为 `AXIOM_ENDPOINT`。

外部参考：

- token：<https://axiom.co/docs/reference/tokens>
- dataset：<https://axiom.co/docs/reference/datasets>
- edge deployment / base
  domain：<https://axiom.co/docs/reference/edge-deployments>

说明：

- `AXIOM_ENDPOINT` 应写成类似 `<https://us-east-1.aws.edge.axiom.co`>
- `AXIOM_DATASET` 当前按 project 命名，例如 `campus-agent-runtime`；environment、
  service 与 signal 维度通过 `deployment.environment`、`service.name`、`signal_type`、
  `event_type` 等低基数字段区分
- 只有事件量、权限、保留期、字段数量或查询污染成为真实问题时，才进一步拆分 dataset
- 当前 `.dev.vars.example` 已明确要求使用 ingest API token，不要把 PAT 当成长期 ingest token

## 10. Langfuse

当前 owner：

- `infra/otel`
- `packages/evals`

默认放置位置：

- OTel Collector deployment secret store
- ignored local runtime env

相关键：

- `OTEL_COLLECTOR_LANGFUSE_OTLP_ENDPOINT`
- `OTEL_COLLECTOR_LANGFUSE_AUTH_HEADER`
- `OTEL_COLLECTOR_LANGFUSE_INGESTION_VERSION`

获取方式：

1. 在 self-hosted Langfuse 中创建 project API keys。
1. 用 `pk:sk` 生成 Basic authorization header。
1. 把 OTLP endpoint 配置为 `<base-url>/api/public/otel`。
1. `OTEL_COLLECTOR_LANGFUSE_INGESTION_VERSION` 固定为 `4`，除非 Langfuse
   官方文档要求升级。

说明：

- Langfuse 是 observability / eval platform，不是 Operator Console query backend。
- repo-tracked env example 必须保持 secret-bearing values 为空。
- Cloud Langfuse 使用同一 key / endpoint contract。

## 11. Cloudflare Workers / Wrangler

这不是业务 provider，但它是当前三个 Worker app 的 deploy control plane。

涉及运行面：

- `apps/app-api`
- `apps/campus-web`
- `apps/operator-console-web`

获取方式：

1. 本机开发或手工发布时，使用 `wrangler login`。
1. CI / automation 时，使用 Cloudflare API token。
1. 部署侧 secret 用 `wrangler secret put` 或 dashboard 写入。
1. staging 发布前，用 `uv run --all-packages python -m
   scripts.check_worker_secret_presence --env staging --json` 审计 Cloudflare
   secret store 是否已包含当前 `wrangler.toml` 声明的 required secrets。

外部参考：

- Wrangler
  commands：<<https://developers.cloudflare.com/workers/wrangler/commands>
  /general/>
- Worker
  secrets：<https://developers.cloudflare.com/workers/configuration/secrets/>

说明：

- repo-tracked `.dev.vars.example` 只是本地模板，不是 staging / prod secret source
- deploy environment 的 secret truth 仍在 Cloudflare secret store
- 当前 repo 还把 Worker secret contract 显式写进各 app 的 `wrangler.toml`
  `secrets.required`
- 如果 `scripts.check_worker_secret_presence` 输出 `Failed to fetch auth token` /
  `Not logged in`，先恢复本机 `wrangler` 身份态：手工环境重新执行 `pnpm --dir <app> exec wrangler
  login`，CI / automation 则改用 `CLOUDFLARE_API_TOKEN`
- Cloudflare 官方把 `secrets` 归类为 non-inheritable config，因此命名环境必须各自声明自己的 required
  secret 集，不能假定从 top-level 自动继承
- `scripts.check_worker_secret_presence` 会按这个 non-inheritable contract
  只审计当前环境自己的 required secret 集，不会把 top-level required 集误算成命名环境必需项
- 当前仓库的 deploy / whoami / secret-audit 入口默认会剥离继承来的代理 env，再直连 Cloudflare API；这是
  repo-local execution rule，不改变 Cloudflare 平台本身的 secret ownership

## 11. Cloudflare Access

这只属于 `operator-console-web`。

默认放置位置：

- `apps/operator-console-web/.dev.vars`
- staging deploy shell env：
  - `STAGING_ACCESS_TEAM_DOMAIN`
  - `STAGING_ACCESS_POLICY_AUD`

运行面相关键：

- `ACCESS_TEAM_DOMAIN`
- `ACCESS_POLICY_AUD`

获取方式：

1. 在 Zero Trust 创建 self-hosted Access application。
1. 复制 team domain。
1. 在应用基本信息页复制 **Application Audience (AUD) Tag**。

外部参考：

- self-hosted app
  创建：<<https://developers.cloudflare.com/cloudflare-one/applicati>
  ons/configure-apps/self-hosted-apps/>
- application token 与 `aud`
  字段：<<https://developers.cloudflare.com/cloudflare-one>
  /access-controls/applications/http-apps/authorization-cookie/application-token
  />
- 获取 AUD
  tag：<<https://developers.cloudflare.com/cloudflare-one/access-controls/a>
  pplications/http-apps/authorization-cookie/validating-json/>

说明：

- `ACCESS_TEAM_DOMAIN` 与 `ACCESS_POLICY_AUD` 当前不再硬编码进 repo-tracked staging
  config
- 删除并重建 Access application 会导致新的 AUD；这不是可忽略变更
