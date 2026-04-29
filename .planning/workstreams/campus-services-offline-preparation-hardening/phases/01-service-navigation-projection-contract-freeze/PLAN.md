---
doc_type: phase_plan
phase: "01"
phase_name: "Service Navigation Projection Contract Freeze"
status: planned
created: 2026-04-20
updated: 2026-04-20
---

# Phase 01 Plan

## Objective

冻结 handbook-derived `service_navigation_document` 的 selector、bounded materialization boundary、artifact set、lineage 字段与 fail-close 规则，让 `Phase 02` 可以直接实现 `中央民族大学学生公寓管理工作流程` 的 bounded OCR materialization。

## Why This Phase Exists

当前 repo 已经有：

- 已冻结的 handbook source-truth projection selector
- `service_catalog` 的 offline-preparation runtime boundary
- 可复用的 OCR runtime 与 artifact-builder pattern

当前 repo 还没有：

- handbook-derived `service_navigation_document` 的 projection-local bounded OCR contract
- title-only degradation 的正式 fail-close 口径
- 对 `provider-response.jsonl` / `layout-elements.jsonl` / `canonical.md` / `document-units.jsonl` 之间边界的冻结表达

如果不先单独做这个 phase，后续实现会在以下问题上反复摇摆：

- 是否应该回退到 whole-handbook replay
- selector 页码是否要被底层 PDF 库改写
- 是否需要保留 bounded OCR provenance
- 什么才算 image-heavy navigation document 的 materialization success

## Locked Inputs

- source selector 不变：
  - `source_title=中央民族大学公寓及公费医疗管理规定`
  - `source_handbook_section=中央民族大学公寓及公费医疗管理规定`
  - `source_page_start=252`
  - `source_page_end=255`
- handbook source-truth 页码继续保持 1-based、闭区间语义。
- `service_catalog` 继续保持 `offline_preparation`；不打开 query-serving。
- 不新增 raw-wide replay，不重做整本 handbook source-truth。
- 不把这条线扩成 curriculum、auth 或 regulation 主线。

## Decisions To Freeze

1. bounded selector 继续直接复用当前 source-truth declaration；不新增开放式过滤器。
2. bounded materialization 是 target projection 的派生阶段，不是新的 source-truth family。
3. Phase 02 的最小 artifact contract 固定为：
   - bounded OCR `provider-response.jsonl`
   - `layout-elements.jsonl`
   - `canonical.md`
   - `document-units.jsonl`
4. 被页范围裁切后的 PDF 只作为执行输入，不单独升级为长期 canonical artifact。
5. lineage 至少保留：
   - `projection_name`
   - `derived_from`
   - `derived_from_document_id`
   - `derived_from_raw_asset_id`
   - `derived_from_raw_version_id`
   - `parent_document_id`
   - `source_page_start`
   - `source_page_end`
6. materialization success 必须满足“除标题/页边噪声外存在可消费正文”；否则 fail-close。

## Execution Slices

### Slice 1: Freeze Selector Semantics

- 在 workstream docs 中明确：
  - 当前缺口不是 selector 不够精确
  - selector 页码仍采用 handbook source-truth 的 1-based 闭区间
  - 任何底层 PDF subset 实现都只能做内部适配，不能反向改写 operator contract

### Slice 2: Freeze Materialization Boundary

- 明确 bounded OCR materialization 的 owner 在 handbook-derived target projection 层
- 明确它消费的是：
  - 已声明 selector
  - 已存在 raw/source-truth lineage
- 明确它不会：
  - 产生新的 source-truth corpus
  - 回退 whole-handbook replay
  - 打开 query-serving

### Slice 3: Freeze Artifact And Lineage Contract

- 冻结 Phase 02 应输出的最小 artifact set
- 冻结 metadata/lineage 必填字段
- 冻结“subset PDF 可临时、不必持久化；bounded provider response 必须持久化”的边界

### Slice 4: Freeze Fail-Close Rule

- 明确 title-only、page-number-only、header/footer-only 结果都不算成功
- 明确 Phase 02/03 需要为 image-heavy 页面建立 body-bearing gate
- 明确 targeted rebuild/verification 必须能区分：
  - selector miss
  - OCR no usable body
  - artifact generation success

### Slice 5: Prepare Phase 02 Admission

- 把最小依赖与实现路径锁定为：
  - `pypdf` for bounded page subset
  - existing OCR client
  - existing artifact-builder pattern
- 把 `Phase 02` 的写集、测试目标和验证要点前置冻结，避免实现阶段再做方案漂移

## Proposed Write Set

- `.planning/workstreams/campus-services-offline-preparation-hardening/phases/01-service-navigation-projection-contract-freeze/CONTEXT.md`
- `.planning/workstreams/campus-services-offline-preparation-hardening/phases/01-service-navigation-projection-contract-freeze/RESEARCH.md`
- `.planning/workstreams/campus-services-offline-preparation-hardening/phases/01-service-navigation-projection-contract-freeze/PLAN.md`
- `.planning/workstreams/campus-services-offline-preparation-hardening/STATE.md`
- `.planning/workstreams/campus-services-offline-preparation-hardening/ROADMAP.md`
- `docs/plans/archive/completed/campus-services-offline-preparation-hardening.md`
- `configs/ingestion/campus_services/service_catalog/README.md`
- `docs/reference/student-handbook-normalization-strategy.md`

## Verification Matrix

- planning verification
  - GSD `roadmap.get-phase 1` 能稳定返回 phase detail
  - Phase 01 目录下存在 `CONTEXT.md`、`RESEARCH.md`、`PLAN.md`
- contract verification
  - docs 明确声明 selector 没有扩大为 query interface
  - docs 明确声明页码仍是 1-based 闭区间
  - docs 明确声明 subset PDF 只是执行输入，bounded provider response 才是 target-local provenance
- architecture verification
  - planning truth 明确 `service_catalog` 仍为 `offline_preparation`
  - planning truth 明确不与 auth/regulation/curriculum 主线耦合

## Exit Rule

Phase 01 完成时，repo 应达到：

- 任何后续实现者都不需要重新讨论 selector 语义
- `Phase 02` 的最小实现方向已经固定为 “页范围 subset + 现有 OCR + 现有 artifact builder”
- provenance、artifact set、fail-close 口径已经冻结
- 这条线仍保持 deferred planning 状态，但恢复后可直接进入 bounded OCR materialization 实施
