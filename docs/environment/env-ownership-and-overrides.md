---
doc_type: reference
truth_scope: ops
owner_boundary: docs/environment
status: active
created: 2026-04-20
updated: 2026-06-28
---
# Environment Ownership And Overrides

## 文档边界

本文只负责环境配置的 ownership、分层和 override 规则。

它回答的是：

- 哪些值属于 repo root shared env
- 哪些值属于 app-local env
- 哪些值只应作为 command-scoped override
- 本地 runtime 与 convenience script 分别服务什么边界

它不负责：

- provider / secret 获取方式
- staging deploy 步骤
- post-deploy smoke

相关文档：

- `providers.md`
- `readiness.md`
- `../runbooks/provider-secret-governance.md`

## Layering Rules

### Repo root `.env` / `.env.example`

只承载 repo-root shared database handles：

- `CAMPUS_SHARED_POSTGRES_URL`
- `CAMPUS_SHARED_POSTGRES_OPERATOR_URL`

repo root `.env.example` 不承载 provider profile、Qdrant、object store、OCR、eval ingress、
execution-control runtime 或 domain multimodal registry。`internal notice`、`curriculum
course-map`、`handbook service navigation` 等离线/领域链路只把必备 credential/model 作为领域入口配置；
base URL、reasoning effort、max output tokens、transport 等 tuning 走代码默认、CLI 参数或领域配置，
不回流成 root env contract。

provider-config 本地 seed 输入也不放在 root `.env.example`。需要初始化或更新
app-api provider-config active profiles 时，使用 command-scoped
[`env/commands/provider-config-seed.env.example`](../../env/commands/provider-config-seed.env.example)。
该模板只服务 seed command；online serving 仍消费 app-api provider-config 与显式
projection artifact。

### App-local env template

每个 app 在自己的 runtime boundary 下维护自己的模板，不再由 repo root `.env.example` 代管。

### Command-scoped override template

默认 operator override 放在 `env/commands/*.env.example`。旧 Python ingestion
closeout / rebuild / release command env 不再作为 tracked fallback surface；需要重建时按
`apps/ingestion-control` task registry / executor seam 重新建模。

## Ownership Matrix

### Repo root shared env

- [`.env.example`](../../.env.example)
  - shared Postgres runtime / operator DSN handles only

### App-local env

- [`apps/app-api/.dev.vars.example`](../../apps/app-api/.dev.vars.example)
  - `app-api` Worker runtime string env
- [`apps/app-api/.env.example`](../../apps/app-api/.env.example)
  - `app-api` Wrangler / Drizzle process env
- [`apps/campus-web/.dev.vars.example`](../../apps/campus-web/.dev.vars.example)
  - `campus-web` Worker runtime string env
- [`apps/authenticated-notice-collector/.env.example`](../../apps/authenticated-notice-collector/.env.example)
  - `authenticated-notice-collector` portal auth、collector ledger/lease、source-bucket
    runtime env
- [`apps/official-web-collector/.env.example`](../../apps/official-web-collector/.env.example)
  - `official-web-collector` control-plane 与 source-bucket runtime env
- [`apps/wechat-official-account-collector/.env.example`](../../apps/wechat-official-account-collector/.env.example)
  - `wechat-official-account-collector` FeedWe credentials、control-plane 与 source-bucket
    runtime env
- [`apps/operator-console-web/.dev.vars.example`](../../apps/operator-console-web/.dev.vars.example)
  - `operator-console-web` Worker string env
- [`infra/otel/collector.env.example`](../../infra/otel/collector.env.example)
  - local/staging OTel collector process env

### Command-scoped override

- [`env/commands/execution-control-runtime.env.example`](../../env/commands/execution-control-runtime.env.example)
- [`env/commands/provider-config-seed.env.example`](../../env/commands/provider-config-seed.env.example)
- [`env/commands/legacy-office-conversion-service.env.example`](../../env/commands/legacy-office-conversion-service.env.example)

## Override Rules

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
- K8s / Worker / Docker / app-api provider-config 各自使用成熟组件交付配置；
  repo 级 policy 只做跨 surface contract 与 static drift check，不承担运行时配置平台职责
- `OCR_PROVIDER_MODE` 必须显式设置，不依赖 `OCR_BASE_URL` 推断 provider
- `OCR_MINERU_*` 只表示附加 MinerU lane config，不表示 repo 级“second provider canonical
  truth”
- `RAW_ASSET_ID`、`RAW_VERSION_ID`、`REPLAY_SOURCE_PDF`、`--corpus`、`--collection`
  等任务输入优先走 CLI args

## App API Local Runtime

- `apps/app-api` 本地 `pnpm dev` 固定走 `wrangler dev -e local`
- `apps/app-api/.env` 负责 Wrangler / Drizzle process env
- `apps/app-api/.dev.vars` 负责 Worker runtime string env
- `apps/official-web-collector/.env` 负责 collector 到 `app-api` 的 control-plane
  seam

## Feature Worktree Local Env

Feature worktrees do not receive ignored `.env` / `.dev.vars` files from Git.
After creating or switching into `.worktrees/*`, link local env files from the
root worktree:

```bash
uv run --all-packages python -m scripts.link_worktree_app_local_env \
  --repo-root "$PWD"
```

This creates symlinks and refuses to replace existing non-symlink targets. Do
not copy secrets between worktrees.

## Convenience Scripts

- `uv run --all-packages python -m scripts.sync_worker_observability_env`
- `uv run --all-packages python -m scripts.check_worker_observability_env
  --json`
- `uv run --all-packages python -m scripts.check_sentry_lookup_access --json`
- `uv run --all-packages python -m scripts.sync_app_api_local_db_env`

对应 runbook：

- `docs/runbooks/provider-secret-governance.md`
- `docs/runbooks/local-runtime-smoke.md`
- `docs/runbooks/legacy-office-conversion-runtime.md`
- `docs/runbooks/worker-observability-smoke.md`
