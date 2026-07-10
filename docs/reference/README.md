---
doc_type: index
truth_scope: repository
owner_boundary: docs/reference
status: active
created: 2026-04-12
updated: 2026-07-04
---
# Reference

`reference/` 保存术语、指标、清单、质量验收记录和已落盘事实。
当前仍作为默认 baseline 的材料保持 `active`；只保留追溯/对照价值的证据记录改为 `historical`。
它不是当前执行状态板，也不是 plan。

## 基础术语与验证基线

- `runtime-serving-and-index-terms.md`
  - 包含 `RetrievalPlan`、`Query Activity`、`Supporting Evidence`、`Freshness Gate` 等长期术语
- `testing-and-verification-lanes.md`
- `eval.md`
  - Active eval shape: Langfuse/Ragas lanes, eval asset semantics and operator
    coverage projection contract.
- `eval-map.md`
  - eval lane cases、observation producer、pass/fail rule 与 Langfuse score name
    的迁移控制表；不替代 ADR-0061
- `eval-gold-truth-model.md`
- `runtime-otel-telemetry-taxonomy.md`
- `observability-ledger.md`
  - trace / observability completion ledger and verification mapping
- `student-handbook-eval-metrics.md`
- `curriculum-plan-eval-metrics.md`

## Authenticated Notice / Internal Notice 策略与口径

- `internal-notice-pdf-chunks.md`

## Authenticated Notice / Internal Notice Quality Acceptance

- `institutional-regulations-promotion-quality-acceptance.md`

## Navigation / Inventory

- `open-source-data.md`
  - Open-source publication inventory for tracked source/data artifacts,
    fixtures, media, map data and source-derived corpora.

真实 institutional regulation inventory、navigation source inventory 与 release
gold corpus 属于 private source/data boundary，不在公开 repo 的 active
reference namespace 中保留。公开仓库只保留数据形态、admission 规则与 synthetic
fixtures。

补充规则：

- 已被并入 canonical 文档的 historical redirect notes 不再继续占据默认 root namespace
- 文档治理规范归 `docs/documentation-architecture.md`；reference root 不保留
  单独治理快照或 cleanup ledger。
- 需要追溯已退役 reference 材料时，通过 git history 恢复具体片段，再提升到当前 owner 文档。
