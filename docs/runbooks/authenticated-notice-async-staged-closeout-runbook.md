---
doc_type: runbook
status: active
created: 2026-04-04
updated: 2026-04-04
---

# Authenticated Notice Async Staged Closeout Runbook

## 文档边界

这份 runbook 只描述 Phase 12.2 之后的 authenticated notice async staged closeout workflow。

它不替代：

- `docs/runbooks/authenticated-notice-bootstrap-smoke-runbook.md`
- `docs/runbooks/authenticated-notice-historical-backfill-closeout-runbook.md` 的 legacy cumulative-prefix closeout 说明
- live collector / control-plane runbook

## Canonical CLI

### 1. 规划 staged run

```bash
uv run --package campus-ingestion-worker python -m campus_ingestion_worker.plan_authenticated_notice_closeout \
  --bundle-path /home/reptilian/code/rag-data/muc-notice-collector/runtime/exports/notices-bundle-20260403-run-14.json \
  --manifest-path /home/reptilian/code/rag-data/muc-notice-collector/runtime/exports/export-manifest-20260403-run-14.json \
  --site-id muc_internal_portal \
  --source-home-url https://my.muc.edu.cn \
  --run-id run-14-async \
  --shard-size 250 \
  --batch-size 16 \
  --max-concurrency 8 \
  --notice-concurrency 8 \
  --object-store-concurrency 64 \
  --lease-seconds 300
```

### 2. 启动一个或多个 worker

```bash
uv run --package campus-ingestion-worker python -m campus_ingestion_worker.run_authenticated_notice_closeout_worker \
  --run-id run-14-async \
  --worker-id worker-a
```

多 worker 并行时，只需要在不同进程/机器上使用不同 `worker-id` 重复执行这条命令。

### 3. 查询 run 状态

```bash
uv run --package campus-ingestion-worker python -m campus_ingestion_worker.show_authenticated_notice_closeout \
  --run-id run-14-async
```

### 4. 持续观察 run 状态

```bash
uv run --package campus-ingestion-worker python -m campus_ingestion_worker.watch_authenticated_notice_closeout \
  --run-id run-14-async \
  --interval 2
```

### 5. promotion 到 canonical scope

```bash
uv run --package campus-ingestion-worker python -m campus_ingestion_worker.promote_authenticated_notice_closeout \
  --run-id run-14-async
```

## 运行前提

- `OBJECT_STORE_*` 已配置
- `DOCUMENT_REGISTRY_DATABASE_URL` / `RAW_ASSET_REGISTRY_DATABASE_URL` 已配置
- `AUTHENTICATED_NOTICE_CLOSEOUT_DATABASE_URL` 已配置；如未单独配置，则当前实现回退到 `CAMPUS_SHARED_POSTGRES_URL`，再回退到 `DOCUMENT_REGISTRY_DATABASE_URL`
- 当前目标 collection 仍是 `campus_notices/internal_notice`
- posture 仍是 `restricted + offline_preparation`

## 对象存储布局

每个 run 的 operations prefix 固定为：

- `campus_notices/operations/authenticated-notice-closeout/{run_id}/`

关键对象：

- `run-manifest.json`
- `shard-plan.json`
- `batch-plan.json`
- `batches/<batch>/input.json`
- `workers/worker-0001.json`
- `milestones/planned.json`
- `milestones/staged.json`
- `milestones/verified.json`
- `milestones/promoted.json`
- `reconciliation/verification.json`
- `promotions/promotion-0001.json`
- `batches/<batch>/manifest.json`
- `staging/batches/<batch>/documents/...`

说明：

- planner 只写 `run-manifest.json`、plan artifacts 和每个 batch 的 `input.json`
- `capture/*`、`provider/*`、`source-truth/*` 仍直接写 canonical source object key
- worker 读取自己的 `batches/<batch>/input.json` 并只 prepare 当前 batch
- final `documents/internal_notice/...` 只在 promote 时写入

## 数据库布局

closeout staging schema 固定为：

- `ingestion_closeout.closeout_runs`
- `ingestion_closeout.closeout_shards`
- `ingestion_closeout.closeout_batches`
- `ingestion_closeout.closeout_workers`
- `ingestion_closeout.closeout_notice_stage`
- `ingestion_closeout.closeout_raw_asset_stage`
- `ingestion_closeout.closeout_document_stage`
- `ingestion_closeout.closeout_milestones`
- `ingestion_closeout.closeout_promotions`

这些表负责 progress / lease / manifest / staged digest / promotion truth，不负责最终 query-serving registry。

## 通过标准

run 可 promote 至少要求：

- `show_authenticated_notice_closeout` 返回 `state=verified`
- `completed_batch_count == batch_count`
- `verification.ok=true`
- `missing_notice_id_count=0`
- `missing_document_id_count=0`
- `missing_raw_asset_id_count=0`
- `missing_notice_manifest_count=0`
- `missing_document_units_count=0`
- `mismatched_document_hash_count=0`
- `mismatched_raw_version_count=0`
- `unexpected_document_id_count=0`

run 进入执行前至少要求：

- `state=planned`
- `completed_batch_count=0`
- `batch_count > 0`
- 每个 batch 均已写出 `batches/<batch>/input.json`

promotion 完成后至少要求：

- `state=done`
- `replaced_scope_record_count == expected_notice_count`
- final document registry scope 与 staged document count 一致

## 何时仍使用旧 closeout runner

只在以下情况保留 `closeout_authenticated_notice_historical_backfill`：

- 旧 cumulative-prefix run 已经启动，且需要继续观察同一执行
- 需要与 legacy checkpoint evidence 做对照

canonical 前向路径已经切换到 `plan -> worker(s) -> verify -> promote` 的 async staged closeout；不要再把旧 runner 当作默认 closeout 方案。
