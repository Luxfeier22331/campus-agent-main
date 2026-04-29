---
phase: "03"
artifact: "summary"
created: 2026-04-20
updated: 2026-04-20
status: completed
---

# Phase 03 Summary

## Outcome

`Service Navigation Targeted Verification And Rebuild Integration`
已完成，`Phase 02` 的 bounded hybrid lane 现在有正式的 targeted verification evidence，
可以作为后续 planning closeout 的稳定输入。

本 phase 没有继续扩展 hybrid extraction 能力，
只补齐了验证缺口并把 closeout 证据写回 planning truth。

## What Was Verified

### 1. Selector non-expansion

- 新增 exact selector regression：
  - 只有以下组合才会命中 hybrid lane：
    - `projection_name=handbook_navigation_service_catalog`
    - `target_collection=service_catalog`
    - `attachment_role=service_navigation_document`
    - `source_page_start=252`
    - `source_page_end=255`

结论：

- bounded lane 仍然是 exact-slice capability，
  没有静默扩大成 handbook 其他 projection 或其他页段。

### 2. Fail-close semantics

- 新增并通过以下 fail-close regression：
  - `page mapping mismatch`
  - `dangling next_step_ids`
- 先前已存在并继续通过：
  - `no body-bearing steps`
  - replay 缺失真实 raw asset record 时 fail-close

结论：

- strict schema 之外的语义质量闸门仍然有效。

### 3. Raw / replay convergence

- replay rebuild 继续验证：
  - 命中 bounded hybrid lane 时会传入真实 raw asset record
  - 缺失真实 raw asset record 时 fail-close
- raw ingestion 路径继续保持同一 owner seam 与同一 bounded selector contract

结论：

- 当前 closeout 证据足以支持“raw / replay 对这条 slice 使用同一 implementation truth”。

### 4. Rebuild cleanup integration

- 新增并通过 cleanup regression：
  - declared projection cleanup 现在显式覆盖：
    - `canonical.md`
    - `document-units.jsonl`
    - `flow-graph.json`

结论：

- `flow-graph.json` 已被正式纳入 rebuild / cleanup accounting，
  不再只是实现层内部 artifact。

## Test Changes

更新测试文件：

- `tests/ingestion/test_handbook_service_navigation_hybrid_materialization.py`
- `tests/ingestion/test_rebuild_local_data.py`

## Verification Run

实际执行并通过的命令：

```bash
uv run --all-packages python -m unittest tests.ingestion.test_handbook_service_navigation_hybrid_materialization
uv run --all-packages python -m unittest tests.ingestion.test_provider_result_replay_rebuild
uv run --all-packages python -m unittest tests.ingestion.test_rebuild_local_data
```

结果：

- `tests.ingestion.test_handbook_service_navigation_hybrid_materialization`: `5/5 OK`
- `tests.ingestion.test_provider_result_replay_rebuild`: `14/14 OK`
- `tests.ingestion.test_rebuild_local_data`: `30/30 OK`

补充说明：

- replay 测试运行中出现 `PyTorch was not found` 提示，
  但 unittest 结果为 `OK`，不影响本 phase 结论。

## Remaining Work Routed Forward

当前剩余任务已经收缩为 planning-only closeout：

- 把首条 bounded slice 的完成口径写成最终 closeout truth
- 明确这条 workstream 是否就此完成，还是只保留 reopen rule
- 明确后续 `campus_services` follow-up 哪些仍留在线内，哪些不进入长期产品消费目标

这些内容前推到 `Phase 04: Planning Closeout And Follow-up Routing`。
