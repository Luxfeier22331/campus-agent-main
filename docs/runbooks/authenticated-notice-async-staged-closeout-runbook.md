---
doc_type: runbook
status: active
created: 2026-04-04
updated: 2026-04-12
---
# Authenticated Notice Async Staged Closeout Runbook

## 文档边界

这份 runbook 描述 authenticated notice 的 canonical async staged closeout workflow。

它不替代：

- `docs/runbooks/authenticated-notice-bootstrap-smoke-runbook.md`
- live collector / control-plane runbook

这份 runbook 只维护可重复执行的流程，不维护某一轮 run 的实时 checkpoint，也不复写已经退出默认路径的 cumulative-prefix
closeout 旧流程。

## Canonical CLI

### 1. 规划 staged run

```bash
uv run --package campus-ingestion-worker python -m \
  campus_ingestion_worker.plan_authenticated_notice_closeout
  --bundle-path \
    /home/reptilian/code/rag-data/muc-notice-collector/runtime/exports/notices-bundle-20260403-run-14.json
  --manifest-path \
    /home/reptilian/code/rag-data/muc-notice-collector/runtime/exports/export-manifest-20260403-run-14.json
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
uv run --package campus-ingestion-worker python -m \
  campus_ingestion_worker.run_authenticated_notice_closeout_worker
  --run-id run-14-async \
  --worker-id worker-a
```

多 worker 并行时，只需要在不同进程/机器上使用不同 `worker-id` 重复执行这条命令。

如果要在同一台机器上一次性拉起多个本地 worker，也可以使用：

```bash
uv run --package campus-ingestion-worker python -m \
  campus_ingestion_worker.run_authenticated_notice_closeout_worker
  --run-id run-14-async \
  --parallel-workers 8 \
  --worker-id-prefix worker
```

这条命令的 accepted 语义固定为：

- 父进程只负责编排
- 每个 worker 都在独立子进程里执行 `--worker-id worker-XX`
- 不再把多个 leased worker 塞进一个共享同一应用侧连接池的单进程线程池

### 3. 查询 run 状态

```bash
uv run --package campus-ingestion-worker python -m \
  campus_ingestion_worker.show_authenticated_notice_closeout
  --run-id run-14-async
```

### 4. 持续观察 run 状态

```bash
uv run --package campus-ingestion-worker python -m \
  campus_ingestion_worker.watch_authenticated_notice_closeout
  --run-id run-14-async \
  --interval 2
```

### 5. promotion 到 canonical scope

```bash
uv run --package campus-ingestion-worker python -m \
  campus_ingestion_worker.promote_authenticated_notice_closeout
  --run-id run-14-async
```

## 运行前提

- `OBJECT_STORE_*` 已配置
- `DOCUMENT_REGISTRY_DATABASE_URL` / `RAW_ASSET_REGISTRY_DATABASE_URL` 已配置
- offline operator shell 必须显式提供 operator lane
  DSN：`AUTHENTICATED_NOTICE_CLOSEOUT_OPERATOR_DATABASE_URL` 或
  `CAMPUS_SHARED_POSTGRES_OPERATOR_URL`
- 目标 collection 是 `campus_notices/internal_notice`
- collection posture 是 `restricted + offline_preparation`

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
- `milestones/promoting.json`
- `milestones/promoted.json`
- `reconciliation/verification.json`
- `promotions/promotion-0001.json`
- `promotions/promotion-0001/progress.json`
- `batches/<batch>/manifest.json`
- `promotion-batches/<batch>/manifest.json`
- `staging/batches/<batch>/documents/...`

说明：

- planner 只写 `run-manifest.json`、plan artifacts 和每个 batch 的 `input.json`
- `capture/*`、`provider/*`、`source-truth/*` 仍直接写 canonical source object key
- worker 读取自己的 `batches/<batch>/input.json` 并只 prepare 当前 batch
- final `documents/internal_notice/...` 只在 promote 时写入
- promoter 会把 progress truth 持续写回 `milestones/promoting.json` 与
  `promotions/promotion-0001/progress.json`
- promoter 的 copy 进度按 promotion batch 落盘；重启后会跳过 `done` batch，只重试未完成 batch

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
- `ingestion_closeout.closeout_promotion_batches`

这些表负责 progress / lease / manifest / staged digest / promotion truth，不负责最终
query-serving registry。

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

promotion 执行中，`show` / `watch` 至少应能读到：

- 顶层 `state=promoting`
- `promotion_state=running|done`
- `promotion_phase=raw_asset_sync|copying|registry_replace|done`
- `promotion.copy_batch_count`
- `promotion.copy_completed_batch_count`
- `promotion.copied_document_count`
- `promotion.copied_object_count`

## Partial Plan Repair

如果某次 run 出现以下特征：

- `run.expected_notice_count` / `run.batch_count` 显示 full frozen plan
- `list_shards` 显示 shard plan 完整
- 但实际 persisted batch rows 少于 `run.batch_count`
- worker 只消费了已落库 batch，run 被错误推进到 `verified`

则问题不是源数据缺失，而是 planner 在 batch 落库阶段被中断，留下了 partial planned run。

这类 run 的 canonical 修复路径固定为：

1. 不新建 delta run，不重跑已完成 batch
1. 读取当前 run 的 shard plan 与 `batches/<batch>/input.json`
1. 只补回缺失的 batch rows
1. 将 run 从错误的 `verified` / `running` 结果重开为可继续执行状态
1. 只续跑缺失 batch
1. 以完整 frozen plan 重新 verification
1. verification 通过后只 promote 一次

如果失败原因不是 partial batch rows，而是已经完成的 batch 里存在 stale stage rows，例如：

- `closeout_notice_stage` 缺少当前 verifier 需要的 `attachment_outcomes`
- source projection rules 已更新，旧 batch stage 里还残留已经不再属于 expected scope 的 child
  document rows

则 canonical repair 语义调整为：

1. 仍然只修同一个 run
1. 识别受影响的 completed batch
1. 先清掉这些 batch 对应的 notice/raw/document stage rows
1. 再把这些 completed batch 重开为 `pending`
1. 只重跑这些 stale completed batch
1. 重新 verification 后再继续单次 promote

禁止：

- 对 partial planned run 直接 promote
- 新开一个只含缺失 notice 的 delta run 再拼 scope
- 删除已 staged 的前缀结果后全量重跑

说明：

- canonical document scope 的写入语义仍然是单次 `replace_scope`
- 对于“一次性历史导入”，正确收口方式是修复同一个 run，而不是把一次 closeout 拆成多个 promote

## Planner Persistence Rules

planner 必须满足以下不变量：

- 只有在 frozen batch input 全部写完之后，才允许把 run 计划写入 DB
- run / shard / batch plan 必须在同一数据库事务内提交
- `milestones/planned.json` 只允许在完整 plan durable 后写出
- verification 不得把“当前存在的 batch rows”误当成完整 expected scope

## 何时仍使用旧 closeout runner

只在以下情况保留 `closeout_authenticated_notice_historical_backfill`：

- 旧 cumulative-prefix run 已经启动，且需要继续观察同一执行
- 需要与 legacy checkpoint evidence 做对照

canonical 前向路径已经切换到 `plan -> worker(s) -> verify -> promote` 的 async staged
closeout；不要再把旧 runner 当作默认 closeout 方案。
