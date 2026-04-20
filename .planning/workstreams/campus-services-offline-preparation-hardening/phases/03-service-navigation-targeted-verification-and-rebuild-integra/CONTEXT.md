---
phase: "03"
name: "Service Navigation Targeted Verification And Rebuild Integration"
created: 2026-04-20
updated: 2026-04-20
status: pending
---

# Phase 03 Context

## Goal

把 `Phase 02` 已落成的 bounded hybrid materialization
从“代码与局部测试已通过”
推进到“verification / rebuild integration / planning truth 都已正式收口”。

## Current Truth

- `Phase 01` 已冻结 handbook-derived `service_navigation_document` selector、lineage 与 fail-close 口径。
- `Phase 01.1` 已完成 bounded multimodal probe admission。
- `Phase 02` 已在 `packages/ingestion-core` 落成 projection-local hybrid lane：
  - declared-page PNG rendering
  - strict-schema flow graph extraction
  - `flow-graph.json`
  - `canonical.md`
  - `document-units.jsonl`
  - raw / replay convergence
- 当前通过的 targeted tests 已覆盖：
  - hybrid helper fail-close
  - replay raw asset resolution
  - rebuild-local-data cleanup expectations

## Why This Phase Exists

`Phase 02` 解决的是“能力缺口”。
`Phase 03` 解决的是“这条 bounded lane 如何被正式验证为可继续保留，而不会误扩范围或破坏其他 handbook replay”。

如果跳过本 phase，repo 会停留在：

- 实现存在，但 workstream truth 仍没有把验证收口为正式 closeout
- 没有把 selector non-expansion、rebuild integration、raw/replay convergence 作为独立验证面冻结
- 下一次恢复时仍要重新解释“到底哪些问题已在 Phase 02 内解决，哪些属于后续跟进”

## Locked Inputs

- target projection 继续固定为 `handbook_navigation_service_catalog`
- source selector 继续固定为：
  - `source_title=中央民族大学公寓及公费医疗管理规定`
  - `source_handbook_section=中央民族大学公寓及公费医疗管理规定`
  - `source_page_start=252`
  - `source_page_end=255`
- target title 继续固定为 `中央民族大学学生公寓管理工作流程`
- `service_catalog` 继续保持 `offline_preparation`
- 不打开 query-serving
- 不扩到 handbook 其他 image-heavy 目标、curriculum、auth、regulation 或 retrieval rollout

## Canonical References

- `.planning/workstreams/campus-services-offline-preparation-hardening/STATE.md`
- `.planning/workstreams/campus-services-offline-preparation-hardening/ROADMAP.md`
- `.planning/workstreams/campus-services-offline-preparation-hardening/REQUIREMENTS.md`
- `.planning/workstreams/campus-services-offline-preparation-hardening/phases/02-bounded-handbook-service-navigation-ocr-materialization/PLAN.md`
- `.planning/workstreams/campus-services-offline-preparation-hardening/phases/02-bounded-handbook-service-navigation-ocr-materialization/SUMMARY.md`
- `configs/ingestion/regulations/student_handbook/source-projections.v1.json`
- `packages/ingestion-core/src/campus_ingestion_core/handbook_service_navigation_hybrid_materialization.py`
- `packages/ingestion-core/src/campus_ingestion_core/handbook_source_projections.py`
- `packages/ingestion-core/src/campus_ingestion_core/local_rebuild.py`
- `packages/ingestion-core/src/campus_ingestion_core/raw_ingestion.py`
- `tests/ingestion/test_handbook_service_navigation_hybrid_materialization.py`
- `tests/ingestion/test_provider_result_replay_rebuild.py`
- `tests/ingestion/test_rebuild_local_data.py`

## Expected Output

- 一个正式的 Phase 03 verification / integration plan
- 明确哪些验证已经由 Phase 02 测试覆盖，哪些仍需补强
- 明确 rebuild integration closeout 的验收口径
- 明确 `Phase 04` 只剩 planning closeout，而不是继续返回实现层发散
