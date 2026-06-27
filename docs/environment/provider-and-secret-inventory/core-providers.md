---
doc_type: index
truth_scope: ops
owner_boundary: docs/environment
status: active
created: 2026-06-13
updated: 2026-06-17
---

# Provider And Secret Inventory Core Providers

<!-- markdownlint-disable MD013 -->

Split from the former mega-doc during documentation SoT cleanup. This file
owns this section group; the original path remains the stable index.

## 1. OpenAI-compatible LLM provider

当前 repo 只冻结了 contract，不冻结唯一 LLM vendor。真正需要的是：

- 一个可达的 `base_url`
- 一把 API key
- 各 online prompt role 对应的可用模型名：
  - `primary_agent`
  - `rag_synthesis`
  - `hindsight_llm`

online serving owner：

- `apps/app-api` provider-config connection + profile
- Operator Console `/operations/provider-config`
- `app-api` internal export endpoint 通过
  `/api/internal/provider-config/active?role=primary_agent` 和
  `/api/internal/provider-config/active?role=rag_synthesis` 提供 control-plane
  profile export；显式 sync job 将这些 active profiles 写入本地
  `provider_config_projection.v1` artifact
- `execution-control`、Hindsight 与 eval runtime 只消费本地 projection artifact，不在热路径调用
  app-api provider-config endpoint

默认 env 放置位置：

- local seed 使用 root `.env` 的 provider seed 输入，不再是 online serving truth；
  eval provider 隔离通过 provider-config roles 表达，不使用 command-scoped `EVAL_*`
- domain multimodal lanes 不通过 `LLM_*` fallback，也不在 root `.env.example`
  只在领域入口显式提供必备 API key 和 model；eval runtime 的 model / max token /
  reasoning / transport tuning 由 repo-tracked eval runtime profile 持有

相关键：

- local seed `LLM_BASE_URL`
- local seed `LLM_API_KEY`
- local seed `LLM_MODEL`
- optional local seed `RAG_SYNTHESIS_MODEL`
- projection path `CAMPUS_PROVIDER_CONFIG_SNAPSHOT_PATH`

获取方式：

1. 先决定每个 role 复用当前 shared provider connection，还是给 eval / Hindsight 单独拆
   provider connection。
1. 在所选供应商控制台创建项目级或环境级 API key。
1. 本地开发可填 root `.env` 后执行
   `node apps/app-api/scripts/run-with-local-env.mjs pnpm exec tsx ./scripts/seed-local-provider-config.ts`；
   staging/prod 通过 Operator Console 创建 prompt connection 与 profile，选择 role、base URL、
   model 与 API key。
1. 先 validate，再 activate；active profile 通过 explicit sync 生成
   `provider_config_projection.v1`，由 self-host runtimes 本地消费。
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
- eval provider isolation 不是默认必需项。只有预算或限流隔离需要时才给
  `eval_ragas_llm` / `eval_judge_llm` 绑定独立 connection；模型对比走 eval runtime
  profile / manifest，不走 root env
- active profile list 只返回 masked secret metadata；raw key 只通过 app-api internal
  export 进入 0600 projection artifact，不返回浏览器

## 2. Embedding provider

当前 merged truth 的 retrieval baseline 仍冻结为：

- `Qwen3-Embedding-4B`
- `dimensions=2560`
- provider enum 为 `openai-compatible`
- current endpoint reality 为 Gitee OpenAI-compatible embeddings API

相关真相见：

- [../../decisions/adr-0007-phase1-retrieval-baseline-update.md](../../decisions/adr-0
  007-phase1-retrieval-baseline-update.md)
- [../../policies/student-handbook-chunking-and-validation-policy.md](../../policies/s
  tudent-handbook-chunking-and-validation-policy.md)

online serving owner：

- `apps/app-api` provider-config connection + `rag_query_embedding` profile
- `apps/app-api` provider-config connection + `hindsight_embedding` profile
- `apps/app-api` provider-config connection + `eval_ragas_embedding` profile
- Operator Console `/operations/provider-config`
- app-api internal export endpoint 通过
  `/api/internal/provider-config/active?role=rag_query_embedding` 提供 control-plane
  profile export；显式 sync job 将 active profiles 写入本地
  `provider_config_projection.v1` artifact

默认 env 放置位置：

- root `.env` 的 `EMBEDDING_*` 只作为 local seed 输入
- ingestion 只消费 indexing / rebuild 自己的 endpoint/key；eval provider 隔离通过
  `eval_ragas_embedding` role 表达
- online retrieval 不以 root `.env` 为 truth

相关键：

- `EMBEDDING_BASE_URL`
- `EMBEDDING_API_KEY`
- local seed/default `EMBEDDING_MODEL`
- local seed/default `EMBEDDING_DIMENSIONS`
- projection path `CAMPUS_PROVIDER_CONFIG_SNAPSHOT_PATH`

获取方式：

1. 如果保持当前 baseline，不要擅自更换模型维度或 vendor。
1. 在当前 embedding vendor 控制台开通 embeddings 服务，记录 `base_url` 与 API token。
1. 通过 Operator Console 创建 embedding connection 与 profile，选择 role、base URL、
   model、API key 与 dimensions。
1. validate profile；activate 前 app-api 必须检查 active retrieval vector dimensions 兼容性。
1. 只有 ingestion / local command 需要独立 provider endpoint/key 时才额外填写 env；
   eval 独立 provider 通过 `eval_ragas_embedding` profile 配置；model、dimensions 与
   sparse profile 以 collection runtime profile / eval runtime profile 为准，不从
   `EMBEDDING_*` 或 `EVAL_EMBEDDING_*` 隐式继承。

外部参考：

- Gitee Serverless API 入口：<https://ai.gitee.com/serverless-api/>

说明：

- 上面这条链接只证明当前 vendor 存在官方 API 服务入口；具体 token 生成页面以供应商控制台当前 UI 为准
- 如果要更换 retrieval baseline，不是只改 env；还要同步 ADR / policy / eval 基线
- `index_embedding` 面向 offline indexing；online query path 消费 `rag_query_embedding`

## 3. Rerank provider

online serving owner：

- `apps/app-api` provider-config connection + `rag_reranker` profile
- collection runtime profile 显式 `reranker_enabled_by_default=true`
- app-api internal export endpoint 通过
  `/api/internal/provider-config/active?role=rag_reranker` 提供 control-plane profile
  export；execution-control 通过本地 projection artifact 消费该 profile

默认 env 放置位置：

- root `.env` 的 `RERANK_*` 只作为 optional local seed 输入
- online retrieval 不以 root `.env` 为 truth
- provider path 属于 connection `toolConfig.rerank.path`，不在 execution-control env 中猜测

相关键：

- `RERANK_BASE_URL`
- `RERANK_API_KEY`
- `RERANK_PATH`
- `RERANK_MODEL`

获取方式：

1. 在当前 rerank vendor 控制台开通 rerank 服务，记录 endpoint、API token 与实际 path。
1. 通过 Operator Console 创建 rerank connection 与 `rag_reranker` profile。
1. validate profile；runtime profile 未显式开启 reranker 时不会消费该 profile。
1. 开启 reranker 后，缺 profile、缺 path、provider 失败或 score 不完整都 fail closed，不回退到
   baseline hybrid/RRF 顺序。

## 4. Qdrant

默认放置位置：

- self-host lifecycle generated env / runtime projection
- external / non-canonical override 只放 ops-owned runtime env，不写 root `.env.example`

相关键：

- `QDRANT_URL`
- `QDRANT_API_KEY`
- `QDRANT_READ_ONLY_API_KEY`
- `QDRANT_QUERY_API_KEY`
- `QDRANT_TLS_CA_CERT_PATH`

获取方式：

1. canonical self-host runtime 默认由 lifecycle 投影
   `QDRANT_URL=http://qdrant:6333`，并生成 deploy-scoped `QDRANT_API_KEY` 与
   `QDRANT_READ_ONLY_API_KEY`。
1. 只有外接 / 非 canonical Qdrant endpoint 时才在 ops-owned runtime env 显式写入
   `QDRANT_URL`；跨 substrate、公网入口或 machine ingress 必须使用 HTTPS。
1. online execution runtime 使用 read-only key 投影出的 `QDRANT_QUERY_API_KEY`，不得用
   admin `QDRANT_API_KEY` 查询。
1. 仅 HTTPS Qdrant endpoint 需要配置 `QDRANT_TLS_CA_CERT_PATH` 指向 ops-owned CA bundle。
1. 不把 `6333` / `6334` 直接暴露到公网。

外部参考：

- self-hosted installation：<https://qdrant.tech/documentation/guides/installation/>
- self-hosted security / API key：<https://qdrant.tech/documentation/operations/security/>
- native snapshots：<https://qdrant.tech/documentation/operations/snapshots/>

说明：

- 本仓库默认不把 `:memory:` 当作真实开发 / staging retrieval backend，只把它视为测试姿态
- 当前不采用 Qdrant Cloud 作为 staging / early-production 默认方案；Cloud 相关旧方案已由
  ADR-0045 supersede

## 5. Hindsight

Hindsight 是 personal memory 的唯一 runtime substrate，负责 per-user graph、memory
extraction、dedupe / merge 与 recall。Qdrant 不再承载 personal memory。
`campus-agent` 只通过 execution-control 的官方 Go SDK 集成消费 Hindsight API；
PostgreSQL / pgvector 是 Hindsight deployment 内部组件；Hindsight LLM 与 embedding
provider 的 active key / base URL / model 由 app-api provider-config 统一治理，并由
local / staging lifecycle 投影为 Hindsight deployment env。

当前 deployment env handles：

- `PERSONAL_MEMORY_BASE_URL`
- `PERSONAL_MEMORY_API_SECRET`
- `PERSONAL_MEMORY_OWNER_SALT`

Hindsight runtime、timeout 与 recall limits 由 execution-control runtime profile
`personal_memory` 段管理。

local / staging generated self-host runtime bundle keys：

- `infra/local/.generated/runtime.env`
- staging runtime dir 下的 `secrets/runtime.env`
- `HINDSIGHT_POSTGRES_PASSWORD`
- `PERSONAL_MEMORY_API_SECRET`
- `PERSONAL_MEMORY_OWNER_SALT`
- `TEMPORAL_POSTGRES_PASSWORD`
- `EXECUTION_CONTROL_TEMPORAL_WORKFLOW_ID_SALT`
- `EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET`
- `EXECUTION_CONTROL_METRICS_BEARER_TOKEN`
- `QDRANT_API_KEY`
- `QDRANT_READ_ONLY_API_KEY`

这些键只服务 self-host runtime 内部 bundle。它们不是 repo top-level `.env` contract；staging
lifecycle 会在 ops-owned runtime dir 下生成等价值，开发者不需要手工填写。

Hindsight deployment provider projection：

- `HINDSIGHT_API_LLM_PROVIDER`
- `HINDSIGHT_API_LLM_MODEL`
- `HINDSIGHT_API_LLM_BASE_URL`
- `HINDSIGHT_API_LLM_API_KEY`
- `HINDSIGHT_API_EMBEDDINGS_PROVIDER`
- `HINDSIGHT_API_EMBEDDINGS_OPENAI_API_KEY`
- `HINDSIGHT_API_EMBEDDINGS_OPENAI_BASE_URL`
- `HINDSIGHT_API_EMBEDDINGS_OPENAI_MODEL`
- `HINDSIGHT_API_RERANKER_PROVIDER`
- `HINDSIGHT_API_TENANT_EXTENSION`
- `HINDSIGHT_API_TENANT_API_KEY`

其中 LLM 与 embedding 键来自本地 provider projection artifact 中的 app-api
provider-config active profiles：

- `hindsight_llm`
- `hindsight_embedding`

`HINDSIGHT_API_RERANKER_PROVIDER` 当前固定投影为 `rrf`，不是外部模型 provider。该统一治理
不能恢复 repo-owned `personal_memory_extraction` prompt，也不能让 app-api 直接调用
Hindsight API。

退休键，存在时必须 fail closed：

- `ZEP_BASE_URL`
- `ZEP_API_KEY`
- `ZEP_PROJECT_SALT`
- `ZEP_TIMEOUT_SECONDS`
- `ZEP_RECALL_MAX_CHARS`
- `ZEP_ASSISTANT_NAME`
- `ZEP_USER_NAME`

放置位置：

- local/staging lifecycle generated runtime env
- staging / production secret store 必须注入 `execution-control` 与 `activity-core`

获取方式：

1. 部署 self-hosted Hindsight API 及其 runtime bundle。
1. 通过 Operator Console 或 local seed 创建、验证、激活 `hindsight_llm` 与
   `hindsight_embedding` provider profiles。
1. local dev 运行 `infra/local/start-execution-control-runtime.sh`，脚本会生成
   `infra/local/.generated/runtime.env`，从 app-api active profiles 投影 Hindsight provider env，
   并注入 self-host runtime 内部 bundle secret。
1. local / staging lifecycle 会首次生成稳定 `PERSONAL_MEMORY_API_SECRET`、
   `PERSONAL_MEMORY_OWNER_SALT`、`HINDSIGHT_POSTGRES_PASSWORD`、Temporal internal
   password / salt、internal query secret、metrics token 与 self-host Qdrant keys，并
   持久化到 ops-owned generated env file。
1. local / staging 默认使用 compose 内网 `http://hindsight-api:8888`。只有外接
   Hindsight endpoint 时才覆盖 `PERSONAL_MEMORY_BASE_URL`。
1. production 如复用 compose-style self-hosted Hindsight，应沿用同样的首次生成并持久化
   约定；如使用外部 secret store，则由部署脚本写入，不要求开发者手填。
1. 不把 Hindsight API secret 或 provider raw key 写入 repo-tracked env、fixture、eval artifact
   或 docs。

说明：

- `activity-knowledge` 不需要 Hindsight secret；它只消费 `context.memory_recall` 输出的 bounded
  memory context。
- `hindsight-memory-product-path` eval profile 验证 append、recall、explicit profile memory
  upsert / disable、owner disable 与 user isolation。

## 6. Shared Postgres

当前 repo 同时存在两个姿态：

- shared / cloud Postgres
- 本地 Docker Postgres dev 恢复

默认放置位置：

- root `.env` only for `CAMPUS_SHARED_POSTGRES_URL` and
  `CAMPUS_SHARED_POSTGRES_OPERATOR_URL`
- `apps/app-api/.env` 只保存 `app-api` 本地 Wrangler / Drizzle 进程用镜像值，不是新的 owner
- registry/raw dedicated DSN keys are app/command overrides, not root `.env.example`

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

- 执行 `uv run --all-packages python -m scripts.restore_local_postgres_dev
  --execute`
- 旧 Python ingestion worker recovery runbook 正文已退出 branch tip；需要追溯时通过
  git history 恢复具体片段。

说明：

- 本地 Docker Postgres 是 `local dev / test path`，不是 deployed runtime truth
- `CAMPUS_SHARED_POSTGRES_OPERATOR_URL` 给 repo-owned operator 路径

## 7. S3-compatible object storage

默认放置位置：

- collector app-local env
- ingestion command env
- deploy secret store

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

- 按 [../../decisions/adr-0002-local-minio-conventions.md](../../decisions/adr-0002-local-minio-conventions.md)
  运行 repo-local Docker MinIO
- 创建或确保 bucket：
  - `campus-rag-source`
  - `campus-rag-derived`
- `infra/local/scripts/project-local-runtime-env.mjs` 是本地 runtime env 投影入口；默认
  `--target container` 投影 Docker DNS，`--target host` 投影本机 Node/Vite 命令可访问的
  `127.0.0.1:9000`
- `apps/campus-web/scripts/run-with-local-env.mjs` 使用 `--target host` 自动注入 repo-local
  MinIO 默认值；本地 `campus-web` docs build 不需要在当前 shell 手写 `OBJECT_STORE_*`

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

- `apps/campus-web` 在 build/deploy 阶段把 `deliveryMode=gated_asset` 同步进
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
- derived-only online runtime（例如 execution-control notice canonical body reads）只配置
  `OBJECT_STORE_DERIVED_*`
- ingestion / replay / rebuild 默认同时触达 source 与 derived，两只 bucket 都必须有可用凭据；
  shared mode 和 bucket-scoped mode 都是当前 accepted runtime contract，不是 fallback。
- `OBJECT_STORE_REGION` 在当前 repo 里是 SDK/signing 参数；如果 provider 没有公开 region
  概念，保持默认 `us-east-1` 即可，除非该 provider 文档明确要求其他值
