---
doc_type: index
status: active
created: 2026-03-29
updated: 2026-03-29
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
  supervisor-api shared auth/audit、retrieval/embedding/Qdrant、object store、OCR/raw registry、eval judge、`CAMPUS_AGENT_HTTP_HOST` / `CAMPUS_AGENT_HTTP_PORT`
- app-local [`apps/public-consumer-chat/.env.example`](../../apps/public-consumer-chat/.env.example)
  `public-consumer-chat` 的 app host、Supabase Postgres、Better Auth、same-site supervisor answer seam
- app-local [`apps/app-api/.dev.vars.example`](../../apps/app-api/.dev.vars.example)
  `app-api` 的 Worker string env，包括 auth/supervisor bridge、official_web control-plane string config，以及 `SENTRY_*` / `AXIOM_*`
- app-local [`apps/public-chat-web/.dev.vars.example`](../../apps/public-chat-web/.dev.vars.example)
  `public-chat-web` 的 Worker string env，包括 same-site app-api proxy seam 与 `SENTRY_*`
- app-local [`apps/protected-panel-web/.dev.vars.example`](../../apps/protected-panel-web/.dev.vars.example)
  `protected-panel-web` 的 protected hostname/admission string env 与 `SENTRY_*`
- app-local [`apps/public-entry-worker/.dev.vars.example`](../../apps/public-entry-worker/.dev.vars.example)
  `public-entry-worker` 的 Cloudflare Worker 本地 bindings
- command-scoped [`env/commands/process-raw-ingestion-job.env.example`](../../env/commands/process-raw-ingestion-job.env.example)
  `process_raw_ingestion_job` 的一次性 override
- command-scoped [`env/commands/rebuild-local-data.env.example`](../../env/commands/rebuild-local-data.env.example)
  `rebuild_local_data` 的一次性 override
- command-scoped [`env/commands/migrate-student-handbook.env.example`](../../env/commands/migrate-student-handbook.env.example)
  `migrate_student_handbook_source_faithful` 的一次性 override

## 当前待提供项

- `apps/app-api`、`apps/public-chat-web`、`apps/protected-panel-web` 的模板已经预留 `SENTRY_*` / `AXIOM_*` 槽位，但 provider-side deploy 值仍待分配；在真实值下发前，只保留模板占位，不提交任何实际 secrets

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
