---
created: 2026-04-06T10:15:00.000Z
title: 收口 authenticated-notice inventory 与 bulk-stage follow-up
area: ingestion
files:
  - packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_source_truth_inventory.py
  - packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_defaults.py
  - packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_closeout_planning.py
  - packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_closeout_store.py
  - packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_closeout_service.py
  - packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_closeout_verification.py
  - packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_closeout_promotion.py
  - packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_import.py
  - packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_source_projections.py
  - packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_source_truth_replay.py
  - apps/ingestion-worker/src/campus_ingestion_worker/__init__.py
  - apps/ingestion-worker/src/campus_ingestion_worker/rebuild_authenticated_notice_source_truth_inventory.py
  - tests/ingestion/test_authenticated_notice_closeout_async.py
  - tests/ingestion/test_rebuild_authenticated_notice_source_truth_inventory_worker.py
  - docs/runbooks/authenticated-notice-source-truth-replay-runbook.md
  - docs/architecture/authenticated-notice-source-architecture.md
---

## Problem

当前 worktree 里仍保留一组未提交的 authenticated-notice follow-up 变更，核心方向是：

1. 把 source-truth replay inventory 固化为 projection-only metadata store
2. 用 `planning_weight` 做 weighted shard / batch 规划
3. 把 stage 写入从逐条 upsert 收紧成 bulk stage writers
4. 让 verifier 优先读取 frozen inventory，而不是重新扫描 batch inputs 或 source scope
5. 提供 worker-owned inventory rebuild 入口，并在 import path / promotion path 上同步 inventory-aware 语义

这组改动已经跨过代码、测试和 runbook，但尚未被明确标记为“继续推进”还是“显式 park”。继续悬空会让 Phase 12 follow-up 的 planning truth 漂移。

## Solution

Wave A 内按以下顺序收口：

1. 先运行 targeted verification，确认当前 dirty diff 的测试和最小回归是否成立。
2. 如果验证通过，把它明确登记为 authenticated-notice 近端 follow-up，并继续补齐缺失文档/验证。
3. 如果验证不通过，定位失败点并决定是补修还是 park；不能保持无状态 dirty worktree。
4. 在结果明确后，再决定是否把这组改动作为 Wave D 的前置完成项。

## Current Status

- 2026-04-06 已执行 `uv run --all-packages python -m unittest tests.ingestion.test_authenticated_notice_closeout_async`
- 2026-04-06 已执行 `uv run --all-packages python -m unittest tests.ingestion.test_rebuild_authenticated_notice_source_truth_inventory_worker`
- 2026-04-06 已执行 `uv run --all-packages python -m unittest tests.ingestion.test_authenticated_notice_import tests.ingestion.test_import_authenticated_notice_export_worker`
- 当前针对性验证累计 `29/29` 通过
- 当前判断：这组改动不是临时失败实验，继续作为 authenticated-notice 近端 follow-up 推进；Wave A 对“是否保留”的判断已经结束，后续重点转为收口 docs / additional verification / commit boundary
