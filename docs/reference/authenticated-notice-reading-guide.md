---
doc_type: reference
status: active
created: 2026-04-18
updated: 2026-04-18
---

# Authenticated Notice Reading Guide

## 先看什么

- 架构总边界：`../architecture/authenticated-notice-source-architecture.md`
- source-truth contract：`../architecture/authenticated-notice-source-truth-contract.md`
- 当前 merged truth：`../architecture/current-architecture.md`
- 当前项目执行真相：`../../.planning/PROJECT.md`
- 当前 workstream registry：`../../.planning/WORKSTREAMS.md`

## 长期边界与决策

- `../architecture/authenticated-notice-source-architecture.md`
- `../architecture/authenticated-notice-source-truth-contract.md`
- `../decisions/adr-0025-authenticated-notice-async-staged-closeout.md`
- `../decisions/adr-0031-authenticated-notice-attachment-typed-routing-and-spatial-review-boundary.md`
- `../decisions/adr-0035-notice-derived-regulation-promotion-boundary.md`
- `../decisions/adr-0036-notice-derived-non-regulation-rule-boundary.md`
- `../decisions/adr-0037-unified-scoped-rules-holding-collection.md`
- `../decisions/adr-0041-authenticated-document-center-and-regulation-layer-split.md`

## 当前阅读顺序

- `authenticated_notice_portal` foundation 已关闭；默认不要再把 donor foundation 文档当当前 active 入口
- 当前前向工作从 `internal_notice` triage、promotion、downstream consumption 的 active plan、runbook 与 quality reference 进入
- `campus_notices/internal_notice`、`regulations/institutional_regulations`、`regulations/scoped_rules` 当前都仍是 `offline_preparation`，不得写成已开放 query-serving
- live portal scheduling、authenticated control plane、collector repo migration 如需重开，应以 `.planning/PROJECT.md` / `.planning/WORKSTREAMS.md` 建新执行面，而不是复用 historical closeout 计划

## Active Plan

- `../plans/internal-notice-policy-regulation-consumption-implementation.md`

## Active Runbooks

- `../runbooks/authenticated-notice-bootstrap-smoke-runbook.md`
- `../runbooks/authenticated-notice-source-truth-replay-runbook.md`
- `../runbooks/authenticated-notice-async-staged-closeout-runbook.md`
- `../runbooks/internal-notice-policy-regulation-promotion-runbook.md`

## Specialized / Pilot Runbooks

- `../runbooks/authenticated-notice-source-truth-replay-pilot-runbook.md`

## Active Reference / Quality / Strategy

- `../reference/internal-notice-offline-preparation-strategy.md`
- `../reference/internal-notice-offline-preparation-quality-acceptance.md`
- `../reference/institutional-regulations-promotion-quality-acceptance.md`
- `../reference/internal-notice-manual-review-collection-strategy.md`
- `../reference/restricted-document-center-artifact-contract.md`

## Completed / Historical Material

- `../plans/authenticated-notice-historical-backfill-closeout.md`
- `../runbooks/authenticated-notice-historical-donor-intake-runbook.md`
- `../runbooks/authenticated-notice-historical-backfill-closeout-runbook.md`
- `../reference/authenticated-notice-portal-live-observations.md`
- `../reference/authenticated-notice-historical-closeout-evidence.md`
- `../reference/authenticated-notice-historical-donor-intake-evidence.md`
- `../reference/internal-notice-offline-preparation-quality-evidence.md`
