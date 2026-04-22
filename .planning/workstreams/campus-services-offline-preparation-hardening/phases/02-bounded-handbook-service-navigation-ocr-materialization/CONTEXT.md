---
phase: "02"
name: "Bounded Handbook Service Navigation Hybrid Materialization"
created: 2026-04-20
updated: 2026-04-20
status: pending
---

# Phase 02 Context

## Goal

把 handbook-derived `中央民族大学学生公寓管理工作流程` 从“已 admission 的 bounded candidate”
推进到“可由 raw ingestion 与 provider-response replay 共同物化的稳定 target-local artifacts”，
同时保持：

- OCR provenance 不变
- 多模态只补 flowchart body / edge recovery
- 范围严格收敛在 `252-255` 页

## Current Truth

- `Phase 01` 已冻结 selector、lineage、artifact boundary 与 fail-close 口径。
- `Phase 01.1` 已把这条 lane 冻结为 `admitted as bounded production materialization candidate`。
- 当前 source-truth declaration 已明确：
  - `projection_name=handbook_navigation_service_catalog`
  - `target_collection=service_catalog`
  - `target_title=中央民族大学学生公寓管理工作流程`
  - `source_page_start=252`
  - `source_page_end=255`
- 当前 repo 中 raw ingestion 与 replay rebuild 都汇合到
  `build_handbook_projection_import_documents(...)`。
- 当前缺口不在 selector，也不在 query-serving，而在于：
  - 现有 `cleanup_handbook_document(...)` 路径会把 image-heavy flowchart body 退化为 title-only
  - replay rebuild 当前没有稳定拿到真实 raw PDF object key，无法为多模态 lane 渲染同一页段的 page PNG

## Why This Phase Exists

如果跳过这个 phase，workstream 会停在一个模糊状态：

- admission 已通过，但没有正式 materialization lane
- raw ingestion 与 replay rebuild 仍然只能复用 title-oriented cleanup 路径
- `service_catalog` 的 offline-preparation 结果依旧不能稳定生成可消费正文

因此这个 phase 只回答一个窄问题：

- 如何在不改 repo-wide parser truth 的前提下，
  为这一个 handbook-derived service navigation document
  落成 bounded hybrid materialization

## Code-Seam Findings

- `packages/ingestion-core/src/campus_ingestion_core/handbook_source_projections.py`
  当前是 target projection 的 canonical owner seam。
- `packages/ingestion-core/src/campus_ingestion_core/raw_ingestion.py`
  与 `packages/ingestion-core/src/campus_ingestion_core/local_rebuild.py`
  都通过它生成 derived import documents。
- `packages/shared/src/campus_shared/prompt_runtime.py`
  已具备 strict structured-output execution plumbing，不需要为本 phase 另造 schema/runtime 基础设施。
- `packages/ingestion-core/src/campus_ingestion_core/local_rebuild.py`
  当前会构造 synthetic `RawAssetRecord(object_key=provider_response_key)`；
  这对 replay canonical cleanup 足够，但对“从真实 raw PDF 渲染 bounded page PNG”不够。

## Guardrails

- 只处理 `handbook_navigation_service_catalog`
- 只处理 `252-255` 页
- 只生成 `service_catalog` 的 `offline_preparation` artifacts
- OCR `provider-response.jsonl` 与 `layout-elements.jsonl` 继续保留为 provenance，不被多模态覆盖
- 不打开 query-serving
- 不扩到 handbook 其他 projection、curriculum、auth 或 regulation 主线
- 不把这个 phase 扩成 repo-wide multimodal parser 设计

## Phase Directory Note

GSD 当前 phase dir 仍是：

- `.planning/workstreams/campus-services-offline-preparation-hardening/phases/02-bounded-handbook-service-navigation-ocr-materialization/`

这是已有 phase slug 与当前 roadmap 命名之间的历史漂移。
本 phase 不重命名目录，只在文档与 roadmap truth 中明确：

- `Phase 2` 的真实边界是 `Hybrid Materialization`

## Canonical References

- `.planning/workstreams/campus-services-offline-preparation-hardening/STATE.md`
- `.planning/workstreams/campus-services-offline-preparation-hardening/ROADMAP.md`
- `.planning/workstreams/campus-services-offline-preparation-hardening/REQUIREMENTS.md`
- `.planning/workstreams/campus-services-offline-preparation-hardening/phases/01-service-navigation-projection-contract-freeze/PLAN.md`
- `.planning/workstreams/campus-services-offline-preparation-hardening/phases/01.1-bounded-service-navigation-multimodal-probe-and-admission/SUMMARY.md`
- `configs/ingestion/regulations/student_rules/source-projections.v1.json`
- `docs/architecture/file-asset-loader-architecture.md`
- `docs/reference/student-handbook-normalization-strategy.md`
- `packages/ingestion-core/src/campus_ingestion_core/handbook_source_projections.py`
- `packages/ingestion-core/src/campus_ingestion_core/raw_ingestion.py`
- `packages/ingestion-core/src/campus_ingestion_core/local_rebuild.py`
- `packages/shared/src/campus_shared/prompt_runtime.py`

## Expected Output

- 一个正式的、可执行的 Phase 02 plan
- 明确 replay/raw 共用的 bounded hybrid owner seam
- 明确 raw PDF page rendering、strict schema extraction、target-local artifact contract 与 fail-close 条件
- 明确后续 implementation/test write set，而不是继续停留在 admission 讨论
