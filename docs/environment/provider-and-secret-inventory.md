---
doc_type: index
truth_scope: ops
owner_boundary: docs/environment
status: active
created: 2026-04-12
updated: 2026-06-13
---

# Provider And Secret Inventory

<!-- markdownlint-disable MD013 -->

## Document Boundary

This file is the stable provider/secret inventory index. It owns the
reading model and fast matrix. Detailed provider families and environment
combinations live in split environment references.

## Split Documents

- `provider-and-secret-inventory/core-providers.md`
  - Core providers: LLM, embeddings, Qdrant, Postgres and object storage
- `provider-and-secret-inventory/app-and-edge-providers.md`
  - App and edge providers: Turnstile, OCR, auth mail, telemetry and edge
- `provider-and-secret-inventory/environment-combinations.md`
  - Environment combinations: local, ingestion, staging and unused providers

## Index-Owned Baseline

## 文档组织原则

这份文档采用的组织方式，来自当前几个成熟文档体系的共同模式：

- 把“谁拥有这些 env”和“这些 provider 怎么申请”拆成两份文档，而不是塞进一个巨大 `.env.example`
- 把 local dev 与 deploy secret store 明确分开，而不是让 root `.env` 冒充 staging / prod 真相
- 把 server-only secret 与 browser / public runtime string 明确分开
- 长 env 列表按能力域或 provider 分类，而不是只做一份按字母排序的大清单

外部参考：

- Cloudflare Workers local `.dev.vars` / `.env` 与 deploy secrets
  分层：<<https://dev>
  elopers.cloudflare.com/workers/development-testing/environment-variables/>、<ht
  tps://developers.cloudflare.com/workers/configuration/secrets/>
- Next.js server-only 与 browser-exposed env
  分层：<https://nextjs.org/docs/app/guides/environment-variables>
- Vercel 按 `Development / Preview / Production`
  分环境管理变量：<https://vercel.com/docs/environment-variables>
- n8n 按数据库、安全、日志、外部 secrets 等分类维护 env
  reference：<https://docs.n8n.io/hosting/configuration/environment-variables/>

## 快速矩阵

### Repo-root shared provider

- Provider / system: OpenAI-compatible LLM provider
  作用: execution-control / agentic execution 在线回答，eval 默认 judge/ragas LLM
  主要 env keys: `LLM_BASE_URL` `LLM_API_KEY` `EXECUTION_PROMPT_MODEL`
  `AGENT_PROMPT_MODEL`
  放置位置: root `.env`
  何时必需: 真实 query path、live eval
  获取方式: 在所选供应商控制台创建项目级 API key；如果直接用 OpenAI，按 Projects / API keys 流程创建

- Provider / system: Embedding provider
  作用: ingestion 向量化、retrieval dense lane、eval 默认 embeddings
  主要 env keys: `EMBEDDING_PROVIDER` `EMBEDDING_BASE_URL` `EMBEDDING_API_KEY`
  `EMBEDDING_MODEL` `EMBEDDING_DIMENSIONS`
  放置位置: root `.env`
  何时必需: indexing、retrieval、eval embeddings
  获取方式: 当前 baseline 是 Gitee OpenAI-compatible embeddings；需在供应商控制台开通 embeddings
  服务并拿到 token / endpoint

- Provider / system: Qdrant
  作用: 向量索引与 hybrid retrieval backend
  主要 env keys: `QDRANT_URL` `QDRANT_API_KEY` `QDRANT_READ_ONLY_API_KEY`
  `QDRANT_QUERY_API_KEY` `QDRANT_TLS_CA_CERT_PATH`
  放置位置: root `.env`
  何时必需: retrieval / indexing
  获取方式: 当前 staging / early production 默认使用自托管单节点 Qdrant；按
  `docs/runbooks/self-hosted-qdrant-native-backup-runbook.md` 部署 container，并由 deploy
  secret / env 提供 HTTPS URL、admin key、read-only query key 与 CA certificate path

- Provider / system: Shared Postgres
  作用: app-api shared DB、document/raw registry
  主要 env keys: `CAMPUS_SHARED_POSTGRES_URL`
  `CAMPUS_SHARED_POSTGRES_OPERATOR_URL` `DOCUMENT_REGISTRY_DATABASE_URL`
  `RAW_ASSET_REGISTRY_DATABASE_URL`
  放置位置: root `.env`；再 fan out 到 `apps/app-api/.env`
  何时必需: app-api、本地 eval ingress、registry/operator 路径
  获取方式: 如果用 Supabase，operator/runtime 默认都取 session pooler `:5432`；legacy
  `*_MANAGEMENT_*` 不再作为 runtime env path；如果本地开发，走 Docker Postgres 恢复入口

- Provider / system: S3-compatible object storage
  作用: raw source、source truth、derived artifacts
  主要 env keys: `OBJECT_STORE_ENDPOINT` `OBJECT_STORE_ACCESS_KEY`
  `OBJECT_STORE_SECRET_KEY` `OBJECT_STORE_SOURCE_ACCESS_KEY`
  `OBJECT_STORE_SOURCE_SECRET_KEY` `OBJECT_STORE_DERIVED_ACCESS_KEY`
  `OBJECT_STORE_DERIVED_SECRET_KEY` `OBJECT_STORE_BUCKET_SOURCE` `OBJECT_STORE_BUCKET_DERIVED`
  放置位置: root `.env`
  何时必需: ingestion / replay / rebuild
  获取方式: 本地开发默认用 Docker MinIO；云端可用任何 S3-compatible provider，创建 bucket 与 access
  key 即可。ingestion 支持 shared credential mode 或 source+derived bucket-scoped credential
  mode；source-only collector 与 derived-only online runtime 使用更窄的 bucket-scoped key。

- Provider / system: OCR service
  作用: canonical raw ingestion / replay，lane-level compare
  主要 env keys: `OCR_BASE_URL` `OCR_API_KEY` `OCR_PROVIDER_MODE` `OCR_MODEL`
  `OCR_MINERU_*`
  放置位置: root `.env` 或 command-scoped env
  何时必需: 只有 ingestion / replay / compare 需要
  获取方式: canonical lane 由 routing owner 决定；`OCR_*` 表示当前 active
  provider，`OCR_MINERU_*` 只作为 `process_raw_ingestion_job` source-truth-only 的附加
  MinerU lane；其中 `curriculum/curriculum_plan` 的 canonical source OCR truth
  已冻结为 `mineru_api / vlm`，以 collection runtime profile 为准，不再跟随 root
  `OCR_*` 默认值漂移

- Provider / system: Eval-only provider override
  作用: eval 独立预算 / 独立限流
  主要 env keys: `EVAL_LLM_*` `EVAL_EMBEDDING_*` `EVAL_LLM_TRANSPORT`
  `EVAL_RAGAS_MODEL` `EVAL_JUDGE_MODEL`
  放置位置: root `.env`
  何时必需: 只有 eval 不想复用 shared provider 时
  获取方式: 在对应供应商控制台单独申请；默认不需要

- Provider / system: FeedWe public WeChat article acquisition
  作用: `wechat_official_account` source channel 的公开公众号文章 acquisition
  主要 env keys: `FEEDWE_EMAIL` `FEEDWE_PASSWORD` `FEEDWE_BASE_URL`
  `WECHAT_OFFICIAL_ACCOUNT_APP_API_BASE_URL`
  `WECHAT_OFFICIAL_ACCOUNT_SERVICE_TOKEN`
  放置位置: `apps/wechat-official-account-collector/.env` 或 deploy-side secret store
  何时必需: 只有运行 FeedWe capture / provider contract verification 时需要
  获取方式: 从 operator-managed credential store 获取登录邮箱/密码；不得提交到 repo

### App-local / deploy provider

- Provider / system: Better Auth secret
  作用: `app-api` 会话签名与加密
  主要 env keys: `BETTER_AUTH_SECRET`
  放置位置: `apps/app-api/.dev.vars` 或 deploy secret store
  何时必需: `app-api` 必需
  获取方式: 自行生成高熵 secret，不是第三方平台发放

- Provider / system: Cloudflare Turnstile
  作用: public auth family captcha hardening
  主要 env keys: `AUTH_TURNSTILE_SECRET_KEY` `AUTH_TURNSTILE_SITE_KEY`
  `AUTH_TURNSTILE_APPEARANCE` `AUTH_TURNSTILE_EXECUTION`
  放置位置: `apps/app-api/.dev.vars` / deploy secret
  store；`apps/campus-web/.dev.vars` / Worker vars
  何时必需: public auth family (`sign-in` / `sign-up` / `request-password-reset`) 必需
  获取方式: 在 Cloudflare Turnstile 创建 widget；server secret 放 `app-api`，public
  sitekey 放 `campus-web`；runtime posture 由 `campus-web` 注入

- Provider / system: Resend transactional auth mail
  作用: `app-api` password reset / password-changed mail
  主要 env keys: `RESEND_API_KEY` `AUTH_RESET_EMAIL_FROM`
  `AUTH_RESET_EMAIL_REPLY_TO`
  放置位置: `apps/app-api/.dev.vars` 或 deploy secret store
  何时必需: end-user password reset 必需
  获取方式: 在 Resend 创建 API key，并准备已验证 sender identity；`reply-to` 可选

- Provider / system: Safety identifier HMAC secret
  作用: `app-api` 匿名安全标识导出
  主要 env keys: `APP_API_SAFETY_IDENTIFIER_HMAC_SECRET`
  放置位置: `apps/app-api/.dev.vars` 或 deploy secret store
  何时必需: 启用 end-user safety traceability 时必需
  获取方式: 自行生成高熵 secret，不是第三方平台发放

- Provider / system: Sentry
  作用: runtime error / trace / release evidence
  主要 env keys: `SENTRY_DSN` `SENTRY_ENVIRONMENT` `SENTRY_RELEASE`
  `APP_API_OPERATOR_TRACE_LINK_TEMPLATE`
  放置位置: 各 app `.dev.vars` 或 Cloudflare secret store
  何时必需: staging / prod observability，local smoke 可选
  获取方式: 在 Sentry 创建项目后，从 Client Keys (DSN) 复制 DSN；需要 repo-local API lookup 时再建
  auth token；如果要在 panel 中打开 trace viewer，则把
  `APP_API_OPERATOR_TRACE_LINK_TEMPLATE` 配置为只含 safe placeholder 的 trace URL 模板

- Provider / system: Axiom
  作用: `app-api` runtime logs / metrics ingest
  主要 env keys: `AXIOM_ENDPOINT` `AXIOM_DATASET` `AXIOM_TOKEN`
  `APP_API_OPERATOR_ISSUE_LINK_TEMPLATE`
  放置位置: `apps/app-api/.dev.vars` 或 Cloudflare secret store
  何时必需: `app-api` observability
  获取方式: 在 Axiom 确认 edge deployment、创建 dataset、生成 API token；如果要在 panel
  中打开 request/error query，则把 `APP_API_OPERATOR_ISSUE_LINK_TEMPLATE` 配置为 safe
  query URL 模板，panel 不直接查询 Axiom API

- Provider / system: Cloudflare Workers / Wrangler
  作用: `app-api`、`campus-web`、legacy `public-chat-web`、`operator-console-web` 与
  `operator-console-web` deploy 与 secret store
  主要 env keys: shell env / secret store，不固定 repo key 名
  放置位置: local shell、CI secret store、Cloudflare dashboard
  何时必需: 只有 Worker dev/deploy 需要
  获取方式: 本机 `wrangler login`，或在 CI 下发 Cloudflare API token；Worker secret 用
  `wrangler secret put`，deploy 前再用 `scripts.check_worker_secret_presence` 审计

- Provider / system: Cloudflare Access
  作用: `operator-console-web` outer protection envelope
  主要 env keys: `ACCESS_TEAM_DOMAIN` `ACCESS_POLICY_AUD`
  放置位置: `apps/operator-console-web/.dev.vars` 或 staging deploy 注入
  何时必需: panel staging / prod 必需
  获取方式: 在 Zero Trust 创建 self-hosted Access application，复制 team domain 与
  Application Audience (AUD) Tag

- Provider / system: Execution Control staging operator shell
  作用: staging execution-control Docker runtime、machine ingress reverse proxy
  contract、自愈任务与 strict health check
  主要 env keys: `STAGING_EXECUTION_CONTROL_BASE_URL`
  `STAGING_EXECUTION_CONTROL_ACCESS_CLIENT_ID`
  `STAGING_EXECUTION_CONTROL_ACCESS_CLIENT_SECRET`
  `EXECUTION_CONTROL_STAGING_APP_API_BASE_URL`
  `EXECUTION_CONTROL_RUN_PROJECTION_DATABASE_URL`
  `EXECUTION_CONTROL_TEMPORAL_*`
  `QDRANT_API_KEY`
  `EMBEDDING_*`
  `PROMPT_RUNTIME_*`
  放置位置: `/srv/docker/campus-agent/staging/env/runtime.env` 或 Docker/ops-owned
  secret source
  何时必需: 当前 canonical staging execution runtime 需要
  获取方式: deploy host ops secret store 渲染，不放入 `/srv/apps/campus-agent`
  deploy checkout；machine ingress 固定为 `execution-control-staging.mucwiki-edge.link`

- Provider / system: Supervisor local runtime command template
  作用: 本地 Docker `execution-control + Temporal + split workers` runtime 的
  command-scoped override
  主要 env keys: `EXECUTION_CONTROL_RUNTIME_*` `EXECUTION_CONTROL_*`
  放置位置: `env/commands/execution-control-runtime.env.example`
  何时必需: 只在本地 smoke / 运维排障需要显式覆写默认值时
  获取方式: 直接基于 repo template；不要把 deploy-only secret 回写到 root `.env.example`

- Provider / system: Execution Control machine ingress protection
  作用: `apps/app-api` 调用 Docker-first `execution-control` 时穿过 Cloudflare Access /
  Tunnel 保护的机器入口
  主要 env keys: `EXECUTION_CONTROL_ACCESS_CLIENT_ID`
  `EXECUTION_CONTROL_ACCESS_CLIENT_SECRET`
  放置位置: `apps/app-api/.dev.vars` 或 Cloudflare Worker secret store
  何时必需: 当 `EXECUTION_CONTROL_BASE_URL` 指向 Access-protected machine ingress 时必需
  获取方式: Cloudflare Zero Trust Service Token；该 token 不替代
  `EXECUTION_CONTROL_SHARED_SECRET`
