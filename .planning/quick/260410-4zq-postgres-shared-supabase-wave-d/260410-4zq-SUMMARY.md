# Quick Task 260410-4zq Summary

## Outcome

- 本地开发数据库已从 shared Supabase 切到本机 `Docker Postgres`：
  `postgresql://postgres:postgres@127.0.0.1:5432/campus_agent`
- `apps/app-api` 本地 runtime / fresh / management 三条 DB lane 已全部切到本地：
  - `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_APP_API_DB`
  - `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_APP_API_DB_FRESH`
  - `APP_API_MANAGEMENT_DATABASE_URL`
- `apps/app-api/.dev.vars` 已改为 `APP_API_DATABASE_SSLMODE=disable`，`db:bootstrap` 与 `db:reconcile-shared-drift` 均已通过
- authenticated-notice accepted donor truth 已以单次 `replace_scope` 语义导入本地 Postgres + 本地 MinIO
- 本地 `internal_notice` current scope 已恢复到 `20` 条 notice，并完成 full current-scope Wave D replay + preparation：
  - `closeout_run_id=local-postgres-wave-d-full-20260410-141615`
  - `preparation_run_id=prep-local-postgres-wave-d-full-20260410-141615`
  - `manual_review_required_attachment_count=5`
  - `materialized_ocr_attachment_document_count=0`

## Key Decisions

- 本任务属于 `local dev / test path`，不是 repo-level architecture truth 变更
- 当前 WSL 无法无交互安装/管理 native Postgres，因此执行面改为本机 Docker Postgres
- authenticated-notice bootstrap import 不是 append，而是 `scope_refresh -> replace_scope`
- 因此三批 accepted normalized batch 不能顺序 delta import；必须先合并成一个 union bundle，再单次导入
- 原 quick plan 里的 `241275` 不在这次本地 accepted union 里，因此先用 `355119` 做 bounded proof，再继续把 full current-scope replay / preparation 跑到 `verified`
- 选课通知里的操作指引类 inline image 不应进入 OCR；当前它们已按 `manual_review_required` 收口

## Executed Facts

- 本地 Postgres compose 已落在：
  - `infra/local/docker-compose.postgres.yml`
- root `.env` 已切到本地 Postgres：
  - `CAMPUS_SHARED_POSTGRES_URL`
  - `CAMPUS_SHARED_POSTGRES_MANAGEMENT_URL`
  - `DOCUMENT_REGISTRY_DATABASE_URL`
  - `DOCUMENT_REGISTRY_MANAGEMENT_DATABASE_URL`
  - `RAW_ASSET_REGISTRY_DATABASE_URL`
  - `RAW_ASSET_REGISTRY_MANAGEMENT_DATABASE_URL`
- `scripts.sync_app_api_local_db_env` 现会同时同步：
  - runtime DSN -> `APP_API_DB`
  - runtime DSN -> `APP_API_DB_FRESH`
  - management DSN -> `APP_API_MANAGEMENT_DATABASE_URL`
- 已执行并通过：
  - `pnpm --dir apps/app-api db:bootstrap`
  - `pnpm --dir apps/app-api db:reconcile-shared-drift -- --json`
  - `UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m unittest tests.ingestion.test_registry_models tests.ingestion.test_internal_notice_chunking_validation tests.ingestion.test_internal_notice_scope_chunk_pipeline tests.ingestion.test_release_registry_scope_worker tests.test_sync_app_api_local_db_env tests.test_link_worktree_app_local_env`

## Critical Correction

- 初次按三批顺序导入后，`rebuild_authenticated_notice_source_truth_inventory` 只返回 `16` 条
- 根因不是本地 Postgres 损坏，而是 import contract 自带 `scope_refresh=(corpus, collection)`：
  后一批导入会把前一批不在本批里的 registry scope 收掉
- 修复动作：
  - 新增 quick artifact `merge_accepted_batches.py`
  - 生成 `accepted-union/notices-bundle.accepted-union.json`
  - 生成 `accepted-union/export-manifest.accepted-union.json`
  - 对 union bundle 执行单次 import
- 修复后 inventory 已恢复为：
  - `notice_count = 20`
  - `expected_document_count = 21`
  - `expected_attachment_document_count = 1`
  - `expected_ocr_candidate_count = 0`
  - `notice_risk_counts.body_only = 16`
  - `notice_risk_counts.body_with_reference_only_attachments = 1`
  - `notice_risk_counts.body_with_spatial_attachments = 2`
  - `notice_risk_counts.body_with_text_attachments = 1`

## Artifacts

- bootstrap note:
  - `local-postgres-bootstrap.md`
- verification note:
  - `wave-d-local-verification.md`
- accepted union artifacts:
  - `accepted-union/notices-bundle.accepted-union.json`
  - `accepted-union/export-manifest.accepted-union.json`
  - `accepted-union/selected-notice-ids.accepted-union.txt`
