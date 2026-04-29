---
doc_type: plan
status: completed
created: 2026-04-20
updated: 2026-04-20
---

# Campus Services Offline Preparation Hardening

## Goal

把 `campus_services/*` 在 `offline_preparation` 阶段仍存在的 image-heavy 文档质量缺口收口到可执行状态，首条切片固定为 handbook-derived `service_catalog` 服务流程图文档。

## This Document Covers

- handbook-derived `service_navigation_document` 的 bounded source-truth materialization
- bounded multimodal admission gate
- projection-local OCR-provenance-preserving hybrid artifact contract
- title-only degradation fail-close gate
- targeted rebuild / verification / closeout

## This Document Does Not Cover

- `campus_services` query-serving opening
- course map / topology / curriculum diagram parsing
- auth-dependent source capture
- regulation downstream consumption
- whole-handbook replay 或 repo-wide OCR platform redesign

## First Bounded Slice

- target document: `中央民族大学学生公寓管理工作流程`
- source selector:
  - `source_title=中央民族大学公寓及公费医疗管理规定`
  - `source_handbook_section=中央民族大学公寓及公费医疗管理规定`
  - `source_page_start=252`
  - `source_page_end=255`
- target collection: `campus_services/service_catalog`

## Implementation Direction

1. 保持 handbook source-truth fan-out contract，不返回 raw-wide replay。
2. 在真正 materialization 之前，先对 `252-255` 页执行 bounded multimodal admission gate；probe 只允许使用该页段渲染出的页图，不扩大 source range。
3. 当前 admission gate 已通过；`Phase 2` 应按受控 hybrid materialization 规划，而不是继续保持 OCR-only。
4. 输出 target-local `layout-elements.jsonl`、`canonical.md`、`document-units.jsonl`，并保留稳定 lineage。
5. 当 OCR 或 hybrid lane 仍无法产出足够正文时显式 fail-close，不再静默落成 title-only artifact。

## Closeout Truth

- 当前首条 bounded slice `中央民族大学学生公寓管理工作流程` 已完成 closeout：
  - exact selector contract
  - bounded multimodal admission
  - bounded hybrid materialization
  - fail-close semantics
  - raw / replay convergence
  - rebuild cleanup integration
- 这份 plan 不再承载默认待做实现工作；后续若无新的 product admission，这条 workstream 视为 completed。

## Reopen Rule

- 只有在产品范围重新提升 `campus_services/*` offline-preparation quality hardening 优先级，
  或明确 admission 新的 bounded target 时，才恢复这条 workstream。

## Explicitly Routed Out

- 新的 `campus_services` image-heavy targets
- `service_catalog` query-serving opening
- course map / topology / curriculum diagram parsing
- auth-dependent source capture
- regulation downstream consumption
- retrieval rollout
