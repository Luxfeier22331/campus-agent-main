---
doc_type: index
status: active
created: 2026-03-29
updated: 2026-04-12
---

# Environment

本目录定义 `campus-agent` 当前的环境配置 ownership。

## 分层规则

- repo root `.env` / [`.env.example`](../../.env.example)
  只承载 repo-root shared runtime config，例如 `apps/supervisor-api`、shared LLM/embedding provider、retrieval/Qdrant、object store、OCR provider、eval model selection 与本地 dev server 监听地址
- app-local env template
  每个 app 在自己的 runtime boundary 下维护自己的本地模板，不再由 repo root `.env.example` 代管
- command-scoped override template
  当前默认 operator override 放在 `env/commands/*.env.example`；只为历史 closeout / narrow recovery 保留的模板迁到 `env/commands/historical/*.env.example`

## 归属约束

- 只有会随 deploy 变化的资源句柄、密钥、provider 配置、运行时 host/base URL 才应留在 env
- 单次任务身份、源文档 identity、目标 scope 优先走 CLI args 或 typed request，不应长期驻留在 root `.env.example`
- repo-tracked truth 例如 `configs/ingestion/<corpus>/<collection>/runtime-profile.json`、split manifest、source projections 默认应来自 repo；env 只允许显式 override
- 不要把 root `.env.example` 当作所有 app 的统一配置入口
- Worker 本地 secrets 应留在 app 目录下的 `.dev.vars` 或 `.env`，不要提交真实值

## 当前 Ownership（默认协作面）

- repo root [`.env.example`](../../.env.example)
  supervisor-api shared auth/audit、shared LLM/embedding provider、shared Supabase Postgres、retrieval/embedding/Qdrant、object store、OCR/raw registry、eval live benchmark model selection、本地 Python eval runner 连接 `app-api` 的 ingress 参数、`CAMPUS_AGENT_HTTP_HOST` / `CAMPUS_AGENT_HTTP_PORT`
- app-local [`apps/app-api/.dev.vars.example`](../../apps/app-api/.dev.vars.example)
  `app-api` 的 Worker string env，包括 auth/supervisor bridge、official_web control-plane string config，以及 `SENTRY_*` / `AXIOM_*`
- app-local [`apps/app-api/.env.example`](../../apps/app-api/.env.example)
  `app-api` 的本地 Wrangler/Drizzle process env；当前用于 Hyperdrive local connection string 与 management DB URL
- app-local [`apps/official-web-collector/.env.example`](../../apps/official-web-collector/.env.example)
  `official-web-collector` 的 Docker/cron runtime env，包括 `app-api` control-plane base URL、service token 与可选默认 lane/trigger/trace
- app-local [`apps/public-chat-web/.dev.vars.example`](../../apps/public-chat-web/.dev.vars.example)
  `public-chat-web` 的 Worker string env，包括 same-site app-api proxy seam 与 `SENTRY_*`
- app-local [`apps/protected-panel-web/.dev.vars.example`](../../apps/protected-panel-web/.dev.vars.example)
  `protected-panel-web` 的本地 admission string env、panel-to-app-api bridge secret 与 `SENTRY_*`；protected hostname 由 `wrangler.toml` Custom Domain deploy config 持有，staging `ACCESS_TEAM_DOMAIN` / `ACCESS_POLICY_AUD` 不再作为 repo-tracked 默认值硬编码
- command-scoped [`env/commands/process-raw-ingestion-job.env.example`](../../env/commands/process-raw-ingestion-job.env.example)
  `process_raw_ingestion_job` 的一次性 override
- command-scoped [`env/commands/rebuild-local-data.env.example`](../../env/commands/rebuild-local-data.env.example)
  `rebuild_local_data` 的一次性 override
- command-scoped [`env/commands/official-web-handoff-receiver.env.example`](../../env/commands/official-web-handoff-receiver.env.example)
  本地 `official_web` handoff receiver 的一次性 override
- command-scoped [`env/commands/official-web-handoff-consumer.env.example`](../../env/commands/official-web-handoff-consumer.env.example)
  本地 `official_web` handoff consumer 的一次性 override
- command-scoped [`env/commands/release-registry-scope.env.example`](../../env/commands/release-registry-scope.env.example)
  registry-backed index release 的命令级 override

## 历史 / 窄用途保留模板

- command-scoped historical [`env/commands/historical/migrate-student-handbook.env.example`](../../env/commands/historical/migrate-student-handbook.env.example)
  `migrate_student_handbook_source_faithful` 的窄迁移 override；保留给 handbook canonical rename / replay recovery，不再属于默认 operator 入口
- command-scoped historical [`env/commands/historical/official-web-history-backfill.env.example`](../../env/commands/historical/official-web-history-backfill.env.example)
  `official_web` 历史 source-bucket 回补的 closeout/recovery override；命令仍保留，但不再作为默认协作面

## 非 repo-owned 模板

- vendor [`apps/public-chat-web/vendor/vercel-ai-chatbot/.env.example`](../../apps/public-chat-web/vendor/vercel-ai-chatbot/.env.example)
  vendor artifact，不属于 `campus-agent` 当前 env ownership，也不应参与 repo 默认 env inventory

## 当前状态

- 当前 root worktree `.env` 可以集中保存本地 surface-specific `Sentry` DSN、repo-local `SENTRY_API_TOKEN` 与 shared `Axiom` 值；其中只有 `SENTRY_DSN_*` / `AXIOM_*` 会参与 Worker readiness，同步到当前 worktree 的 app-local `.dev.vars`
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
- `app-api` 的 Worker deploy 只覆盖 runtime shell；staging shared Postgres schema 仍需通过 direct management 连接单独执行 `db:reconcile-shared-drift:staging` / `db:migrate:staging`
- 这些 deploy hostnames 由各 app 自己的 `wrangler.toml` 中 `env.staging` 持有，不写回 `.dev.vars.example`；repo 中若仍残留 `*.rag.ayafeed.com`，应视为待迁移实现残留，不再代表 staging deploy truth
- `apps/app-api` 这类直接由 Wrangler 发布的 Worker 使用 `STAGING_SUPERVISOR_API_BASE_URL=... pnpm --dir apps/app-api deploy:staging`
- staging shared DB 管理连接通过 deploy shell env `STAGING_APP_API_MANAGEMENT_DATABASE_URL` 注入，不写回 repo-tracked `.env.example`
- 真实 deploy 命令直接消费当前 shell 的 `wrangler` 登录态；repo-local `.wrangler-home` 只保留给 dev / test / local build
- `apps/protected-panel-web` staging deploy 还必须显式注入 `STAGING_ACCESS_TEAM_DOMAIN` 与 `STAGING_ACCESS_POLICY_AUD`；这两个值不再写进 `wrangler.toml`，且占位默认值会被 deploy 脚本拒绝
- `apps/protected-panel-web` staging deploy 默认会从当前 git commit 自动派生 `SENTRY_RELEASE=protected-panel-web@staging-<sha>`；只有需要固定 release 名时才覆写 `STAGING_SENTRY_RELEASE`
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
  - `EVAL_LLM_TRANSPORT`
  - `EVAL_RAGAS_LLM_TRANSPORT`
  - `EVAL_JUDGE_LLM_TRANSPORT`
- 只有在 eval 需要独立 provider、独立预算或独立限流时，才使用：
  - `EVAL_LLM_*`
  - `EVAL_EMBEDDING_*`
- eval LLM transport 当前允许值固定为 `responses` 或 `chat_completions`；
  `EVAL_LLM_TRANSPORT` 是 shared default，`EVAL_RAGAS_LLM_TRANSPORT` / `EVAL_JUDGE_LLM_TRANSPORT` 只在某个 surface 需要单独切 transport 时覆盖
- `packages/evals` settings 仍只读取进程环境；repo-shipped Python CLI entrypoint 只会在本地自动 bootstrap 当前 worktree `.env`
- 当前实现与测试都不接受 silent fallback 到根 worktree `.env`
- ad-hoc `uv run ... python - <<'PY'` / REPL 默认不会自动 bootstrap `.env`；这类临时脚本必须先显式注入环境，或显式调用 `campus_shared.load_repo_env()`
- 如果要判断当前 worktree 的 provider/env 是否真的对 eval surface 可见，优先使用
  `uv run --all-packages python -m scripts.doctor_env evals --json`
- eval 的 HTTP timeout / retry / pacing / keep-alive / connection-pool 一类 runtime tuning 由 repo-tracked live benchmark profile config 持有，不再放在 root `.env.example`
- `APP_API_EVAL_HTTP_TIMEOUT_SECONDS` 现在只保留为本地 eval ingress 的显式 override；如果未设置，handbook / curriculum live benchmark 会默认继承各自 profile 的 repo-tracked timeout budget
- 代码层仍保留 `SupplementalHTTPSettings.from_env(...)` 作为低层 helper，但这不再是长期 ownership 入口
- 这条链路的当前 canonical truth 以本文和 [`docs/runbooks/provider-secret-governance.md`](../runbooks/provider-secret-governance.md) 为准；已完成的历史实施计划已归档到 `.planning/archive-docs/`

## 本地同步便利

- 如果本地把 surface-specific DSN 暂时集中存放在 root worktree `.env`，可用 `uv run --all-packages python -m scripts.sync_worker_observability_env`
  把 `SENTRY_DSN_API`、`SENTRY_DSN_CHAT`、`SENTRY_DSN_PANEL` fan out 到当前 worktree 的 app-local `.dev.vars`
- 如果要检查 root `.env` 与 app-local `.dev.vars` 是否已经对齐，可用 `uv run --all-packages python -m scripts.check_worker_observability_env --json`
- 如果要探测 repo-local `Sentry` lookup credential 是否可读取 org / project，可用
  `uv run --all-packages python -m scripts.check_sentry_lookup_access --json`
- 如果本地希望直接复用 root worktree `.env` 里的共享 Supabase Postgres，可用
  `uv run --all-packages python -m scripts.sync_app_api_local_db_env`
  把 `CAMPUS_SHARED_POSTGRES_URL` 与 `CAMPUS_SHARED_POSTGRES_MANAGEMENT_URL`
  fan out 到 `apps/app-api/.env` 的
  `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_APP_API_DB` 与
  `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_APP_API_DB_FRESH` 以及
  `APP_API_MANAGEMENT_DATABASE_URL`
- 如果本地需要把当前 worktree 从 shared Supabase 切回 `Docker Postgres`，并重建 authenticated-notice accepted current scope，可用
  `uv run --all-packages python -m scripts.restore_local_postgres_dev --execute`
  这条入口会：
  - 把 root `.env` 的 shared/document/raw registry DB lane 全部改写到本地 `postgresql://postgres:postgres@127.0.0.1:5432/campus_agent`
  - 同步 `apps/app-api/.env`
  - 把 `apps/app-api/.dev.vars` 的 `APP_API_DATABASE_SSLMODE` 固定为 `disable`
  - 合并默认 accepted normalized batches：
    `.tmp/historical-intake/run14-policy-regulation-expanded/normalized`
    `.tmp/historical-intake/run14-attachment-routing-probe/normalized`
    `.tmp/historical-intake/run14-policy-regulation-core/normalized`
  - 生成 `.tmp/local-postgres-recovery/accepted-union/*`
  - 执行 `docker compose -f infra/local/docker-compose.postgres.yml up -d`
  - 执行 `pnpm --dir apps/app-api db:bootstrap`
  - 执行 `pnpm --dir apps/app-api db:reconcile-shared-drift -- --json`
  - 对 union bundle 做单次 `import_authenticated_notice_export`
  - 执行 `rebuild_authenticated_notice_source_truth_inventory`
  - 默认校验本地 current scope 计数为 `20 / 21 / 1 / 0`
- 如果需要对当前 worktree 执行完整本地链路 smoke，而不是只做 restore，可用
  `uv run --all-packages python -m scripts.local_postgres_dev_smoke --execute --json`
  这条入口会在本地 restore 基础上继续完成：
  - `Docker MinIO` 拉起与 bucket ensure
  - current-scope validation
  - bounded `355119` replay / closeout / show / validation
  - bounded chunk preparation 与 preparation validation
- 如果当前 worktree 已切到本地 `Docker Postgres`，需要回到 shared/cloud Postgres env 值，可用
  `uv run --all-packages python -m scripts.restore_shared_postgres_dev --json`
  这条入口默认优先消费 `.tmp/local-postgres-recovery/backups/*` 中的 pre-local backups；如备份不存在，也可显式传入 `--shared-root-env`、`--shared-app-api-env`、`--shared-app-api-dev-vars`
- 这条入口是 `local dev / test path`，不改变 `docs/data/shared-postgres-ownership.md` 与 `ADR-0029` 的 deployed runtime truth
- 这条入口默认假定本地对象存储仍按 `ADR-0002` 运行，且 `.tmp/historical-intake/.../normalized` 已存在；如果 donor normalized artifacts 尚未准备好，先按 `docs/runbooks/authenticated-notice-historical-donor-intake-runbook.md` 生成
- `CAMPUS_SHARED_POSTGRES_MANAGEMENT_URL` 只用于 repo-local migration / DBA / offline ingestion operator 路径，
  当共享库由 Supabase 承载时它必须是 `db.<project-ref>.supabase.co:5432` 这类 direct management DSN；
  不得把 session pooler URL 复制成 management URL
- `apps/app-api` 还会在 source `.env` 存在 `AXIOM_ENDPOINT`、`AXIOM_DATASET`、`AXIOM_TOKEN` 时同步这三个键
- `SENTRY_API_TOKEN` 只用于 repo-local smoke / artifact collection，不同步到任何 Worker `.dev.vars`，也不构成 deploy-side runtime ownership
- `AXIOM_ENDPOINT` 应填写 Axiom `Settings -> General -> Edge deployment` 对应的 base domain，例如 `https://us-east-1.aws.edge.axiom.co`
- `AXIOM_DATASET` 应保持 service/env 级别命名，例如 `campus-agent-runtime-dev`，不要把多类信号混进一个 kitchen-sink dataset
- `apps/protected-panel-web/.dev.vars.example` 中的 `PANEL_RUNTIME_API_BASE_URL` 应指向 shared `apps/app-api`，不是 `apps/supervisor-api`
- `PANEL_APP_API_SHARED_SECRET` 与 `APP_API_INTERNAL_SHARED_SECRET` 必须保持同值
- 这些脚本只是本地 convenience，不改变 ownership：运行时仍然只消费各 app 自己的 `.dev.vars` / `.env` 或 deploy secret store
- 如果 feature worktree 需要复用 root worktree 的 app-local env，可用
  `uv run --all-packages python -m scripts.link_worktree_app_local_env --repo-root <current-worktree-root>`
  为当前 worktree 创建指向 root worktree app-local `.dev.vars` / `.env` 的符号链接；这只解决本地文件共享，不改变 env ownership
- 真正的 sink closure 仍以 `docs/runbooks/worker-observability-smoke-runbook.md` 中的 `Post-Deploy Verification` 为准

## App API Local Runtime

- `apps/app-api` 本地 `pnpm dev` 固定走 `wrangler dev -e local`
- `apps/app-api/wrangler.toml` 在 `env.local` 下声明 `APP_API_DB` Hyperdrive binding
- `apps/app-api/.env` 负责 Wrangler/Drizzle process env：
  - `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_APP_API_DB`
  - `APP_API_MANAGEMENT_DATABASE_URL`
- `apps/app-api/.dev.vars` 负责 Worker runtime string env，例如 `BETTER_AUTH_SECRET`、`PUBLIC_CHAT_WEB_ORIGIN`、`SUPERVISOR_API_*` 与 `APP_API_OFFICIAL_WEB_COLLECTOR_TOKEN`
- `apps/official-web-collector/.env` 负责 collector 到 `app-api` 的 control-plane seam，其中
  `OFFICIAL_WEB_SERVICE_TOKEN` 必须与 `apps/app-api/.dev.vars` `APP_API_OFFICIAL_WEB_COLLECTOR_TOKEN` 相同
- `campus-ingestion-consume-official-web-handoffs` 如需回写 app-owned execution status，
  `INGESTION_WORKER_APP_API_BASE_URL` 应指向 shared `apps/app-api`，
  `INGESTION_WORKER_APP_API_INTERNAL_SHARED_SECRET` 必须与 `APP_API_INTERNAL_SHARED_SECRET` 保持同值

## 命令级 Override 约束

- `env/commands/*.env.example` 只放当前默认 operator override，不重复 shared runtime secrets
- `env/commands/historical/*.env.example` 只承接保留中的 closeout / recovery 模板；这些文件不再代表当前默认协作入口
- OCR provider mode 在 operator / replay 命令里应显式写成 `OCR_PROVIDER_MODE=paddleocr_vl_service`；不要依赖 `OCR_BASE_URL` 推断 provider
- `RAW_ASSET_ID`、`RAW_VERSION_ID`、`REPLAY_SOURCE_PDF`、`--corpus`、`--collection` 这类任务输入优先走 CLI args
- `INGESTION_SPLIT_MANIFEST_PATH`、`HANDBOOK_SOURCE_PROJECTIONS_PATH` 只在偏离 repo-tracked truth 时作为显式 override 使用
- `QDRANT_UPSERT_BATCH_SIZE`、`IMPORT_REPORT_DIR`、`HF_*`、`INGESTION_EMBEDDING_MODEL` 一类局部运行参数不再放回 root `.env.example`

## 外部依据

- 12-Factor Config: <https://12factor.net/config>
- Cloudflare Workers local env / secrets: <https://developers.cloudflare.com/workers/development-testing/environment-variables/>
- Cloudflare Workers vars / secrets: <https://developers.cloudflare.com/workers/configuration/environment-variables/>
- Cloudflare Workers secrets: <https://developers.cloudflare.com/workers/configuration/secrets/>
- Vite env exposure rules: <https://vite.dev/guide/env-and-mode>
