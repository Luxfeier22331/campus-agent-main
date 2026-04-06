---
doc_type: index
status: active
created: 2026-03-29
updated: 2026-04-05
---

# Environment

本目录定义 `campus-agent` 当前的环境配置 ownership。

## 分层规则

- repo root `.env` / [`.env.example`](../../.env.example)
  只承载 repo-root shared runtime config，例如 `apps/supervisor-api`、shared LLM/embedding provider、retrieval/Qdrant、object store、OCR provider、eval model selection 与本地 dev server 监听地址
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
  supervisor-api shared auth/audit、shared LLM/embedding provider、shared Supabase Postgres、retrieval/embedding/Qdrant、object store、OCR/raw registry、eval live benchmark model selection、本地 Python eval runner 连接 `app-api` 的 ingress 参数、`CAMPUS_AGENT_HTTP_HOST` / `CAMPUS_AGENT_HTTP_PORT`
- app-local [`apps/app-api/.dev.vars.example`](../../apps/app-api/.dev.vars.example)
  `app-api` 的 Worker string env，包括 auth/supervisor bridge、official_web control-plane string config，以及 `SENTRY_*` / `AXIOM_*`
- app-local [`apps/app-api/.env.example`](../../apps/app-api/.env.example)
  `app-api` 的本地 Wrangler/Drizzle process env；当前用于 Hyperdrive local connection string 与 management DB URL
- app-local [`apps/public-chat-web/.dev.vars.example`](../../apps/public-chat-web/.dev.vars.example)
  `public-chat-web` 的 Worker string env，包括 same-site app-api proxy seam 与 `SENTRY_*`
- app-local [`apps/protected-panel-web/.dev.vars.example`](../../apps/protected-panel-web/.dev.vars.example)
  `protected-panel-web` 的本地 admission string env、panel-to-app-api bridge secret 与 `SENTRY_*`；protected hostname 由 `wrangler.toml` Custom Domain deploy config 持有，staging `ACCESS_TEAM_DOMAIN` / `ACCESS_POLICY_AUD` 不再作为 repo-tracked 默认值硬编码
- command-scoped [`env/commands/process-raw-ingestion-job.env.example`](../../env/commands/process-raw-ingestion-job.env.example)
  `process_raw_ingestion_job` 的一次性 override
- command-scoped [`env/commands/rebuild-local-data.env.example`](../../env/commands/rebuild-local-data.env.example)
  `rebuild_local_data` 的一次性 override
- command-scoped [`env/commands/migrate-student-handbook.env.example`](../../env/commands/migrate-student-handbook.env.example)
  `migrate_student_handbook_source_faithful` 的一次性 override

## 当前状态

- 当前 root worktree `.env` 可以集中保存本地 surface-specific `Sentry` DSN 与 shared `Axiom` 值，当前 worktree 的 app-local `.dev.vars` 也可以同步为 ready 状态
- 2026-04-02 已再次完成一次本地 observability readiness 复核：`check_worker_observability_env --json` 仍为 `overall_ready=true`，且 `apps/app-api`、`apps/public-chat-web`、`apps/protected-panel-web` 的 targeted Worker smoke 再次通过
- 这意味着 `Pre-Deploy Readiness` 已闭环；它不自动推出 deploy-side secret store 与 live sink verification 已关闭
- 对 deploy 环境的 `SENTRY_*` / `AXIOM_*` 下发确认与 live sink smoke，应在首个真实部署环境创建后作为 deployment gate 执行，而不是把“尚未部署”写成当前 repo blocker
- 真实环境 smoke 的 handoff / evidence 骨架现已落在 `docs/runbooks/worker-observability-smoke-artifact-template.md`

## Deploy Env 约定

- 当前首个真实部署环境固定为 `staging`
- 当前 staging hostname mapping 固定为：
  - `apps/app-api` -> `https://campus-api-staging.ayafeed.com`
  - `apps/public-chat-web` -> `https://campus-chat-staging.ayafeed.com`
  - `apps/protected-panel-web` -> `https://campus-panel-staging.ayafeed.com`
- 当前 Cloudflare tier 下，不再把 `*.rag.ayafeed.com` 这类深一级 staging custom domain 作为可依赖的 SSL deploy truth；forward staging hostnames 必须统一使用 `ayafeed.com` 下一级子域
- `ayafeed.com` 是共享 zone，generic 一级子域（例如 `api-staging.ayafeed.com`）不能继续假定为本 repo 可占用；staging hostname 必须带项目隔离前缀，避免与其他仓库或既有环境冲突
- 当前阶段不冻结 `apps/supervisor-api` 的 staging hostname；`app-api` deploy 时必须显式注入当轮可达的 `STAGING_SUPERVISOR_API_BASE_URL`
- 这些 deploy hostnames 由各 app 自己的 `wrangler.toml` 中 `env.staging` 持有，不写回 `.dev.vars.example`；repo 中若仍残留 `*.rag.ayafeed.com`，应视为待迁移实现残留，不再代表 staging deploy truth
- `apps/app-api` 这类直接由 Wrangler 发布的 Worker 使用 `STAGING_SUPERVISOR_API_BASE_URL=... pnpm --dir apps/app-api deploy:staging`
- 真实 deploy 命令直接消费当前 shell 的 `wrangler` 登录态；repo-local `.wrangler-home` 只保留给 dev / test / local build
- `apps/protected-panel-web` staging deploy 还必须显式注入 `STAGING_ACCESS_TEAM_DOMAIN` 与 `STAGING_ACCESS_POLICY_AUD`；这两个值不再写进 `wrangler.toml`，且占位默认值会被 deploy 脚本拒绝
- `apps/public-chat-web` 与 `apps/protected-panel-web` 这类 Vite Worker 使用 `CLOUDFLARE_ENV=staging vite build` 选择 deploy env，并发布生成后的 `dist/*/wrangler.json`
- deploy secret truth 仍在 Cloudflare secret store，不在 repo-tracked `.dev.vars.example`
- 具体 staging 资源、secret matrix、deploy order 与 post-deploy smoke 见 `docs/runbooks/staging-worker-deploy-runbook.md`
- 外部依据：Cloudflare 对 subdomain / Universal SSL 的说明见 <https://developers.cloudflare.com/fundamentals/setup/manage-domains/manage-subdomains/>

## Eval Env 约定

- repo root [`.env.example`](../../.env.example) 中的共享 provider 真相默认来自：
  - `LLM_*`
  - `EMBEDDING_*`
- eval 长期保留的链路级键包括：
  - `EVAL_RAGAS_MODEL`
  - `EVAL_JUDGE_MODEL`
- 只有在 eval 需要独立 provider、独立预算或独立限流时，才使用：
  - `EVAL_LLM_*`
  - `EVAL_EMBEDDING_*`
- `packages/evals` settings 仍只读取进程环境；repo-shipped Python CLI entrypoint 只会在本地自动 bootstrap 当前 worktree `.env`
- 当前实现与测试都不接受 silent fallback 到根 worktree `.env`
- ad-hoc `uv run ... python - <<'PY'` / REPL 默认不会自动 bootstrap `.env`；这类临时脚本必须先显式注入环境，或显式调用 `campus_shared.load_repo_env()`
- 如果要判断当前 worktree 的 provider/env 是否真的对 eval surface 可见，优先使用
  `uv run --all-packages python -m scripts.doctor_env evals --json`
- eval 的 HTTP timeout / retry / pacing / keep-alive / connection-pool 一类 runtime tuning 由 repo-tracked live benchmark profile config 持有，不再放在 root `.env.example`
- 代码层仍保留 `SupplementalHTTPSettings.from_env(...)` 作为低层 helper，但这不再是长期 ownership 入口
- 这条链路的长期重构计划见 [`docs/plans/env-bootstrap-and-provider-configuration-governance.md`](../plans/env-bootstrap-and-provider-configuration-governance.md)

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
- 真正的 sink closure 仍以 `docs/runbooks/worker-observability-smoke-runbook.md` 中的 `Post-Deploy Verification` 为准

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
