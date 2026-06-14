---
doc_type: reference
truth_scope: ops
owner_boundary: docs/environment
status: active
created: 2026-04-20
updated: 2026-04-20
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

- `provider-and-secret-inventory.md`
- `deploy-and-eval-readiness.md`
- `../runbooks/provider-secret-governance.md`

## Layering Rules

### Repo root `.env` / `.env.example`

只承载 repo-root shared runtime config，例如：

- shared LLM / embedding provider
- retrieval / Qdrant
- object store
- OCR provider
- eval model selection
- 本地 dev server 监听地址

### App-local env template

每个 app 在自己的 runtime boundary 下维护自己的模板，不再由 repo root `.env.example` 代管。

### Command-scoped override template

默认 operator override 放在 `env/commands/*.env.example`。 历史 closeout / narrow
recovery 模板继续放在 `env/commands/historical/*.env.example`。

## Ownership Matrix

### Repo root shared env

- [`.env.example`](/home/reptilian/code/campus-agent/.env.example)
  - shared provider、object store、registry、eval ingress、supervisor local runtime、shared
    HTTP listen config

### App-local env

- [`apps/app-api/.dev.vars.example`](/home/reptilian/code/campus-agent/apps/app-
  api/.dev.vars.example)
  - `app-api` Worker runtime string env
- [`apps/app-api/.env.example`](/home/reptilian/code/campus-agent/apps/app-api/.
  env.example)
  - `app-api` Wrangler / Drizzle process env
- [`apps/campus-web/.dev.vars.example`](/home/reptilian/code/campus-agent/apps/campus
  -web/.dev.vars.example)
  - `campus-web` Worker runtime string env
- [`apps/authenticated-notice-collector/.env.example`](/home/reptilian/code/cam
  pus-agent/apps/authenticated-notice-collector/.env.example)
  - `authenticated-notice-collector` portal auth、collector ledger/lease、source-bucket
    runtime env
- [`apps/official-web-collector/.env.example`](/home/reptilian/code/campus-agent
  /apps/official-web-collector/.env.example)
  - `official-web-collector` control-plane 与 source-bucket runtime env
- [`apps/wechat-official-account-collector/.env.example`](/home/reptilian/code/c
  ampus-agent/apps/wechat-official-account-collector/.env.example)
  - `wechat-official-account-collector` FeedWe credentials、control-plane 与 source-bucket
    runtime env
- [`apps/public-chat-web/.dev.vars.example`](/home/reptilian/code/campus-agent/a
  pps/public-chat-web/.dev.vars.example)
  - `public-chat-web` Worker string env
- [`apps/protected-panel-web/.dev.vars.example`](/home/reptilian/code/campus-age
  nt/apps/protected-panel-web/.dev.vars.example)
  - `protected-panel-web` Worker string env
- [`infra/otel/collector.env.example`](/home/reptilian/code/campus-agent/infra/
  otel/collector.env.example)
  - local/staging OTel collector process env

### Command-scoped override

- [`env/commands/process-raw-ingestion-job.env.example`](/home/reptilian/code/ca
  mpus-agent/env/commands/process-raw-ingestion-job.env.example)
- [`env/commands/compare-online-ocr.env.example`](/home/reptilian/code/campus-ag
  ent/env/commands/compare-online-ocr.env.example)
- [`env/commands/rebuild-local-data.env.example`](/home/reptilian/code/campus-ag
  ent/env/commands/rebuild-local-data.env.example)
- [`env/commands/official-web-handoff-receiver.env.example`](/home/reptilian/cod
  e/campus-agent/env/commands/official-web-handoff-receiver.env.example)
- [`env/commands/official-web-handoff-consumer.env.example`](/home/reptilian/cod
  e/campus-agent/env/commands/official-web-handoff-consumer.env.example)
- [`env/commands/official-web-release-task.env.example`](/home/reptilian/code/ca
  mpus-agent/env/commands/official-web-release-task.env.example)
- [`env/commands/release-registry-scope.env.example`](/home/reptilian/code/campu
  s-agent/env/commands/release-registry-scope.env.example)
- [`env/commands/legacy-office-conversion-service.env.example`](/home/reptilian/
  code/campus-agent/env/commands/legacy-office-conversion-service.env.example)
- [`env/commands/execution-control-runtime.env.example`](/home/reptilian/code/campus-ag
  ent/env/commands/execution-control-runtime.env.example)

### Historical / narrow-use override

- [`env/commands/historical/migrate-student-handbook.env.example`](/home/reptili
  an/code/campus-agent/env/commands/historical/migrate-student-handbook.env.exam
  ple)
- [`env/commands/historical/official-web-history-backfill.env.example`](/home/re
  ptilian/code/campus-agent/env/commands/historical/official-web-history-backfil
  l.env.example)

## Override Rules

- env 只承载会随 deploy 或 runtime 变化的资源句柄、密钥、provider 配置、运行时 host/base URL
- 单次任务身份、源文档 identity、目标 scope 优先走 CLI args 或 typed request
- repo-tracked truth 默认来自 config / manifest / source projection，而不是 env
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

## Convenience Scripts

- `uv run --all-packages python -m scripts.sync_worker_observability_env`
- `uv run --all-packages python -m scripts.check_worker_observability_env
  --json`
- `uv run --all-packages python -m scripts.check_sentry_lookup_access --json`
- `uv run --all-packages python -m scripts.sync_app_api_local_db_env`
- `uv run --all-packages python -m scripts.restore_local_postgres_dev --execute`
- `uv run --all-packages python -m scripts.local_postgres_dev_smoke --execute
  --json`
- `uv run --all-packages python -m scripts.restore_shared_postgres_dev --json`
- `uv run --all-packages python -m scripts.link_worktree_app_local_env
  --repo-root <current-worktree-root>`

对应 runbook：

- `docs/runbooks/provider-secret-governance.md`
- `docs/runbooks/local-postgres-dev-recovery-runbook.md`
- `docs/runbooks/legacy-office-conversion-runtime.md`
- `docs/runbooks/worker-observability-smoke-runbook.md`
