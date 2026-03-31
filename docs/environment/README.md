---
doc_type: index
status: active
created: 2026-03-29
updated: 2026-03-31
---

# Environment

本目录定义 `campus-agent` 当前的环境配置 ownership。

## 分层规则

- repo root `.env` / [`.env.example`](../../.env.example)
  只承载 repo-root shared runtime config，例如 `apps/supervisor-api`、retrieval/Qdrant、object store、OCR provider、eval judge 与本地 dev server 监听地址
- app-local env template
  每个 app 在自己的 runtime boundary 下维护自己的本地模板，不再由 repo root `.env.example` 代管
- command-scoped override template
  一次性 rebuild / migration / replay 的 override 放在 `env/commands/*.env.example`

## 归属约束

- 只有会随 deploy 变化的资源句柄、密钥、provider 配置、运行时 host/base URL 才应留在 env
- 单次任务身份、源文档 identity、目标 scope 优先走 CLI args 或 typed request，不应长期驻留在 root `.env.example`
- repo-tracked truth 例如 `configs/ingestion/<corpus>/<collection>/runtime-profile.json`、split manifest、source projections 默认应来自 repo；env 只允许显式 override
- 不要把 root `.env.example` 当作所有 app 的统一配置入口
- Worker 本地 secrets 应留在 app 目录下的 `.dev.vars` 或 `.env`，不要提交真实值

## 当前 Ownership

- repo root [`.env.example`](../../.env.example)
  supervisor-api shared auth/audit、shared Supabase Postgres、retrieval/embedding/Qdrant、object store、OCR/raw registry、eval live benchmark profile runtime、`CAMPUS_AGENT_HTTP_HOST` / `CAMPUS_AGENT_HTTP_PORT`
- app-local [`apps/app-api/.dev.vars.example`](../../apps/app-api/.dev.vars.example)
  `app-api` 的 Worker string env，包括 auth/supervisor bridge、official_web control-plane string config，以及 `SENTRY_*` / `AXIOM_*`
- app-local [`apps/app-api/.env.example`](../../apps/app-api/.env.example)
  `app-api` 的本地 Wrangler/Drizzle process env；当前用于 Hyperdrive local connection string 与 management DB URL
- app-local [`apps/public-chat-web/.dev.vars.example`](../../apps/public-chat-web/.dev.vars.example)
  `public-chat-web` 的 Worker string env，包括 same-site app-api proxy seam 与 `SENTRY_*`
- app-local [`apps/protected-panel-web/.dev.vars.example`](../../apps/protected-panel-web/.dev.vars.example)
  `protected-panel-web` 的 protected hostname/admission string env、panel-to-app-api bridge secret 与 `SENTRY_*`
- command-scoped [`env/commands/process-raw-ingestion-job.env.example`](../../env/commands/process-raw-ingestion-job.env.example)
  `process_raw_ingestion_job` 的一次性 override
- command-scoped [`env/commands/rebuild-local-data.env.example`](../../env/commands/rebuild-local-data.env.example)
  `rebuild_local_data` 的一次性 override
- command-scoped [`env/commands/migrate-student-handbook.env.example`](../../env/commands/migrate-student-handbook.env.example)
  `migrate_student_handbook_source_faithful` 的一次性 override

## 当前状态

- 当前 root worktree `.env` 可以集中保存本地 surface-specific `Sentry` DSN 与 shared `Axiom` 值，当前 worktree 的 app-local `.dev.vars` 也可以同步为 ready 状态
- 这只说明 local development 已具备 observability preflight 条件，不等于 deploy-side secret store 与 live sink verification 已关闭
- deploy 环境仍应逐个确认 `apps/app-api`、`apps/public-chat-web`、`apps/protected-panel-web` 的 `SENTRY_*` / `AXIOM_*` 是否已正确下发

## Eval Env 约定

- repo root [`.env.example`](../../.env.example) 中的 eval 主入口已切到 `EVAL_*`
- 目前长期保留的主键包括：
  - `EVAL_LLM_*`
  - `EVAL_RAGAS_MODEL`
  - `EVAL_JUDGE_MODEL`
  - `EVAL_EMBEDDING_*`
- eval 的 HTTP timeout / retry / pacing / keep-alive / connection-pool 一类 runtime tuning 由 repo-tracked live benchmark profile config 持有，不再放在 root `.env.example`
- 代码层仍保留 `SupplementalHTTPSettings.from_env(...)` 作为低层 helper，但这不再是长期 ownership 入口

## 本地同步便利

- 如果本地把 surface-specific DSN 暂时集中存放在 root worktree `.env`，可用 `uv run --all-packages python -m scripts.sync_worker_observability_env`
  把 `SENTRY_DSN_API`、`SENTRY_DSN_CHAT`、`SENTRY_DSN_PANEL` fan out 到当前 worktree 的 app-local `.dev.vars`
- 如果要检查 root `.env` 与 app-local `.dev.vars` 是否已经对齐，可用 `uv run --all-packages python -m scripts.check_worker_observability_env --json`
- 如果本地希望直接复用 root worktree `.env` 里的共享 Supabase Postgres，可用
  `uv run --all-packages python -m scripts.sync_app_api_local_db_env`
  把 `CAMPUS_SHARED_POSTGRES_URL` fan out 到 `apps/app-api/.env` 的
  `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_APP_API_DB` 与
  `APP_API_MANAGEMENT_DATABASE_URL`
- `apps/app-api` 还会在 source `.env` 存在 `AXIOM_ENDPOINT`、`AXIOM_DATASET`、`AXIOM_TOKEN` 时同步这三个键
- `AXIOM_ENDPOINT` 应填写 Axiom `Settings -> General -> Edge deployment` 对应的 base domain，例如 `https://us-east-1.aws.edge.axiom.co`
- `AXIOM_DATASET` 应保持 service/env 级别命名，例如 `campus-agent-runtime-dev`，不要把多类信号混进一个 kitchen-sink dataset
- `apps/protected-panel-web/.dev.vars.example` 中的 `PANEL_RUNTIME_API_BASE_URL` 应指向 shared `apps/app-api`，不是 `apps/supervisor-api`
- `PANEL_APP_API_SHARED_SECRET` 与 `APP_API_INTERNAL_SHARED_SECRET` 必须保持同值
- 这些脚本只是本地 convenience，不改变 ownership：运行时仍然只消费各 app 自己的 `.dev.vars` / `.env` 或 deploy secret store
- 真正的 sink closure 仍以 `docs/runbooks/worker-observability-smoke-runbook.md` 中的 post-deploy smoke 为准

## 命令级 Override 约束

- `env/commands/*.env.example` 只放 override，不重复 shared runtime secrets
- `RAW_ASSET_ID`、`RAW_VERSION_ID`、`REPLAY_SOURCE_PDF`、`--corpus`、`--collection` 这类任务输入优先走 CLI args
- `INGESTION_SPLIT_MANIFEST_PATH`、`HANDBOOK_SOURCE_PROJECTIONS_PATH` 只在偏离 repo-tracked truth 时作为显式 override 使用
- `QDRANT_UPSERT_BATCH_SIZE`、`IMPORT_REPORT_DIR`、`HF_*`、`INGESTION_EMBEDDING_MODEL` 一类局部运行参数不再放回 root `.env.example`

## 外部依据

- 12-Factor Config: <https://12factor.net/config>
- Cloudflare Workers local env / secrets: <https://developers.cloudflare.com/workers/development-testing/environment-variables/>
- Cloudflare Workers vars / secrets: <https://developers.cloudflare.com/workers/configuration/environment-variables/>
- Cloudflare Workers secrets: <https://developers.cloudflare.com/workers/configuration/secrets/>
- Vite env exposure rules: <https://vite.dev/guide/env-and-mode>
