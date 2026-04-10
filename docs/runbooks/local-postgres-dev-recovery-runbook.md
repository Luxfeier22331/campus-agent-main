---
doc_type: runbook
status: active
created: 2026-04-10
updated: 2026-04-10
---

# Local Postgres Dev Recovery Runbook

## 文档边界

这份 runbook 只记录当前 worktree 把本地开发数据库切到 `Docker Postgres`，并恢复 authenticated-notice accepted current scope 的可重复入口。

它回答的是：

- 当前 repo 里哪条命令是 canonical local recovery entry
- 这条入口会改哪些文件、执行哪些命令
- 它证明了什么，不证明什么

它不替代：

- shared Postgres ownership：`docs/data/shared-postgres-ownership.md`
- deployed runtime posture：`docs/decisions/adr-0029-ipv4-session-pooler-postgres-connectivity.md`
- donor normalized batch 生成流程：`docs/runbooks/authenticated-notice-historical-donor-intake-runbook.md`

## 当前 canonical 入口

先看 dry-run 计划：

```bash
uv run --all-packages python -m scripts.restore_local_postgres_dev --json
```

确认后执行：

```bash
uv run --all-packages python -m scripts.restore_local_postgres_dev --execute --json
```

## 默认前置条件

- 本地可执行 `docker`、`pnpm`、`uv`
- 本地对象存储仍按 `ADR-0002` 运行
- 当前 worktree 已存在以下 normalized donor batch：
  - `.tmp/historical-intake/run14-policy-regulation-expanded/normalized`
  - `.tmp/historical-intake/run14-attachment-routing-probe/normalized`
  - `.tmp/historical-intake/run14-policy-regulation-core/normalized`

如果 normalized donor batch 还没准备好，先按 `docs/runbooks/authenticated-notice-historical-donor-intake-runbook.md` 生成。

## 这条入口会做什么

它会先改写本地文件：

- root `.env`
  - `CAMPUS_SHARED_POSTGRES_URL`
  - `CAMPUS_SHARED_POSTGRES_MANAGEMENT_URL`
  - `DOCUMENT_REGISTRY_DATABASE_URL`
  - `DOCUMENT_REGISTRY_MANAGEMENT_DATABASE_URL`
  - `RAW_ASSET_REGISTRY_DATABASE_URL`
  - `RAW_ASSET_REGISTRY_MANAGEMENT_DATABASE_URL`
- `apps/app-api/.env`
  - `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_APP_API_DB`
  - `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_APP_API_DB_FRESH`
  - `APP_API_MANAGEMENT_DATABASE_URL`
- `apps/app-api/.dev.vars`
  - `APP_API_DATABASE_SSLMODE=disable`

默认本地 DSN 固定为：

```text
postgresql://postgres:postgres@127.0.0.1:5432/campus_agent
```

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

如果需要不同的 local sample，可显式覆写：

```bash
uv run --all-packages python -m scripts.restore_local_postgres_dev \
  --expected-notice-count 3 \
  --expected-document-count 3 \
  --expected-attachment-document-count 0 \
  --expected-ocr-candidate-count 0 \
  --json
```

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

## 这条入口证明什么

- 当前 worktree 已切到本地 `Docker Postgres`
- `apps/app-api` local bootstrap / shared-drift reconcile 通过
- accepted authenticated-notice current scope 已用单次 union import 恢复
- 当前 source-truth inventory 计数与预期一致

## 这条入口不证明什么

- 不证明 staging / production 数据库 truth 已变化
- 不证明 deployed runtime posture 已从 session pooler 改成 local Postgres
- 不证明 full historical closeout、release、embedding、Qdrant、alias publish 已在本地完成
- 不证明 donor normalized batch 自身仍是最新 truth；它只消费当前 worktree 已有的 normalized artifacts
