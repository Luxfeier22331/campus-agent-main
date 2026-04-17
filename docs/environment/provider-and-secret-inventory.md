---
doc_type: index
status: active
created: 2026-04-12
updated: 2026-04-12
---

# Provider And Secret Inventory

本文回答三个问题：

- 当前仓库哪些 provider / control plane 是真正需要的
- 各自应该把哪些键填到哪里
- 如果是新环境或新同学接手，应去哪里申请或获取这些值

它不重新定义 env ownership。分层与 deploy-side 治理仍以 [README.md](./README.md) 和 [../runbooks/provider-secret-governance.md](../runbooks/provider-secret-governance.md) 为准。

## 文档组织原则

这份文档采用的组织方式，来自当前几个成熟文档体系的共同模式：

- 把“谁拥有这些 env”和“这些 provider 怎么申请”拆成两份文档，而不是塞进一个巨大 `.env.example`
- 把 local dev 与 deploy secret store 明确分开，而不是让 root `.env` 冒充 staging / prod 真相
- 把 server-only secret 与 browser / public runtime string 明确分开
- 长 env 列表按能力域或 provider 分类，而不是只做一份按字母排序的大清单

外部参考：

- Cloudflare Workers local `.dev.vars` / `.env` 与 deploy secrets 分层：<https://developers.cloudflare.com/workers/development-testing/environment-variables/>、<https://developers.cloudflare.com/workers/configuration/secrets/>
- Next.js server-only 与 browser-exposed env 分层：<https://nextjs.org/docs/app/guides/environment-variables>
- Vercel 按 `Development / Preview / Production` 分环境管理变量：<https://vercel.com/docs/environment-variables>
- n8n 按数据库、安全、日志、外部 secrets 等分类维护 env reference：<https://docs.n8n.io/hosting/configuration/environment-variables/>

## 快速矩阵

### Repo-root shared provider

| Provider / system | 作用 | 主要 env keys | 放置位置 | 何时必需 | 获取方式 |
| --- | --- | --- | --- | --- | --- |
| OpenAI-compatible LLM provider | supervisor / specialist 在线回答，eval 默认 judge/ragas LLM | `LLM_BASE_URL` `LLM_API_KEY` `AGNO_SUPERVISOR_MODEL` `AGNO_SPECIALIST_MODEL` | root `.env` | 真实 query path、live eval | 在所选供应商控制台创建项目级 API key；如果直接用 OpenAI，按 Projects / API keys 流程创建 |
| Embedding provider | ingestion 向量化、retrieval dense lane、eval 默认 embeddings | `EMBEDDING_PROVIDER` `EMBEDDING_BASE_URL` `EMBEDDING_API_KEY` `EMBEDDING_MODEL` `EMBEDDING_DIMENSIONS` | root `.env` | indexing、retrieval、eval embeddings | 当前 baseline 是 Gitee OpenAI-compatible embeddings；需在供应商控制台开通 embeddings 服务并拿到 token / endpoint |
| Qdrant | 向量索引与 hybrid retrieval backend | `QDRANT_URL` `QDRANT_API_KEY` | root `.env` | retrieval / indexing | 在 Qdrant Cloud 创建 cluster 并在 Cluster Detail 的 API Keys 页面创建 key；自托管则自配 URL + API key |
| Shared Postgres | app-api shared DB、document/raw registry | `CAMPUS_SHARED_POSTGRES_URL` `CAMPUS_SHARED_POSTGRES_MANAGEMENT_URL` `DOCUMENT_REGISTRY_DATABASE_URL` `RAW_ASSET_REGISTRY_DATABASE_URL` | root `.env`；再 fan out 到 `apps/app-api/.env` | app-api、本地 eval ingress、registry/operator 路径 | 如果用 Supabase，在项目 Connect 面板分别取 session pooler 与 direct DSN；如果本地开发，走 Docker Postgres 恢复入口 |
| S3-compatible object storage | raw source、source truth、derived artifacts | `OBJECT_STORE_ENDPOINT` `OBJECT_STORE_ACCESS_KEY` `OBJECT_STORE_SECRET_KEY` `OBJECT_STORE_BUCKET_SOURCE` `OBJECT_STORE_BUCKET_DERIVED` | root `.env` | ingestion / replay / rebuild | 本地开发默认用 Docker MinIO；云端可用任何 S3-compatible provider，创建 bucket 与 access key 即可 |
| OCR service | canonical raw ingestion / replay，sidecar compare | `OCR_BASE_URL` `OCR_API_KEY` `OCR_PROVIDER_MODE` `OCR_MODEL` `OCR_MINERU_*` | root `.env` 或 command-scoped env | 只有 ingestion / replay / compare 需要 | canonical primary lane 当前仍要求可达的 Paddle endpoint；`OCR_MINERU_*` 只作为 `process_raw_ingestion_job` source-truth-only 的可选第二 provider |
| Eval-only provider override | eval 独立预算 / 独立限流 | `EVAL_LLM_*` `EVAL_EMBEDDING_*` `EVAL_LLM_TRANSPORT` `EVAL_RAGAS_MODEL` `EVAL_JUDGE_MODEL` | root `.env` | 只有 eval 不想复用 shared provider 时 | 在对应供应商控制台单独申请；默认不需要 |

### App-local / deploy provider

| Provider / system | 作用 | 主要 env keys | 放置位置 | 何时必需 | 获取方式 |
| --- | --- | --- | --- | --- | --- |
| Better Auth secret | `app-api` 会话签名与加密 | `BETTER_AUTH_SECRET` | `apps/app-api/.dev.vars` 或 deploy secret store | `app-api` 必需 | 自行生成高熵 secret，不是第三方平台发放 |
| Sentry | runtime error / trace / release evidence | `SENTRY_DSN` `SENTRY_ENVIRONMENT` `SENTRY_RELEASE` | 各 app `.dev.vars` 或 Cloudflare secret store | staging / prod observability，local smoke 可选 | 在 Sentry 创建项目后，从 Client Keys (DSN) 复制 DSN；需要 repo-local API lookup 时再建 auth token |
| Axiom | `app-api` runtime logs / metrics ingest | `AXIOM_ENDPOINT` `AXIOM_DATASET` `AXIOM_TOKEN` | `apps/app-api/.dev.vars` 或 Cloudflare secret store | `app-api` observability | 在 Axiom 确认 edge deployment、创建 dataset、生成 API token |
| Cloudflare Workers / Wrangler | `app-api`、`public-chat-web`、`protected-panel-web` deploy 与 secret store | shell env / secret store，不固定 repo key 名 | local shell、CI secret store、Cloudflare dashboard | 只有 Worker dev/deploy 需要 | 本机 `wrangler login`，或在 CI 下发 Cloudflare API token；Worker secret 用 `wrangler secret put`，deploy 前再用 `scripts.check_worker_secret_presence` 审计 |
| Cloudflare Access | `protected-panel-web` outer protection envelope | `ACCESS_TEAM_DOMAIN` `ACCESS_POLICY_AUD` | `apps/protected-panel-web/.dev.vars` 或 staging deploy 注入 | panel staging / prod 必需 | 在 Zero Trust 创建 self-hosted Access application，复制 team domain 与 Application Audience (AUD) Tag |

## Provider 详情

## 1. OpenAI-compatible LLM provider

当前 repo 只冻结了 contract，不冻结唯一 LLM vendor。真正需要的是：

- 一个可达的 `base_url`
- 一把 API key
- 至少两个可用模型名：
  - `AGNO_SUPERVISOR_MODEL`
  - `AGNO_SPECIALIST_MODEL`

默认放置位置：

- root `.env`

相关键：

- `LLM_BASE_URL`
- `LLM_API_KEY`
- `AGNO_SUPERVISOR_MODEL`
- `AGNO_SPECIALIST_MODEL`
- 可选 eval override：`EVAL_LLM_BASE_URL` `EVAL_LLM_API_KEY` `EVAL_LLM_TRANSPORT` `EVAL_RAGAS_MODEL` `EVAL_JUDGE_MODEL`

获取方式：

1. 先决定是否复用当前 shared provider，还是给 eval 单独拆 provider。
2. 在所选供应商控制台创建项目级或环境级 API key。
3. 记录 API base URL 和允许使用的模型名。
4. staging / prod 必须分环境单独发 key，不要复用本地开发 key。

如果直接使用 OpenAI，可参考：

- Projects / key 管理：<https://help.openai.com/en/articles/9186755-managing-your-work-in-the-api-platform-with-projects>
- API key 与生产环境实践：<https://platform.openai.com/docs/guides/production-best-practices#api-keys>

说明：

- 上述 “OpenAI 项目级 key” 是官方推荐路径；如果改用其他 OpenAI-compatible vendor，则点击路径以供应商控制台当前 UI 为准
- eval override 不是默认必需项。只有预算、限流或模型隔离需要时才单独配置

## 2. Embedding provider

当前 merged truth 的 retrieval baseline 仍冻结为：

- `Qwen3-Embedding-4B`
- `dimensions=2560`
- current provider reality 为 `gitee` OpenAI-compatible embeddings

相关真相见：

- [../decisions/adr-0007-phase1-retrieval-baseline-update.md](../decisions/adr-0007-phase1-retrieval-baseline-update.md)
- [../policies/student-handbook-chunking-and-validation-policy.md](../policies/student-handbook-chunking-and-validation-policy.md)

默认放置位置：

- root `.env`

相关键：

- `EMBEDDING_PROVIDER`
- `EMBEDDING_BASE_URL`
- `EMBEDDING_API_KEY`
- `EMBEDDING_MODEL`
- `EMBEDDING_DIMENSIONS`
- 可选 eval override：`EVAL_EMBEDDING_BASE_URL` `EVAL_EMBEDDING_API_KEY` `EVAL_EMBEDDING_MODEL` `EVAL_EMBEDDING_DIMENSIONS`

获取方式：

1. 如果保持当前 baseline，不要擅自更换模型维度或 vendor。
2. 在当前 embedding vendor 控制台开通 embeddings 服务，记录 `base_url`、API token 与模型名。
3. 把 shared runtime 值放到 root `.env`。
4. 只有 eval 需要独立 provider 时，才额外填写 `EVAL_EMBEDDING_*`。

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

获取方式：

1. 在 Qdrant Cloud 创建 cluster。
2. 从 Cluster Detail 的 **API Keys** 页面创建数据库 API key。
3. 把 cluster URL 写入 `QDRANT_URL`，把 key 写入 `QDRANT_API_KEY`。

外部参考：

- 创建 cluster：<https://qdrant.tech/documentation/cloud/create-cluster/>
- Cloud API key：<https://qdrant.tech/documentation/cloud/authentication/>
- 自托管安全与 API key：<https://qdrant.tech/documentation/guides/security/#authentication>

说明：

- 本仓库默认不把 `:memory:` 当作真实开发 / staging retrieval backend，只把它视为测试姿态
- 自托管 Qdrant 必须自己补 TLS、bind 限制和 API key；Qdrant 文档明确说明默认自托管实例并不安全

## 4. Shared Postgres

当前 repo 同时存在两个姿态：

- shared / cloud Postgres
- 本地 Docker Postgres dev 恢复

默认放置位置：

- root `.env`
- `apps/app-api/.env` 只保存 `app-api` 本地 Wrangler / Drizzle 进程用镜像值，不是新的 owner

相关键：

- `CAMPUS_SHARED_POSTGRES_URL`
- `CAMPUS_SHARED_POSTGRES_MANAGEMENT_URL`
- `DOCUMENT_REGISTRY_DATABASE_URL`
- `RAW_ASSET_REGISTRY_DATABASE_URL`
- `apps/app-api/.env`
  - `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_APP_API_DB`
  - `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_APP_API_DB_FRESH`
  - `APP_API_MANAGEMENT_DATABASE_URL`

如果使用 Supabase：

1. 打开项目 **Connect** 面板。
2. 复制 session pooler DSN 作为 `CAMPUS_SHARED_POSTGRES_URL`。
3. 复制 direct connection DSN 作为 `CAMPUS_SHARED_POSTGRES_MANAGEMENT_URL`。
4. 不要把 transaction pooler DSN 填到 management URL。

外部参考：

- <https://supabase.com/docs/guides/database/connecting-to-postgres>

如果使用本地 Docker Postgres：

- 使用 [../runbooks/local-postgres-dev-recovery-runbook.md](../runbooks/local-postgres-dev-recovery-runbook.md)
- 或直接执行 `uv run --all-packages python -m scripts.restore_local_postgres_dev --execute`

说明：

- 本地 Docker Postgres 是 `local dev / test path`，不是 deployed runtime truth
- `CAMPUS_SHARED_POSTGRES_MANAGEMENT_URL` 只给 migration / DBA / offline operator 路径，不给普通 app 流量复用

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

- 按 [../decisions/adr-0002-local-minio-conventions.md](../decisions/adr-0002-local-minio-conventions.md) 运行 Docker MinIO
- 创建或确保 bucket：
  - `campus-rag-source`
  - `campus-rag-derived`

云端获取方式：

1. 选择任意 S3-compatible provider。
2. 创建 source / derived buckets。
3. 生成 access key / secret key。
4. 填写 endpoint 与 bucket 名。

凭据姿态：

- 默认优先使用一套 shared `OBJECT_STORE_ACCESS_KEY` / `OBJECT_STORE_SECRET_KEY` 访问两只 bucket
- 如果 provider / control plane 只能为不同 bucket 发不同凭据，repo 现在也接受 bucket-scoped credential pairs：
  - `OBJECT_STORE_SOURCE_ACCESS_KEY` / `OBJECT_STORE_SOURCE_SECRET_KEY`
  - `OBJECT_STORE_DERIVED_ACCESS_KEY` / `OBJECT_STORE_DERIVED_SECRET_KEY`
- source-only collector（例如 `official-web-collector`、`authenticated-notice-collector`）可以只配置 `OBJECT_STORE_SOURCE_*`
- ingestion / replay / rebuild 默认同时触达 source 与 derived，两只 bucket 都必须有可用凭据；可以是 shared pair，也可以是 source+derived 两组分桶凭据
- `OBJECT_STORE_REGION` 在当前 repo 里是 SDK/signing 参数；如果 provider 没有公开 region 概念，保持默认 `us-east-1` 即可，除非该 provider 文档明确要求其他值

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

- canonical lane：
  - `OCR_PROVIDER_MODE=paddleocr_async_jobs`
  - 需要团队已部署好的 Paddle endpoint 与 service token
- optional second-provider lane：
  - `OCR_MINERU_PROVIDER_MODE=mineru_api`
  - 当前用于 `process_raw_ingestion_job` 的 `source_truth_only` 条件式 typed-PDF 路由、`generic_image` 双跑判型，以及 `campus-ingestion-compare-online-ocr`
  - 建议写在命令级 env 副本里，不要把 primary `OCR_PROVIDER_MODE` 改成 `mineru_api`

相关内部文档：

- [../../apps/ingestion-worker/README.md](../../apps/ingestion-worker/README.md)
- [../decisions/adr-0033-internal-notice-pdf-cloud-ocr-default.md](../decisions/adr-0033-internal-notice-pdf-cloud-ocr-default.md)

外部参考：

- MinerU API / model docs：<https://mineru.net/doc/docs/index_en/>
- MinerU output files（`full.md`、`content_list*.json`、`layout.json`）：<https://opendatalab.github.io/MinerU/reference/output_files/>

说明：

- canonical Paddle lane 当前是 team-owned endpoint contract，不是 repo 内置的公共 SaaS 开户流程
- primary `OCR_PROVIDER_MODE=mineru_api` 仍被 `process_raw_ingestion_job` 显式拒绝，不可冒充 canonical raw ingestion provider
- `OCR_MINERU_*` 现在只是受控补充入口：当前 repo 把它接入 `source_truth_only` 的 typed-PDF 条件路由与 `generic_image` 双跑判型，并在 MinerU 胜出时额外保留 `provider-response-raw.zip` provenance sidecar；`ocr-routing-decision.json` 会记录双跑后的 refined asset type 与 canonical provider 选择
- MinerU 官方文档虽然支持 Office 类型，但当前 repo 的 canonical raw-ingestion 归一化和 split-manifest 仍是 PDF/image-first，因此 Office 接入继续归入 follow-up，不在当前默认 canonical scope

## 7. Better Auth

当前 merged truth 不要求任何 GitHub / Google / WeChat OAuth provider key。

`app-api` 当前只启用了：

- `emailAndPassword.enabled = true`

默认放置位置：

- `apps/app-api/.dev.vars`
- deploy-side secret store

相关键：

- `BETTER_AUTH_SECRET`

获取方式：

1. 自行生成高熵 secret。
2. 长度至少 32 个字符。
3. 推荐直接使用：
   `openssl rand -base64 32`

外部参考：

- <https://www.better-auth.com/docs/installation>

说明：

- 这不是第三方平台发的 credential
- 如果未来重新引入 social provider，再额外为对应 provider 增加 client ID / secret；那是未来范围，不是当前 merged truth

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

- `SENTRY_DSN_API`
- `SENTRY_DSN_CHAT`
- `SENTRY_DSN_PANEL`
- `SENTRY_API_TOKEN`

获取方式：

1. 在 Sentry 为每个运行面创建独立 project。
2. 从项目的 **Client Keys (DSN)** 页面复制 DSN。
3. 如果需要 repo-local API lookup、artifact 查询或 smoke 脚本访问 API，再创建 auth token。

外部参考：

- DSN 说明与获取入口：<https://docs.sentry.io/concepts/key-terms/dsn-explainer/>
- API auth token：<https://docs.sentry.io/api/auth/>
- 组织级 auth token 教程：<https://docs.sentry.io/api/guides/create-auth-token/>

说明：

- `SENTRY_API_TOKEN` 不是 Worker runtime secret，不应同步到 `.dev.vars`
- 一个前端、一个后端通常应分不同 Sentry project / DSN；Sentry 官方也建议多组件拆 project

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
2. 在 **Settings > Datasets and views** 创建 dataset。
3. 在 **Settings > API tokens** 创建 API token。
4. 把 edge deployment 对应的 base domain 作为 `AXIOM_ENDPOINT`。

外部参考：

- token：<https://axiom.co/docs/reference/tokens>
- dataset：<https://axiom.co/docs/reference/datasets>
- edge deployment / base domain：<https://axiom.co/docs/reference/edge-deployments>

说明：

- `AXIOM_ENDPOINT` 应写成类似 `https://us-east-1.aws.edge.axiom.co`
- `AXIOM_DATASET` 应按 service / env 维度命名，不要做 kitchen-sink dataset；这与 Axiom 官方 dataset best practice 一致
- 当前 `.dev.vars.example` 已明确要求使用 ingest API token，不要把 PAT 当成长期 ingest token

## 10. Cloudflare Workers / Wrangler

这不是业务 provider，但它是当前三个 Worker app 的 deploy control plane。

涉及运行面：

- `apps/app-api`
- `apps/public-chat-web`
- `apps/protected-panel-web`

获取方式：

1. 本机开发或手工发布时，使用 `wrangler login`。
2. CI / automation 时，使用 Cloudflare API token。
3. 部署侧 secret 用 `wrangler secret put` 或 dashboard 写入。
4. staging 发布前，用
   `uv run --all-packages python -m scripts.check_worker_secret_presence --env staging --json`
   审计 Cloudflare secret store 是否已包含当前 `wrangler.toml` 声明的 required secrets。

外部参考：

- Wrangler commands：<https://developers.cloudflare.com/workers/wrangler/commands/general/>
- Worker secrets：<https://developers.cloudflare.com/workers/configuration/secrets/>

说明：

- repo-tracked `.dev.vars.example` 只是本地模板，不是 staging / prod secret source
- deploy environment 的 secret truth 仍在 Cloudflare secret store
- 当前 repo 还把 Worker secret contract 显式写进各 app 的 `wrangler.toml` `secrets.required`
- Cloudflare 官方把 `secrets` 归类为 non-inheritable config，因此命名环境必须各自声明自己的 required secret 集，不能假定从 top-level 自动继承
- `scripts.check_worker_secret_presence` 会按这个 non-inheritable contract 只审计当前环境自己的 required secret 集，不会把 top-level required 集误算成命名环境必需项
- 当前仓库的 deploy / whoami / secret-audit 入口默认会剥离继承来的代理 env，再直连 Cloudflare API；这是 repo-local execution rule，不改变 Cloudflare 平台本身的 secret ownership

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
2. 复制 team domain。
3. 在应用基本信息页复制 **Application Audience (AUD) Tag**。

外部参考：

- self-hosted app 创建：<https://developers.cloudflare.com/cloudflare-one/applications/configure-apps/self-hosted-apps/>
- application token 与 `aud` 字段：<https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/application-token/>
- 获取 AUD tag：<https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/>

说明：

- `ACCESS_TEAM_DOMAIN` 与 `ACCESS_POLICY_AUD` 当前不再硬编码进 repo-tracked staging config
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
  - `PUBLIC_CHAT_WEB_ORIGIN`
  - `SUPERVISOR_API_*`
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
- compare-only `mineru_api`，除非你真的要跑 OCR sidecar 对照

## 相关仓库文档

- [README.md](./README.md)
- [../../.env.example](../../.env.example)
- [../../apps/app-api/.env.example](../../apps/app-api/.env.example)
- [../../apps/app-api/.dev.vars.example](../../apps/app-api/.dev.vars.example)
- [../../apps/public-chat-web/.dev.vars.example](../../apps/public-chat-web/.dev.vars.example)
- [../../apps/protected-panel-web/.dev.vars.example](../../apps/protected-panel-web/.dev.vars.example)
- [../../apps/official-web-collector/.env.example](../../apps/official-web-collector/.env.example)
- [../runbooks/provider-secret-governance.md](../runbooks/provider-secret-governance.md)
- [../runbooks/local-postgres-dev-recovery-runbook.md](../runbooks/local-postgres-dev-recovery-runbook.md)
