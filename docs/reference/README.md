---
doc_type: index
truth_scope: repository
owner_boundary: docs/reference
status: active
created: 2026-04-12
updated: 2026-06-29
---
# Reference

`reference/` 保存术语、指标、清单、质量验收记录和已落盘事实。
当前仍作为默认 baseline 的材料保持 `active`；只保留追溯/对照价值的证据记录改为 `historical`。
它不是当前执行状态板，也不是 plan。

## 基础术语与验证基线

- `runtime-serving-and-index-terms.md`
  - 包含 `RetrievalPlan`、`Query Activity`、`Supporting Evidence`、`Freshness Gate` 等长期术语
- `testing-and-verification-lanes.md`
- `eval-gold-truth-model.md`
- `golden-dataset-case-matrix.md`
- `runtime-otel-telemetry-taxonomy.md`
- `student-handbook-eval-metrics.md`
- `curriculum-plan-eval-metrics.md`

## Authenticated Notice / Internal Notice 策略与口径

- `internal-notice-pdf-chunks.md`
- `institutional-regulations-offline-inventory.md`

## Authenticated Notice / Internal Notice Quality Acceptance

- `institutional-regulations-promotion-quality-acceptance.md`

## Navigation / Inventory

- `campus-navigation-authoritative-source-inventory.md`

补充规则：

- 已被并入 canonical 文档的 historical redirect notes 不再继续占据默认 root namespace
- 文档治理规范归 `docs/documentation-architecture.md`；reference root 不保留
  单独治理快照或 cleanup ledger。
- 需要追溯已退役 reference 材料时，通过 git history 恢复具体片段，再提升到当前 owner 文档。
