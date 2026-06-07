---
doc_type: index
status: active
created: 2026-04-12
updated: 2026-04-21
---
# Authenticated Notice Domain

## 先看什么

- 架构总边界：`../architecture/domains/authenticated-notice/architecture.md`
- source-truth
  schema：`../data/authenticated-notice-source-truth-schema.md`
- 当前 merged truth：`../architecture/current-architecture.md`
- 通用执行态入口：`README.md`

## 长期边界与决策

- `../architecture/domains/authenticated-notice/architecture.md`
- `../contracts/campus-notice-runtime-contract.md`
- `../data/authenticated-notice-source-truth-schema.md`
- `../decisions/adr-0024-authenticated-notice-source-channel.md`
- `../decisions/adr-0025-authenticated-notice-async-staged-closeout.md`
- `../decisions/adr-0031-authenticated-notice-attachment-typed-routing-and-spati
  al-review-boundary.md`
- `../decisions/adr-0035-notice-derived-regulation-promotion-boundary.md`
- `../decisions/adr-0036-notice-derived-non-regulation-rule-boundary.md`
- `../decisions/adr-0037-unified-scoped-rules-holding-collection.md`
- `../decisions/adr-0041-authenticated-document-center-and-regulation-layer-spli
  t.md`

## 执行路由

- repo 级当前真相与 active work map 统一看 `README.md` 定义的通用执行态入口。
- 需要恢复 regulation consumption、file-release owner recovery 或 live portal / control-plane
  相关历史材料时，通过 git history 提取具体片段，再提升到当前 docs / ADR / runbook。
- operator、replay、promotion 步骤优先从 runbook 入口进入，不从历史 phase 目录恢复执行状态。

## Active Runbooks

- `../runbooks/authenticated-notice-bootstrap-smoke-runbook.md`
- `../runbooks/authenticated-notice-source-truth-replay-runbook.md`
- `../runbooks/authenticated-notice-async-staged-closeout-runbook.md`
- `../runbooks/internal-notice-policy-regulation-promotion-runbook.md`
- `../runbooks/internal-notice-regulation-target-quality-acceptance-runbook.md`

## Active Reference / Quality / Strategy

- `../reference/authenticated-notice-file-release-export-contract.md`
- `../reference/authenticated-notice-file-release-owner-recovery-readiness-contr
  act.md`
- `../reference/internal-notice-offline-preparation-strategy.md`
- `../reference/internal-notice-offline-preparation-quality-acceptance.md`
- `../reference/institutional-regulations-promotion-quality-acceptance.md`
- `../reference/institutional-regulations-offline-inventory.md`
- `../reference/internal-notice-manual-review-collection-strategy.md`
- `../reference/internal-notice-manual-review-future-query-contract.md`
- `../reference/internal-notice-pdf-chunk-tuning-sample-set-contract.md`
- `../reference/restricted-document-center-artifact-contract.md`
