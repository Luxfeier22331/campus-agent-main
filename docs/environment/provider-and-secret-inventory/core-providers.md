---
doc_type: index
truth_scope: ops
owner_boundary: docs/environment
status: active
created: 2026-06-13
updated: 2026-06-13
---

# Provider And Secret Inventory Core Providers

<!-- markdownlint-disable MD013 -->

Split from the former mega-doc during documentation SoT cleanup. This file
owns this section group; the original path remains the stable index.

## 1. OpenAI-compatible LLM provider

当前 repo 只冻结了 contract，不冻结唯一 LLM vendor。真正需要的是：

- 一个可达的 `base_url`
- 一把 API key
- 至少两个可用模型名：
  - `EXECUTION_PROMPT_MODEL`
  - `AGENT_PROMPT_MODEL`

默认放置位置：

- root `.env`

相关键：

- `LLM_BASE_URL`
- `LLM_API_KEY`
- `EXECUTION_PROMPT_MODEL`
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

- [../../decisions/adr-0007-phase1-retrieval-baseline-update.md](../../decisions/adr-0
  007-phase1-retrieval-baseline-update.md)
- [../../policies/student-handbook-chunking-and-validation-policy.md](../../policies/s
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
   [Self-Hosted Qdrant Native Backup Runbook](../../runbooks/self-hosted-qdrant-native-backup-runbook.md)
   部署 single-node Qdrant。
1. 生成 deploy-scoped `QDRANT_API_KEY` 与 `QDRANT_READ_ONLY_API_KEY`，写入服务器本地
   env 或 deploy secret store。
1. 把本机或内网 Qdrant URL 写入 `QDRANT_URL`，staging / production 必须使用 HTTPS，
   例如 `https://127.0.0.1:6333`。
1. online execution runtime 使用 read-only key 投影出的 `QDRANT_QUERY_API_KEY`，不得用
   admin `QDRANT_API_KEY` 查询。
1. execution-control personal memory write path 使用 `QDRANT_WRITE_API_KEY`；staging
   可暂时由 `STAGING_INGESTION_QDRANT_API_KEY` 投影，长期应拆为单独 write-capable key。
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

- 使用 [../../runbooks/local-postgres-dev-recovery-runbook.md](../../runbooks/local-post
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

- 按 [../../decisions/adr-0002-local-minio-conventions.md](../../decisions/adr-0002-loc
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
