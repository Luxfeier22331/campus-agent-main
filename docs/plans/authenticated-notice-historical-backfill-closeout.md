---
doc_type: plan
status: active
created: 2026-04-04
updated: 2026-04-04
---

# Authenticated Notice Historical Backfill Closeout

## 文档边界

本文只负责 `authenticated_notice_portal` 的 historical export closeout。

本文不负责：

- live portal 恢复
- scheduled / incremental sync
- authenticated notice control plane
- query-serving promotion

补充说明：

- Phase 12.2 之后，canonical 前向 closeout 方案已经切到 async staged pipeline
- 本文保留给 legacy cumulative-prefix closeout 证据与对照，不再作为默认执行路径

## 目标

把当前已经验证到 `240` 的 authenticated notice historical replay，收口到一套可恢复、可对账、可交接的 full backfill workflow，并把 closeout 证据固定下来。

## 当前起点

- bounded replay 已完成：
  - `2`
  - `10`
  - `50`
  - `240`
- 当前 full backfill 输入集：
  - bundle: `/home/reptilian/code/rag-data/muc-notice-collector/runtime/exports/notices-bundle-20260403-run-14.json`
  - manifest: `/home/reptilian/code/rag-data/muc-notice-collector/runtime/exports/export-manifest-20260403-run-14.json`
  - count: `6694`

## 收口完成定义

同时满足以下条件才算 closeout：

- 输入 bundle / manifest / expected notice count 已被冻结
- staged checkpoints 全部通过，且 checkpoints 只能是 cumulative prefix slices
- full replay 通过
- full rerun 通过
- reconciliation 证明 expected notice/raw identity 均已落到 registry
- document scope exact match 已闭合；raw asset scope 只要求 expected coverage，不要求无历史额外项
- `internal_notice` 仍保持 `restricted + offline_preparation`

## 实施顺序

### Wave 1：Execution Substrate

先补 repo-owned closeout runner，至少完成：

- 冻结 bundle / manifest / expected notice count
- 生成默认 checkpoints：`240 -> 1000 -> 3000 -> full`
- checkpoints 必须始终基于 full bundle 的 cumulative prefix slices；不能把 disjoint shard 当成 checkpoint
- 运行 checkpoints 并持久化 `summary.json`
- 支持 `--skip-existing`
- 支持 `--final-rerun`
- 产出 final closeout summary

### Wave 2：Reconciliation

至少产出：

- expected `document_id` 集合
- expected `raw_asset_id` 集合
- registry matching / missing 统计
- raw asset unexpected 统计仅作观测，不作为 closeout fail gate
- 缺失 `document-units.jsonl` 的 document 样本
- 缺失 `source-truth/notice-manifest.json` 的 document 样本

### Wave 3：Closeout Evidence

每次 closeout 输出目录至少保留：

- `frozen-input.json`
- `checkpoint-*/summary.json`
- `final-rerun/summary.json`（如果启用）
- `closeout-summary.json`

## 代码落点建议

- `apps/ingestion-worker/src/campus_ingestion_worker/closeout_authenticated_notice_historical_backfill.py`
- `tests/ingestion/test_closeout_authenticated_notice_historical_backfill_worker.py`
- `docs/runbooks/authenticated-notice-historical-backfill-closeout-runbook.md`

## 验证要求

- closeout runner CLI tests
- existing authenticated-notice import/smoke regression tests
- `git diff --check`

## 当前不做

- live portal access 恢复后的 collector run
- attachment downloading / object upload ownership 重开
- `app-api` operator/read-model
- retrieval / serving release
