---
doc_type: index
status: active
created: 2026-04-12
updated: 2026-06-01
---
# Provider And Secret Inventory

本文回答三个问题：

- 当前仓库哪些 provider / control plane 是真正需要的
- 各自应该把哪些键填到哪里
- 如果是新环境或新同学接手，应去哪里申请或获取这些值

它不重新定义 env ownership。分层与 deploy-side 治理仍以 [README.md](./README.md) 和 [../runbook
s/provider-secret-governance.md](../runbooks/provider-secret-governance.md) 为准。

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
  作用: supervisor / agent 在线回答，eval 默认 judge/ragas LLM
  主要 env keys: `LLM_BASE_URL` `LLM_API_KEY` `SUPERVISOR_PROMPT_MODEL`
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
  store；`apps/public-chat-web/.dev.vars` / Worker vars
  何时必需: public auth family (`sign-in` / `sign-up` / `request-password-reset`) 必需
  获取方式: 在 Cloudflare Turnstile 创建 widget；server secret 放 `app-api`，public
  sitekey 放 `public-chat-web`；runtime posture 由 `public-chat-web` 注入

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
  作用: `app-api`、`public-chat-web`、`protected-panel-web` deploy 与 secret store
  主要 env keys: shell env / secret store，不固定 repo key 名
  放置位置: local shell、CI secret store、Cloudflare dashboard
  何时必需: 只有 Worker dev/deploy 需要
  获取方式: 本机 `wrangler login`，或在 CI 下发 Cloudflare API token；Worker secret 用
  `wrangler secret put`，deploy 前再用 `scripts.check_worker_secret_presence` 审计

- Provider / system: Cloudflare Access
  作用: `protected-panel-web` outer protection envelope
  主要 env keys: `ACCESS_TEAM_DOMAIN` `ACCESS_POLICY_AUD`
  放置位置: `apps/protected-panel-web/.dev.vars` 或 staging deploy 注入
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

## Provider 详情

## 1. OpenAI-compatible LLM provider

当前 repo 只冻结了 contract，不冻结唯一 LLM vendor。真正需要的是：

- 一个可达的 `base_url`
- 一把 API key
- 至少两个可用模型名：
  - `SUPERVISOR_PROMPT_MODEL`
  - `AGENT_PROMPT_MODEL`

默认放置位置：

- root `.env`

相关键：

- `LLM_BASE_URL`
- `LLM_API_KEY`
- `SUPERVISOR_PROMPT_MODEL`
- `AGENT_PROMPT_MODEL`
- 可选 eval override：`EVAL_LLM_BASE_URL` `EVAL_LLM_API_KEY` `EVAL_LLM_TRANSPORT`
  `EVAL_RAGAS_MODEL` `EVAL_JUDGE_MODEL`

获取方式：

1. 先决定是否复用当前 shared provider，还是给 eval 单独拆 provider。
1. 在所选供应商控制台创建项目级或环境级 API key。
1. 记录 API base URL 和允许使用的模型名。
1. staging / prod 必须分环境单独发 key，不要复用本地开发 key。

如果直接使用 OpenAI，可参考：

- Projects / key
  管理：<<https://help.openai.com/en/articles/9186755-managing-your-w>
  ork-in-the-api-platform-with-projects>
- API key
  与生产环境实践：<<https://platform.openai.com/docs/guides/production-best-pract>
  ices#api-keys>

说明：

- 上述 “OpenAI 项目级 key” 是官方推荐路径；如果改用其他 OpenAI-compatible vendor，则点击路径以供应商控制台当前 UI
  为准
- eval override 不是默认必需项。只有预算、限流或模型隔离需要时才单独配置

## 2. Embedding provider

当前 merged truth 的 retrieval baseline 仍冻结为：

- `Qwen3-Embedding-4B`
- `dimensions=2560`
- current provider reality 为 `gitee` OpenAI-compatible embeddings

相关真相见：

- [../decisions/adr-0007-phase1-retrieval-baseline-update.md](../decisions/adr-0
  007-phase1-retrieval-baseline-update.md)
- [../policies/student-handbook-chunking-and-validation-policy.md](../policies/s
  tudent-handbook-chunking-and-validation-policy.md)

默认放置位置：

- root `.env`

相关键：

- `EMBEDDING_PROVIDER`
- `EMBEDDING_BASE_URL`
- `EMBEDDING_API_KEY`
- `EMBEDDING_MODEL`
- `EMBEDDING_DIMENSIONS`
- 可选 eval override：`EVAL_EMBEDDING_BASE_URL` `EVAL_EMBEDDING_API_KEY`
  `EVAL_EMBEDDING_MODEL` `EVAL_EMBEDDING_DIMENSIONS`

获取方式：

1. 如果保持当前 baseline，不要擅自更换模型维度或 vendor。
1. 在当前 embedding vendor 控制台开通 embeddings 服务，记录 `base_url`、API token 与模型名。
1. 把 shared runtime 值放到 root `.env`。
1. 只有 eval 需要独立 provider 时，才额外填写 `EVAL_EMBEDDING_*`。

外部参考：

- Gitee Serverless API 入口：<https://ai.gitee.com/serverless-api/>

说明：

- 上面这条链接只证明当前 vendor 存在官方 API 服务入口；具体 token 生成页面以供应商控制台当前 UI 为准
- 如果要更换 retrieval baseline，不是只改 env；还要同步 ADR / policy / eval 基线

## 3. Qdrant

默认放置位置：

- root `.env`

相关键：

- `QDRANT_URL`
- `QDRANT_API_KEY`
- `QDRANT_READ_ONLY_API_KEY`
- `QDRANT_QUERY_API_KEY`
- `QDRANT_TLS_CA_CERT_PATH`

获取方式：

1. 在目标服务器按
   [Self-Hosted Qdrant Native Backup Runbook](../runbooks/self-hosted-qdrant-native-backup-runbook.md)
   部署 single-node Qdrant。
1. 生成 deploy-scoped `QDRANT_API_KEY` 与 `QDRANT_READ_ONLY_API_KEY`，写入服务器本地
   env 或 deploy secret store。
1. 把本机或内网 Qdrant URL 写入 `QDRANT_URL`，staging / production 必须使用 HTTPS，
   例如 `https://127.0.0.1:6333`。
1. online execution runtime 使用 read-only key 投影出的 `QDRANT_QUERY_API_KEY`，不得用
   admin `QDRANT_API_KEY` 查询。
1. 配置 `QDRANT_TLS_CA_CERT_PATH` 指向 ops-owned CA bundle，例如
   `/srv/docker/campus-agent/staging/qdrant/tls/ca.pem`。
1. 不把 `6333` / `6334` 直接暴露到公网。

外部参考：

- self-hosted installation：<https://qdrant.tech/documentation/guides/installation/>
- self-hosted security / API key：<https://qdrant.tech/documentation/operations/security/>
- native snapshots：<https://qdrant.tech/documentation/operations/snapshots/>

说明：

- 本仓库默认不把 `:memory:` 当作真实开发 / staging retrieval backend，只把它视为测试姿态
- 当前不采用 Qdrant Cloud 作为 staging / early-production 默认方案；Cloud 相关旧方案已由
  ADR-0045 supersede

## 4. Shared Postgres

当前 repo 同时存在两个姿态：

- shared / cloud Postgres
- 本地 Docker Postgres dev 恢复

默认放置位置：

- root `.env`
- `apps/app-api/.env` 只保存 `app-api` 本地 Wrangler / Drizzle 进程用镜像值，不是新的 owner

相关键：

- `CAMPUS_SHARED_POSTGRES_URL`
- `CAMPUS_SHARED_POSTGRES_OPERATOR_URL`
- `DOCUMENT_REGISTRY_DATABASE_URL`
- `RAW_ASSET_REGISTRY_DATABASE_URL`
- `apps/app-api/.env`
  - `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_APP_API_DB`
  - `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_APP_API_DB_FRESH`
  - `APP_API_OPERATOR_DATABASE_URL`

如果使用 Supabase：

1. 打开项目 **Connect** 面板。
1. 复制 session pooler DSN 作为 `CAMPUS_SHARED_POSTGRES_URL`。
1. 复制 session pooler `:5432` DSN 作为 `CAMPUS_SHARED_POSTGRES_OPERATOR_URL`。

外部参考：

- <https://supabase.com/docs/guides/database/connecting-to-postgres>

如果使用本地 Docker Postgres：

- 使用 [../runbooks/local-postgres-dev-recovery-runbook.md](../runbooks/local-post
  gres-dev-recovery-runbook.md)
- 或直接执行 `uv run --all-packages python -m scripts.restore_local_postgres_dev
  - -execute`

说明：

- 本地 Docker Postgres 是 `local dev / test path`，不是 deployed runtime truth
- `CAMPUS_SHARED_POSTGRES_OPERATOR_URL` 给 repo-owned operator 路径

## 5. S3-compatible object storage

默认放置位置：

- root `.env`

相关键：

- `OBJECT_STORE_ENDPOINT`
- `OBJECT_STORE_ACCESS_KEY`
- `OBJECT_STORE_SECRET_KEY`
- `OBJECT_STORE_SOURCE_ACCESS_KEY`
- `OBJECT_STORE_SOURCE_SECRET_KEY`
- `OBJECT_STORE_DERIVED_ACCESS_KEY`
- `OBJECT_STORE_DERIVED_SECRET_KEY`
- `OBJECT_STORE_BUCKET_SOURCE`
- `OBJECT_STORE_BUCKET_DERIVED`
- `OBJECT_STORE_REGION`
- `OBJECT_STORE_SECURE`

本地开发推荐获取方式：

- 按 [../decisions/adr-0002-local-minio-conventions.md](../decisions/adr-0002-loc
  al-minio-conventions.md) 运行 Docker MinIO
- 创建或确保 bucket：
  - `campus-rag-source`
  - `campus-rag-derived`

云端获取方式：

1. 选择任意 S3-compatible provider。
1. 创建 source / derived buckets。
1. 生成 access key / secret key。
1. 填写 endpoint 与 bucket 名。

当前 Cloudflare R2 staging baseline：

- endpoint: `https://5943f31433be5dd57beb3bb92bd1c660.r2.cloudflarestorage.com`
- source bucket: `campus-rag-source-staging`
- derived bucket: `campus-rag-derived-staging`
- runtime region/signing value: `auto`

R2 API token 作为 S3 凭据时，Access Key ID 是 token id，Secret Access Key 是 token
value 的 SHA-256。Secret Access Key 只在创建 token 时可派生一次；不得把 token value
或派生后的 secret 写入 repo。`execution-control` staging 只读/读取 notice canonical body 时使用
derived-only bucket-scoped 凭据，不能复用 `ayafeed-*` 或 public docs reader asset bucket。

Worker gated reader 交付：

- `apps/public-docs` 在 build/deploy 阶段把 `deliveryMode=gated_asset` 同步进
  `doc_build/_gated-docs/...`；运行时由 Worker-first admission 后读取静态资产
- `apps/app-api` 仅提供 `/api/docs/.../admission` 控制面校验，不再承担 gated bytes streaming
- 本地 ingestion / publish 命令仍使用上面的 `OBJECT_STORE_*` S3-compatible 配置写入同一 object
  key 体系

凭据姿态：

- ingestion / replay / rebuild 支持两种正式模式：shared credential mode 使用一套
  `OBJECT_STORE_ACCESS_KEY` / `OBJECT_STORE_SECRET_KEY` 访问 source 与 derived 两只
  bucket；bucket-scoped credential mode 分别配置 `OBJECT_STORE_SOURCE_ACCESS_KEY` /
  `OBJECT_STORE_SOURCE_SECRET_KEY` 与 `OBJECT_STORE_DERIVED_ACCESS_KEY` /
  `OBJECT_STORE_DERIVED_SECRET_KEY`
- source-only collector（例如
  `official-web-collector`、`authenticated-notice-collector`）可以只配置
  `OBJECT_STORE_SOURCE_*`
- derived-only online runtime（例如 supervisor notice canonical body reads）只配置
  `OBJECT_STORE_DERIVED_*`
- ingestion / replay / rebuild 默认同时触达 source 与 derived，两只 bucket 都必须有可用凭据；
  shared mode 和 bucket-scoped mode 都是当前 accepted runtime contract，不是 fallback。
- `OBJECT_STORE_REGION` 在当前 repo 里是 SDK/signing 参数；如果 provider 没有公开 region
  概念，保持默认 `us-east-1` 即可，除非该 provider 文档明确要求其他值

## 6. Cloudflare Turnstile

默认放置位置：

- `apps/app-api/.dev.vars` 或 Cloudflare Worker secret store：
  - `AUTH_TURNSTILE_SECRET_KEY`
- `apps/public-chat-web/.dev.vars` 或 `apps/public-chat-web/wrangler.toml`
  `env.<name>.vars`：
  - `AUTH_TURNSTILE_SITE_KEY`
  - `AUTH_TURNSTILE_APPEARANCE`
  - `AUTH_TURNSTILE_EXECUTION`

当前 repo 约束：

- `AUTH_TURNSTILE_SECRET_KEY` 只供 `apps/app-api` Better Auth captcha plugin
  使用，不能下沉到浏览器
- `AUTH_TURNSTILE_SITE_KEY` 是公开 runtime string，由 `public-chat-web` Worker 注入
  public auth shell
- `AUTH_TURNSTILE_APPEARANCE` / `AUTH_TURNSTILE_EXECUTION` 是公开 runtime posture，由
  `public-chat-web` Worker 注入 auth shell；默认分别是 `interaction-only` / `render`
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

- root `.env`
- 命令级 override 放在 `env/commands/*.env.example`

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
  - 当前用于 `process_raw_ingestion_job` 的 `source_truth_only` 条件式 typed-PDF
    路由、`generic_image` 双跑判型，以及 `campus-ingestion-compare-online-ocr`
  - 它是 lane-specific 补充配置，不再代表 repo 级 “second provider canonical truth”

相关内部文档：

- [../../apps/ingestion-worker/README.md](../../apps/ingestion-worker/README.md)
- [../decisions/adr-0033-internal-notice-pdf-cloud-ocr-default.md](../decisions/
  adr-0033-internal-notice-pdf-cloud-ocr-default.md)

外部参考：

- MinerU API / model docs：<https://mineru.net/doc/docs/index_en/>
- MinerU output
  files（`full.md`、`content_list*.json`、`layout.json`）：<<https://ope>
  ndatalab.github.io/MinerU/reference/output_files/>

说明：

- active `OCR_*` lane 当前是 team-owned endpoint contract，不是 repo 内置的公共 SaaS 开户流程
- `OCR_PROVIDER_MODE=mineru_api` 已可作为 `process_raw_ingestion_job` 的 active
  provider；canonical lane 仍由 typed route 决定，不由 env 的“谁是 primary”反向定义
- `OCR_MINERU_*` 现在只是受控补充入口：当前 repo 把它接入 `source_truth_only` 的 typed-PDF 条件路由与
  `generic_image` 双跑判型，并在 MinerU 胜出时额外保留 `provider-response-raw.zip` provenance
  sidecar；`ocr-routing-decision.json` 会记录双跑后的 refined asset type 与 canonical
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
- `apps/public-chat-web`
- `apps/protected-panel-web`

默认放置位置：

- 各 app 的 `.dev.vars`
- deploy-side Cloudflare secret store
- root `.env` 只允许作为本地 fan-out convenience source，不是运行面 owner

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
- 默认用 `surface` tag 区分 `app-api`、`public-chat-web`、`protected-panel-web`、`hub-web`
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

## 10. Cloudflare Workers / Wrangler

这不是业务 provider，但它是当前三个 Worker app 的 deploy control plane。

涉及运行面：

- `apps/app-api`
- `apps/public-chat-web`
- `apps/protected-panel-web`

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

这只属于 `protected-panel-web`。

默认放置位置：

- `apps/protected-panel-web/.dev.vars`
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

## 最小环境组合

## 仅跑 query / app-api / web 本地联调

至少准备：

- root `.env`
  - LLM provider
  - embedding provider
  - Qdrant
  - shared Postgres
- `apps/app-api/.env`
  - local Hyperdrive / management DSN
- `apps/app-api/.dev.vars`
  - `BETTER_AUTH_SECRET`
  - `APP_API_SAFETY_IDENTIFIER_HMAC_SECRET`
  - `PUBLIC_CHAT_WEB_ORIGIN`
  - `EXECUTION_CONTROL_*`
  - 如果 supervisor ingress 受 Cloudflare Access 保护，补充
    `EXECUTION_CONTROL_ACCESS_CLIENT_ID` 与 `EXECUTION_CONTROL_ACCESS_CLIENT_SECRET`
  - `APP_API_INTERNAL_SHARED_SECRET`
- `apps/public-chat-web/.dev.vars`
  - `APP_API_BASE_URL`
- `apps/protected-panel-web/.dev.vars`
  - 只有调 panel 时才需要

不必准备：

- OCR
- object storage
- eval-only provider override

## 跑 ingestion / replay / rebuild

在上面的基础上再准备：

- object storage
- OCR provider
- 需要时的 command-scoped env

## 跑 staging Worker deploy

在对应 app-local secret store 之外，还要准备：

- Cloudflare deploy access
- panel 的 Cloudflare Access application
- 对应运行面的 Sentry DSN
- `app-api` 的 Axiom dataset / token

## 当前不需要的 provider

以下不是当前 merged truth 的必填项：

- GitHub OAuth / Google OAuth / 其他 end-user social sign-in provider
- 独立 eval provider，除非你明确要把 eval 和 shared runtime 分账
- 额外的 OCR sidecar provider，除非你真的要跑 lane 级对照或 source-truth-only 双跑

## 相关仓库文档

- [README.md](./README.md)
- [../../.env.example](../../.env.example)
- [../../apps/app-api/.env.example](../../apps/app-api/.env.example)
- [../../apps/app-api/.dev.vars.example](../../apps/app-api/.dev.vars.example)
- [../../apps/hub-web/.dev.vars.example](../../apps/hub-web/.dev.vars.example)
- [../../apps/public-chat-web/.dev.vars.example](../../apps/public-chat-web/.dev
  .vars.example)
- [../../apps/protected-panel-web/.dev.vars.example](../../apps/protected-panel-
  web/.dev.vars.example)
- [../../apps/authenticated-notice-collector/.env.example](../../apps/authenticat
  ed-notice-collector/.env.example)
- [../../apps/official-web-collector/.env.example](../../apps/official-web-colle
  ctor/.env.example)
- [../../apps/wechat-official-account-collector/.env.example](../../apps/wechat-
  official-account-collector/.env.example)
- [../runbooks/provider-secret-governance.md](../runbooks/provider-secret-govern
  ance.md)
- [../runbooks/local-postgres-dev-recovery-runbook.md](../runbooks/local-postgre
  s-dev-recovery-runbook.md)
