---
doc_type: requirements
status: deferred
created: 2026-04-20
updated: 2026-04-20
---

# Requirements: Campus Services Offline Preparation Hardening

## Goal

在不打开 `campus_services` query-serving 的前提下，补齐 image-heavy `service_catalog` 服务导航文档的 offline-preparation 质量闭环；首条执行切片固定为 handbook-derived `中央民族大学学生公寓管理工作流程`。

## In Scope

- handbook source-truth selector 驱动的 `service_catalog` 服务导航文档投影
- bounded page-range multimodal probe admission
- bounded page-range OCR-provenance-preserving hybrid materialization
- 在既有 OCR provenance 之上的 projection-local `flow-graph.json` / `canonical.md` / `document-units.jsonl`
- title-only degradation fail-close gate
- `service_catalog` 定向 rebuild / targeted verification / planning closeout

## Non-goals

- 打开 `campus_services/service_catalog` query-serving
- 课程地图 / 拓扑图 / curriculum 相关问题
- 整本 handbook replay 重做、repo-wide 通用 OCR 平台化或通用多模态 parser 平台化
- `contact_directory`、auth、regulation、retrieval rollout
- 通过 chunk-only 规则修补 image-only 正文缺失

## Success Criteria

1. handbook-derived `service_navigation_document` 可以只在声明页范围内做 bounded materialization，不回退到 raw-wide replay。
2. `Phase 01.1` 能明确判定多模态是 `not admitted`、`bounded probe only` 还是 `bounded production materialization candidate`，并把结论冻结到后续相位边界。
3. `中央民族大学学生公寓管理工作流程` 能生成带稳定 lineage 的 target-local artifacts，而不是只剩标题页。
4. image-heavy 流程页在 OCR 或 hybrid lane 未产出足够正文时显式 fail-close，不再静默落成 title-only `document-units`。
5. 本地 targeted rebuild / verification / planning truth 可以独立收口，不与任何 auth 或 regulation 主线耦合。

## Canonical Entry

- `docs/plans/archive/completed/campus-services-offline-preparation-hardening.md`
