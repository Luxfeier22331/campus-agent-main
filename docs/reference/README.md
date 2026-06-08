---
doc_type: index
status: active
created: 2026-04-12
updated: 2026-06-04
---

# Reference

`reference/` 保存术语、指标、清单、质量验收记录和已落盘事实。
当前仍作为默认 baseline 的材料保持 `active`；只保留追溯/对照价值的证据记录改为 `historical`。
它不是当前执行状态板，也不是 plan。

## 基础术语与验证基线

- `adr-governance-audit.md`
  - 全量 ADR corpus 的 drift、overlap 与分层审计记录
- `runtime-serving-and-index-terms.md`
  - 包含 `RetrievalPlan`、`Query Activity`、`Supporting Evidence`、`Freshness Gate` 等长期术语
- `qa-assistant-and-harness-gap-review.md`
- `durable-agent-runtime-gap-matrix.md`
- `testing-and-verification-lanes.md`
- `eval-gold-truth-model.md`
- `eval-benchmark-artifact-contract.md`
- `golden-dataset-case-matrix.md`
- `runtime-otel-telemetry-taxonomy.md`
- `student-handbook-eval-metrics.md`
- `curriculum-plan-eval-metrics.md`

## Official Web 活动基线

- `official-web-fresh-news-eval-baseline.md`
- `official-web-fresh-news-surface-handoff.md`
- `official-web-news-surface-opening-checklist.md`
- `official-web-stable-reference-eval-baseline.md`

## Authenticated Notice / Internal Notice 策略与口径

- `authenticated-notice-file-release-export-contract.md`
- `authenticated-notice-file-release-owner-recovery-readiness-contract.md`
- `internal-notice-manual-review-collection-strategy.md`
- `internal-notice-manual-review-future-query-contract.md`
- `internal-notice-offline-preparation-strategy.md`
- `internal-notice-offline-preparation-quality-acceptance.md`
- `internal-notice-pdf-chunk-tuning-sample-set-contract.md`
- `institutional-regulations-offline-inventory.md`
- `restricted-document-center-artifact-contract.md`

## Authenticated Notice / Internal Notice Quality Acceptance

- `institutional-regulations-promotion-quality-acceptance.md`

## Navigation / Inventory

- `campus-navigation-authoritative-source-inventory.md`

## Public Chat Web 活动基线

- `public-chat-web-donor-diff-classification.md`
- `public-chat-web-donor-parity-review-checklist.md`

## Frontend Design Inputs

- `muc-campus-qa-frontend-design/`
  - MUC Campus Q&A frontend design package: static prototype, screenshots,
    design map, notes, tokens, and Tailwind mapping. This is accepted design
    input for implementation, not runtime topology or deployment truth.

## 其他实现参考

- `student-handbook-normalization-strategy.md`

## Historical Evidence / Archive

- `archive/README.md`

补充规则：

- historical 材料优先按领域或问题域集中到 `archive/` 子目录，而不是继续平铺在 `reference/` 根层
- 已被并入 canonical 文档的 historical redirect notes 不再继续占据默认 root namespace
- 需要追溯旧材料时，优先从 `archive/README.md` 与对应 archive hub 进入
