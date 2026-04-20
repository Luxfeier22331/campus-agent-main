---
doc_type: runbook
status: active
created: 2026-04-10
updated: 2026-04-12
---

# Local Postgres Dev Recovery Runbook

## 文档边界

这份 runbook 记录 repo 支持的本地 Postgres 开发生命周期：

- 从 shared/cloud Postgres env 切到本地 `Docker Postgres`
- 对本地 `Postgres + MinIO` 执行完整 smoke
- 从本地模式回切到 shared/cloud Postgres env

本文回答的是：

- 当前 repo 里哪几条命令是 canonical local lifecycle entries
- 每条入口会改哪些文件、执行哪些命令
- 它们分别证明什么，不证明什么

本文不替代：

- shared Postgres ownership：`docs/data/shared-postgres-ownership.md`
- deployed runtime posture：`docs/decisions/adr-0029-ipv4-session-pooler-postgres-connectivity.md`

## Canonical 入口

先看 dry-run 计划：

```bash
uv run --all-packages python -m scripts.restore_local_postgres_dev --json
```

确认后执行：

```bash
uv run --all-packages python -m scripts.restore_local_postgres_dev --execute --json
```

如果要验证完整本地链路，而不是只做 restore：

```bash
uv run --all-packages python -m scripts.local_postgres_dev_smoke --execute --json
```

如果本地环境已切到本地模式，需要回到 shared/cloud Postgres env：

```bash
uv run --all-packages python -m scripts.restore_shared_postgres_dev --json
```

## 默认前置条件

- 本地可执行 `docker`、`pnpm`、`uv`
- 本地对象存储仍按 `ADR-0002` 运行
- 执行目录已存在以下 normalized donor batch：
  - `.tmp/historical-intake/run14-policy-regulation-expanded/normalized`
  - `.tmp/historical-intake/run14-attachment-routing-probe/normalized`
  - `.tmp/historical-intake/run14-policy-regulation-core/normalized`

如果 normalized donor batch 还没准备好，可直接使用 repo-tracked selection files 生成：

```bash
uv run --package campus-ingestion-worker python -m campus_ingestion_worker.normalize_authenticated_notice_legacy_export \
  --bundle-path /home/reptilian/code/rag-data/muc-notice-collector/runtime/exports/notices-bundle-20260403-run-14.json \
  --manifest-path /home/reptilian/code/rag-data/muc-notice-collector/runtime/exports/export-manifest-20260403-run-14.json \
  --site-id muc_internal_portal \
  --source-home-url https://my.muc.edu.cn \
  --selection-path configs/ingestion/campus_notices/internal_notice/historical-batches/run14-policy-regulation-core.v1.json \
  --output-dir .tmp/historical-intake/run14-policy-regulation-core/normalized

uv run --package campus-ingestion-worker python -m campus_ingestion_worker.normalize_authenticated_notice_legacy_export \
  --bundle-path /home/reptilian/code/rag-data/muc-notice-collector/runtime/exports/notices-bundle-20260403-run-14.json \
  --manifest-path /home/reptilian/code/rag-data/muc-notice-collector/runtime/exports/export-manifest-20260403-run-14.json \
  --site-id muc_internal_portal \
  --source-home-url https://my.muc.edu.cn \
  --selection-path configs/ingestion/campus_notices/internal_notice/historical-batches/run14-policy-regulation-expanded.v1.json \
  --output-dir .tmp/historical-intake/run14-policy-regulation-expanded/normalized

uv run --package campus-ingestion-worker python -m campus_ingestion_worker.normalize_authenticated_notice_legacy_export \
  --bundle-path /home/reptilian/code/rag-data/muc-notice-collector/runtime/exports/notices-bundle-20260403-run-14.json \
  --manifest-path /home/reptilian/code/rag-data/muc-notice-collector/runtime/exports/export-manifest-20260403-run-14.json \
  --site-id muc_internal_portal \
  --source-home-url https://my.muc.edu.cn \
  --selection-path configs/ingestion/campus_notices/internal_notice/historical-batches/run14-attachment-routing-probe.v1.json \
  --output-dir .tmp/historical-intake/run14-attachment-routing-probe/normalized
```

如果 donor export 不在默认 `rag-data` 路径下，只替换 `--bundle-path` 与 `--manifest-path`，保持同一组 repo-tracked selection files 与 output dirs 即可。

## `restore_local_postgres_dev` 会做什么

它会先改写本地文件：

- root `.env`
  - `CAMPUS_SHARED_POSTGRES_URL`
  - `CAMPUS_SHARED_POSTGRES_OPERATOR_URL`
  - `CAMPUS_SHARED_POSTGRES_MANAGEMENT_URL`（legacy alias）
  - `DOCUMENT_REGISTRY_DATABASE_URL`
  - `DOCUMENT_REGISTRY_MANAGEMENT_DATABASE_URL`
  - `RAW_ASSET_REGISTRY_DATABASE_URL`
  - `RAW_ASSET_REGISTRY_MANAGEMENT_DATABASE_URL`
- `apps/app-api/.env`
  - `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_APP_API_DB`
  - `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_APP_API_DB_FRESH`
  - `APP_API_OPERATOR_DATABASE_URL`
  - `APP_API_MANAGEMENT_DATABASE_URL`（legacy alias）
- `apps/app-api/.dev.vars`
  - `APP_API_DATABASE_SSLMODE=disable`

默认本地 DSN 固定为：

```text
postgresql://postgres:postgres@127.0.0.1:5432/campus_agent?sslmode=disable&gssencmode=disable
```

固定约束：

- 当前本地 `psycopg` / `psycopg_pool` runtime lane 不能继续使用裸 `postgresql://postgres:postgres@127.0.0.1:5432/campus_agent`
- `restore_local_postgres_dev` 现在会把 root `.env` 与 `apps/app-api/.env` 一起改写到带 `sslmode=disable&gssencmode=disable` 的 canonical local DSN，避免 worker/import/materialization 这类 operator 路径再次命中本地连接超时

它还会把默认 accepted batches 合并成单次 import 所需的 union artifacts：

- `.tmp/local-postgres-recovery/accepted-union/notices-bundle.accepted-union.json`
- `.tmp/local-postgres-recovery/accepted-union/export-manifest.accepted-union.json`
- `.tmp/local-postgres-recovery/accepted-union/selected-notice-ids.accepted-union.txt`

然后顺序执行：

```bash
docker compose -f infra/local/docker-compose.postgres.yml up -d
pnpm --dir apps/app-api db:bootstrap
pnpm --dir apps/app-api db:reconcile-shared-drift -- --json
uv run --package campus-ingestion-worker python -m campus_ingestion_worker.import_authenticated_notice_export \
  --bundle-path .tmp/local-postgres-recovery/accepted-union/notices-bundle.accepted-union.json \
  --manifest-path .tmp/local-postgres-recovery/accepted-union/export-manifest.accepted-union.json \
  --site-id muc_internal_portal \
  --source-home-url https://my.muc.edu.cn \
  --corpus campus_notices \
  --collection internal_notice
uv run --package campus-ingestion-worker python -m campus_ingestion_worker.rebuild_authenticated_notice_source_truth_inventory \
  --corpus campus_notices \
  --collection internal_notice
```

同时，`restore_local_postgres_dev` 会在当前 root `.env` 仍然指向非本地 DSN 时，自动写入 pre-local backups：

- `.tmp/local-postgres-recovery/backups/env.root.before-local-postgres`
- `.tmp/local-postgres-recovery/backups/env.app-api.before-local-postgres`
- `.tmp/local-postgres-recovery/backups/devvars.app-api.before-local-postgres`

## 为什么必须先合并再导入

`import_authenticated_notice_export` 对 `campus_notices/internal_notice` 固定走 `scope_refresh=(corpus, collection)`。

这意味着：

- 顺序导入多个 accepted normalized batch 不是 append
- 最终 registry / source-truth inventory 会被后一批 `replace_scope`
- 正确做法是先把 accepted batches 合并成一个 union bundle，再单次 import

## 默认验收口径

这条入口默认校验：

- `notice_count = 20`
- `expected_document_count = 21`
- `expected_attachment_document_count = 1`
- `expected_ocr_candidate_count = 5`
- `notice_risk_counts.body_only = 16`
- `notice_risk_counts.body_with_reference_only_attachments = 1`
- `notice_risk_counts.body_with_spatial_attachments = 2`
- `notice_risk_counts.body_with_text_attachments = 1`

如需不同的 local sample，可显式覆写：

```bash
uv run --all-packages python -m scripts.restore_local_postgres_dev \
  --expected-notice-count 3 \
  --expected-document-count 3 \
  --expected-attachment-document-count 0 \
  --expected-ocr-candidate-count 0 \
  --json
```

## `local_postgres_dev_smoke` 会做什么

`local_postgres_dev_smoke` 在 restore 入口基础上，继续执行本地 smoke 所需的对象存储与 replay/preparation 步骤。

顺序固定为：

```bash
docker compose -f infra/local/docker-compose.minio.yml up -d
uv run --all-packages python -m scripts.restore_local_postgres_dev --execute --json
uv run --package campus-ingestion-worker python -m campus_ingestion_worker.validate_internal_notice_chunking --sample-dir <current-scope-sample-dir>
uv run --package campus-ingestion-worker python -m campus_ingestion_worker.plan_authenticated_notice_source_truth_replay --notice-id 355119 --run-id <run_id>
uv run --package campus-ingestion-worker python -m campus_ingestion_worker.run_authenticated_notice_closeout_worker --run-id <run_id> --worker-id local-postgres-01
uv run --package campus-ingestion-worker python -m campus_ingestion_worker.show_authenticated_notice_closeout --run-id <run_id>
uv run --package campus-ingestion-worker python -m campus_ingestion_worker.validate_internal_notice_chunking --closeout-run-id <run_id> --sample-dir <closeout-sample-dir>
uv run --package campus-ingestion-worker python -m campus_ingestion_worker.prepare_registry_scope_chunks --corpus campus_notices --collection internal_notice --closeout-run-id <run_id> --preparation-run-id <prep_id>
uv run --package campus-ingestion-worker python -m campus_ingestion_worker.validate_internal_notice_chunking --preparation-run-id <prep_id> --sample-dir <prep-sample-dir>
```

固定约束：

- 默认 bounded notice 是 `355119`
- 默认只证明 bounded replay / preparation 链路，不自动推进 full release / alias publish
- MinIO bucket 会通过 object-store client ensure `campus-rag-source` 与 `campus-rag-derived`

## `restore_shared_postgres_dev` 会做什么

`restore_shared_postgres_dev` 不会粗暴整文件覆盖本地工作区的 `.env` / `.dev.vars`。

它固定执行：

- 读取 pre-local backups，或显式传入的 shared source env files
- 只恢复 root `.env` 中的 DB 相关 key
- 恢复或重建 `apps/app-api/.env`
- 恢复 `apps/app-api/.dev.vars` 中的 `APP_API_DATABASE_SSLMODE`

默认行为：

- root `.env` source 必须是真正的 shared/cloud Postgres env，不能仍指向 `127.0.0.1:5432`
- 如果缺少 app-api 独立 backup，会从 shared root env 重新同步 `apps/app-api/.env`
- 如果缺少 `.dev.vars` backup，`APP_API_DATABASE_SSLMODE` fallback 为 `prefer`

## 可选覆写

- `--normalized-batch-dir <path>`
  重复传入可替换默认 accepted batch 集
- `--union-output-dir <path>`
  改写 union artifact 输出目录
- `--export-scope <slug>`
  改写 union manifest 的 `export_scope`
- `--local-postgres-url <dsn>`
  改写本地 Postgres DSN
- `--corpus` / `--collection`
  改写导入与 inventory rebuild 目标 scope
- `--run-id` / `--preparation-run-id`
  改写 full smoke 的 replay / preparation run id
- `--shared-root-env` / `--shared-app-api-env` / `--shared-app-api-dev-vars`
  显式指定 shared restore 的 source env files

## 这些入口证明什么

- `restore_local_postgres_dev`
  证明本地环境已切到 `Docker Postgres`，并且 authenticated-notice accepted current scope 已恢复到预期 inventory
- `local_postgres_dev_smoke`
  额外证明本地 `Postgres + MinIO + bounded replay/preparation` 链路可被真实 operator 命令消费
- `restore_shared_postgres_dev`
  证明本地环境可以从本地模式回切到 shared/cloud Postgres env values，而不是永久停留在本地 DSN

## 这些入口不证明什么

- 不证明 staging / production 数据库 truth 已变化
- 不证明 deployed runtime posture 已从 session pooler 改成 local Postgres
- 不证明 full historical closeout、release、embedding、Qdrant、alias publish 已在本地完成
- 不证明 donor normalized batch 自身仍是最新 truth；它只消费本地目录已准备好的 normalized artifacts
