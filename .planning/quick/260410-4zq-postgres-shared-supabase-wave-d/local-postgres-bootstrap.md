# Local Postgres Bootstrap

## Boundary

这份记录只描述 quick task `260410-4zq` 如何把当前 worktree 的本地开发数据库从 shared Supabase 切到本机 local Postgres，并让 authenticated-notice Wave D operator path 能在本地闭环。

它不改变：

- `docs/data/shared-postgres-ownership.md` 的 repo-level shared Postgres ownership
- `docs/decisions/adr-0029-ipv4-session-pooler-postgres-connectivity.md` 的 deployed runtime posture
- 任何 staging / production 数据库 truth

## Local Substrate

- 执行形态：`Docker Postgres`
- compose file：`infra/local/docker-compose.postgres.yml`
- 容器端口：`127.0.0.1:5432`
- 数据库：`campus_agent`
- 用户：`postgres`
- 密码：`postgres`

选择 Docker 而不是 WSL native Postgres 的原因：

- 当前 shell 无可用 `sudo`
- `systemd` 为 `offline`
- quick task 需要无交互完成，而不是停在安装步骤

## Env Rebinding

root `.env` 已改到本地：

- `DOCUMENT_REGISTRY_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/campus_agent`
- `DOCUMENT_REGISTRY_MANAGEMENT_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/campus_agent`
- `RAW_ASSET_REGISTRY_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/campus_agent`
- `RAW_ASSET_REGISTRY_MANAGEMENT_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/campus_agent`
- `CAMPUS_SHARED_POSTGRES_URL=postgresql://postgres:postgres@127.0.0.1:5432/campus_agent`
- `CAMPUS_SHARED_POSTGRES_MANAGEMENT_URL=postgresql://postgres:postgres@127.0.0.1:5432/campus_agent`

app-api local env fan-out：

- 运行：
  - `UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m scripts.sync_app_api_local_db_env --repo-root /home/reptilian/code/campus-agent`
- 结果：
  - `apps/app-api/.env`
  - `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_APP_API_DB=postgresql://postgres:postgres@127.0.0.1:5432/campus_agent`
  - `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_APP_API_DB_FRESH=postgresql://postgres:postgres@127.0.0.1:5432/campus_agent`
  - `APP_API_MANAGEMENT_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/campus_agent`

Worker local runtime transport：

- `apps/app-api/.dev.vars`
- `APP_API_DATABASE_SSLMODE=disable`

## App API Bootstrap

已执行：

```bash
pnpm --dir apps/app-api db:bootstrap
pnpm --dir apps/app-api db:reconcile-shared-drift -- --json
```

结果：

- `app_auth` / `chat` shared-product bootstrap 通过
- drift reconcile 返回：
  - `driftDetected = false`
  - `blockedReasons = []`

## Authenticated Notice Import Correction

初次错误动作：

- 依次导入：
  - `run14-policy-regulation-core`
  - `run14-attachment-routing-probe`
  - `run14-policy-regulation-expanded`

发现：

- `rebuild_authenticated_notice_source_truth_inventory` 只看到最后一批的 `16` 条

根因：

- `import_authenticated_notice_export` 内部固定使用
  `scope_refresh=(request.corpus, request.collection)`
- `collect_import_document_stats(...)` 最终会对 document registry 执行
  `replace_scope(corpus, collection, refreshed_records)`
- 所以多批 sequential import 不是 append，而是“后一批收掉前一批 scope”

正确动作：

- 用 quick artifact `merge_accepted_batches.py` 合并三批 accepted normalized batch
- 生成：
  - `accepted-union/notices-bundle.accepted-union.json`
  - `accepted-union/export-manifest.accepted-union.json`
  - `accepted-union/selected-notice-ids.accepted-union.txt`
- 再对 union bundle 做单次 import

单次 union import 命令：

```bash
UV_CACHE_DIR=/tmp/uv-cache uv run --package campus-ingestion-worker python -m campus_ingestion_worker.import_authenticated_notice_export \
  --bundle-path .planning/quick/260410-4zq-postgres-shared-supabase-wave-d/accepted-union/notices-bundle.accepted-union.json \
  --manifest-path .planning/quick/260410-4zq-postgres-shared-supabase-wave-d/accepted-union/export-manifest.accepted-union.json \
  --site-id muc_internal_portal \
  --source-home-url https://my.muc.edu.cn \
  --corpus campus_notices \
  --collection internal_notice
```

结果：

- `notice_count = 20`
- `created_document_ids = 4`
- `skipped_document_ids = 16`
- `raw_uploaded_count = 0`
- `raw_reused_count = 20`
- `errors = []`

## Post-Bootstrap Inventory

已执行：

```bash
UV_CACHE_DIR=/tmp/uv-cache uv run --package campus-ingestion-worker python -m campus_ingestion_worker.rebuild_authenticated_notice_source_truth_inventory \
  --corpus campus_notices \
  --collection internal_notice
```

结果：

- `notice_count = 20`
- `expected_document_count = 21`
- `expected_attachment_document_count = 1`
- `expected_ocr_candidate_count = 0`
- `notice_risk_counts.body_only = 16`
- `notice_risk_counts.body_with_reference_only_attachments = 1`
- `notice_risk_counts.body_with_spatial_attachments = 2`
- `notice_risk_counts.body_with_text_attachments = 1`

## Backups

- `env.root.before-local-postgres`
- `env.app-api.before-local-postgres`
- `devvars.app-api.before-local-postgres`
