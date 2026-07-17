---
doc_type: reference
owner_boundary: docs/environment
status: active
---
<!-- markdownlint-disable MD013 -->

# 环境配置所有权

## 文档边界

本文只负责环境配置的所有权、分层和覆盖规则。

它回答的是：

- 哪些值属于仓库根共享环境；
- 哪些值属于应用本地环境；
- 哪些值只用于单条命令；
- 本地运行时与辅助脚本各自服务什么边界。

它不负责：

- 供应商与密钥获取方式
- staging 部署步骤
- 部署后冒烟测试

相关文档：

- `providers.md`
- `readiness.md`
- `../runbooks/provider-secrets.md`

## 分层规则

### 仓库根 `.env` 与 `.env.example`

只承载 repo-root shared database handles：

- `CAMPUS_SHARED_POSTGRES_URL`
- `CAMPUS_SHARED_POSTGRES_OPERATOR_URL`

repo root `.env.example` 不承载 provider profile、Qdrant、object store、OCR、eval ingress、
execution-control runtime 或 domain multimodal registry。`internal notice`、`curriculum
course-map`、`handbook service navigation` 等离线/领域链路只把必备 credential/model 作为领域入口配置；
base URL、reasoning effort、max output tokens、transport 等 tuning 走代码默认、CLI 参数或领域配置，
不回流成 root env contract。

Provider Config 不使用 seed command。Ops Web 本地运行读取自身 `.env`，验证后原子写入
`OPS_WEB_PROVIDER_CONFIG_PROJECTION_PATH`；线上由同一应用发布固定 Kubernetes Secret。

### 应用环境模板

每个 app 在自己的 runtime boundary 下维护自己的模板，不再由 repo root `.env.example` 代管。

### 命令环境模板

默认 operator override 放在 `env/commands/*.env.example`。旧 Python ingestion
closeout / rebuild / release command env 不再作为 tracked fallback surface；需要重建时按
`apps/ingestion-control` task registry / executor seam 重新建模。

## 所有权清单

### 仓库根共享环境

- [`.env.example`](../../.env.example)
  - 只保存共享 PostgreSQL 运行时和运维 DSN 句柄

### 应用本地环境

- [`apps/app-api/.dev.vars.example`](../../apps/app-api/.dev.vars.example)
  - `app-api` Worker 运行时字符串环境变量
- [`apps/app-api/.env.example`](../../apps/app-api/.env.example)
  - `app-api` Wrangler 与 Drizzle 进程环境变量
- [`apps/campus-web/.dev.vars.example`](../../apps/campus-web/.dev.vars.example)
  - `campus-web` Worker 运行时字符串环境变量
- [`apps/source-collector/adapters/internal-portal/.env.example`][source-collector-internal-portal-env]
  - `source-collector` internal-portal 适配器的门户认证、采集策略和来源桶运行环境
- [`apps/source-collector/adapters/official-web/.env.example`][source-collector-official-web-env]
  - `source-collector` official-web 来源配置和来源桶运行环境
- [`apps/source-collector/adapters/wechat-official-account/.env.example`][source-collector-wechat-env]
  - `source-collector` wechat-official-account 适配器 FeedWe 凭据和来源桶运行环境
- [`apps/ops-web/.env.example`](../../apps/ops-web/.env.example)
  - Ops Web 本地数据库、Access 和 Provider Config file publisher 配置
- [`infra/otel/collector.env.example`](../../infra/otel/collector.env.example)
  - 本地与 staging OTel Collector 进程环境变量

### 命令环境

- [`env/commands/execution-control-runtime.env.example`](../../env/commands/execution-control-runtime.env.example)
- [`env/commands/campus-docs-release.env.example`](../../env/commands/campus-docs-release.env.example)

Campus Web staging 文档候选不使用 manifest key/SHA 环境变量。构建通过显式
`docsReleaseId` 推导内容地址；常规构建读取 GitOps 已选 release，手动 promotion 使用 typed
workflow input。derived bucket 只读凭据只注入 Campus Web 构建步骤，Worker runtime 只保存
与该版本绑定的 `DOCS_RELEASE_ID`。

## 覆盖规则

- env 只承载会随 deploy 或 runtime 变化的资源句柄、密钥、provider 配置、运行时 host/base URL
- self-hosted Qdrant 的 URL 与 key 由 local/staging lifecycle 约定、生成并投影；
  root env 不维护 `QDRANT_*`
- provider canonical env 优先于 sink / exporter 派生 env。典型例子是 Langfuse：
  `LANGFUSE_BASE_URL`、`LANGFUSE_PUBLIC_KEY`、`LANGFUSE_SECRET_KEY` 与
  `LANGFUSE_ENVIRONMENT` 是 staging closeout canonical config；
  `OTEL_COLLECTOR_LANGFUSE_OTLP_ENDPOINT`、`OTEL_COLLECTOR_LANGFUSE_AUTH_HEADER`
  和 `OTEL_COLLECTOR_LANGFUSE_INGESTION_VERSION` 是 Collector deploy/render
  输出或 closeout 脚本派生值，不应作为手工维护的第二份 truth
- 单次任务身份、源文档 identity、目标 scope 优先走 CLI args 或 typed request
- repo-tracked truth 默认来自 config / manifest / source projection，而不是 env
- K8s、Worker、Docker 和 Ops Web 各自使用成熟组件交付配置；
  repo 级 policy 只做跨 surface contract 与 static drift check，不承担运行时配置平台职责
- `RAW_ASSET_ID`、`RAW_VERSION_ID`、`REPLAY_SOURCE_PDF`、`--corpus`、`--collection`
  等任务输入优先走 CLI args

## App API 本地运行

- `apps/app-api` 本地 `pnpm dev` 固定走 `wrangler dev -e local`
- `apps/app-api/.env` 负责 Wrangler / Drizzle process env
- `apps/app-api/.dev.vars` 负责 Worker runtime string env
- `apps/source-collector/adapters/*/.env` 只供 source-collector 本地进程读取；
  app-api 不读取 collector env，也不拥有 collector control plane

## 功能 Worktree 本地环境

Git 不会向功能 worktree 带入被忽略的 `.env` 或 `.dev.vars`。每个 worktree 必须使用该
检出目录自己的本地环境文件，或使用开发者的本地密钥管理器。不得在 worktree 之间复制
密钥，也不得依赖仓库脚本分发被忽略的环境文件。

## 检查入口

- 本地 Worker 观测环境：`pnpm exec tsx scripts/deploy/doctor-env.ts
  worker-observability-local --json`；
- 已部署 Worker 密钥存在性：`pnpm exec tsx
  scripts/deploy/check-worker-secret-presence.ts --env staging --json`；
- 外部平台核验：运维工作站使用 Sentry、Axiom 界面或其官方 API；仓库不维护 Sentry 查询
  辅助脚本。

[source-collector-internal-portal-env]: ../../apps/source-collector/adapters/internal-portal/.env.example
[source-collector-official-web-env]: ../../apps/source-collector/adapters/official-web/.env.example
[source-collector-wechat-env]: ../../apps/source-collector/adapters/wechat-official-account/.env.example

对应 runbook：

- `docs/runbooks/provider-secrets.md`
- `docs/runbooks/local-smoke.md`
- `docs/runbooks/worker-otel.md`
