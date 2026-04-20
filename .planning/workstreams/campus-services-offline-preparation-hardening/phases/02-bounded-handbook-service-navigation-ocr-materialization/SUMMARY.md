---
phase: "02"
artifact: "summary"
created: 2026-04-20
updated: 2026-04-20
status: completed
---

# Phase 02 Summary

## Outcome

`Bounded Handbook Service Navigation Hybrid Materialization`
已在 repo 内落成首条可执行实现，范围继续严格限定为：

- `projection_name=handbook_navigation_service_catalog`
- `target_collection=service_catalog`
- `source_title=中央民族大学公寓及公费医疗管理规定`
- `source_handbook_section=中央民族大学公寓及公费医疗管理规定`
- `source_page_start=252`
- `source_page_end=255`

本 phase 没有把 handbook projection 扩成 repo-wide multimodal parser，
也没有打开 `campus_services/service_catalog` query-serving。

## Implemented

### 1. Projection-local bounded hybrid lane

- 新增：
  - `packages/ingestion-core/src/campus_ingestion_core/handbook_service_navigation_hybrid_materialization.py`
- 在 `build_handbook_projection_import_documents(...)` 中引入 exact dispatch：
  - 只有 `handbook_navigation_service_catalog`
  - 只有 `service_navigation_document`
  - 只有 `252-255` 页
  才进入 hybrid lane

### 2. Target-local artifact contract

- 新增 target-local structured artifact：
  - `flow-graph.json`
- 由 `flow-graph.json` 继续生成：
  - `canonical.md`
  - `document-units.jsonl`
- lineage 继续保留：
  - `projection_name`
  - `derived_from`
  - `derived_from_document_id`
  - `derived_from_raw_asset_id`
  - `derived_from_raw_version_id`
  - `migration_source_provider_response_key`
  - `source_page_start`
  - `source_page_end`

### 3. Raw / replay convergence

- raw ingestion 路径把真实 raw PDF object key 传入 bounded hybrid helper
- provider-response replay 路径也补齐了真实 raw asset resolution
- `replay_raw_asset_record` 的要求被收敛到 projection-local hybrid 分支，
  不再把所有 handbook replay 无条件升级成 raw-PDF hard dependency

### 4. Fail-close gate

以下情况显式失败，不再静默落成 title-only artifact：

- page mapping 与 `252-255` 不一致
- 没有 body-bearing steps
- `next_step_ids` 悬空
- replay 命中 hybrid projection 但缺失真实 raw asset record

## Verification Run

实际执行并通过的命令：

```bash
uv run --all-packages python -m unittest tests.ingestion.test_handbook_service_navigation_hybrid_materialization
uv run --all-packages python -m unittest tests.ingestion.test_provider_result_replay_rebuild
uv run --all-packages python -m unittest tests.ingestion.test_rebuild_local_data
```

结果：

- `tests.ingestion.test_handbook_service_navigation_hybrid_materialization`: `2/2 OK`
- `tests.ingestion.test_provider_result_replay_rebuild`: `14/14 OK`
- `tests.ingestion.test_rebuild_local_data`: `30/30 OK`

## Remaining Gap Routed Forward

Phase 02 已收口“bounded hybrid materialization exists and passes targeted unit coverage”，
但还没有把以下内容正式写成下一相位的 closeout contract：

- targeted verification matrix
- raw/replay convergence evidence as planning truth
- selector non-expansion evidence
- rebuild integration closeout and next follow-up routing

这些内容前推到 `Phase 3: Service Navigation Targeted Verification And Rebuild Integration`。
