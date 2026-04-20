---
phase: "01"
name: "Service Navigation Projection Contract Freeze"
created: 2026-04-20
updated: 2026-04-20
status: planned
---

# Phase 01 Context

**Gathered:** 2026-04-20
**Status:** Planned

<domain>
## Phase Boundary

本 phase 只负责：

- 冻结 handbook-derived `service_navigation_document` 的 selector 语义
- 冻结 bounded materialization 应处于哪一层、产出哪些 target-local artifacts、保留哪些 lineage 字段
- 冻结 image-heavy 服务流程图的 fail-close 口径
- 为后续 `Phase 02` 的 bounded OCR materialization 提供可直接实施的 contract

它不负责：

- 打开 `campus_services/service_catalog` query-serving
- 重做整本 handbook replay 或新增 raw-wide consumption lane
- 扩到 curriculum 课程地图、auth、regulation downstream、retrieval rollout
- 把这条线扩成 repo-wide 通用 OCR 查询平台

</domain>

<current_truth>
## Current Truth

- `configs/ingestion/regulations/student_handbook/source-projections.v1.json` 已经声明 `handbook_navigation_service_catalog`，selector 固定为：
  - `source_title=中央民族大学公寓及公费医疗管理规定`
  - `source_handbook_section=中央民族大学公寓及公费医疗管理规定`
  - `source_page_start=252`
  - `source_page_end=255`
  - `attachment_role=service_navigation_document`
  - `target_title=中央民族大学学生公寓管理工作流程`
- `packages/ingestion-core/src/campus_ingestion_core/handbook_source_projections.py` 当前会基于 selector 匹配 split manifest；若 manifest 中没有完全匹配文档，会退化为用 selector 直接合成一个 `SplitManifestDocument` 占位 source boundary。
- `service_catalog` collection 当前 runtime 仍是 `offline_preparation`，没有 query-serving opening。
- 当前 handbook-derived service navigation 文档仍复用 `cleanup_handbook_document(...)` 清洗路径；`packages/ingestion-core/src/campus_ingestion_core/handbook_cleanup.py` 会跳过没有文本且不是 table 的 row，因此 image-heavy 流程图页面会退化成 title-only 文档。

</current_truth>

<decisions>
## Implementation Decisions

- **01-01:** 当前缺口不是 source-truth selector 缺口。selector 已经存在且范围足够收敛；本 phase 不新增开放式查询参数，也不把 `service_catalog` 变成通用查询器。
- **01-02:** handbook source-truth 页码语义继续保持 1-based 且区间闭合，这一点来自现有 handbook normalization contract；任何后续 PDF subset 实现都必须在内部完成对底层库零基索引的显式转换，不能改写 repo 级 selector 语义。
- **01-03:** bounded OCR materialization 属于 projection-local derived lane，而不是新的 source-truth family。它只能消费已存在的 selector 和 raw/source-truth lineage，不得把这条线重写成 whole-handbook replay。
- **01-04:** 需要冻结的 target-local artifact contract 至少包括：
  - bounded OCR `provider-response.jsonl`
  - `layout-elements.jsonl`
  - `canonical.md`
  - `document-units.jsonl`
  其中被裁切的 PDF 页范围可以作为执行时的临时输入，不必升级成新的 canonical source-truth artifact。
- **01-05:** lineage 继续围绕现有 projection metadata 展开；后续 materialization 必须保留 `projection_name`、`derived_from`、`derived_from_document_id`、`derived_from_raw_asset_id`、`derived_from_raw_version_id`、`parent_document_id`，并显式带出 selector 页范围。
- **01-06:** fail-close 规则必须收紧到“如果 bounded OCR 没有产出足够正文，就不落 target document”，不能再接受只有标题、页眉页脚或 page number 的伪成功结果。

</decisions>

<specifics>
## Specific Gaps

- repo 里还没有 handbook-derived `service_navigation_document` 的 projection-local bounded OCR materialization owner。
- 还没有显式定义 target-local OCR artifacts 与现有 source-truth artifacts 的边界关系。
- 还没有把 title-only degradation 变成明确的质量 gate。
- `packages/ingestion-core` 里还没有现成的页范围 PDF subset 依赖与实现。

</specifics>

<canonical_refs>
## Canonical References

- `docs/plans/archive/completed/campus-services-offline-preparation-hardening.md`
- `.planning/WORKSTREAMS.md`
- `.planning/workstreams/campus-services-offline-preparation-hardening/STATE.md`
- `.planning/workstreams/campus-services-offline-preparation-hardening/ROADMAP.md`
- `.planning/workstreams/campus-services-offline-preparation-hardening/REQUIREMENTS.md`
- `configs/ingestion/regulations/student_handbook/source-projections.v1.json`
- `configs/ingestion/campus_services/service_catalog/README.md`
- `docs/reference/student-handbook-normalization-strategy.md`
- `packages/ingestion-core/src/campus_ingestion_core/handbook_source_projections.py`
- `packages/ingestion-core/src/campus_ingestion_core/handbook_cleanup.py`
- `packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_attachment_ocr.py`
- `packages/ingestion-core/src/campus_ingestion_core/raw_ingestion.py`

</canonical_refs>

<deferred>
## Deferred Follow-up

- `service_catalog` query-serving rollout
- curriculum 课程地图 / 拓扑图
- repo-wide OCR platform redesign
- handbook whole-asset replay hardening
- auth-dependent source capture 与 regulation downstream closeout

</deferred>
