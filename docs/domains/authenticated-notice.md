---
doc_type: index
status: active
created: 2026-04-12
updated: 2026-04-12
---

# Authenticated Notice Domain

## 先看什么

- 架构总边界：`../architecture/authenticated-notice-source-architecture.md`
- source-truth contract：`../architecture/authenticated-notice-source-truth-contract.md`
- 当前 merged truth：`../architecture/current-architecture.md`
- 当前项目执行真相：`../../.planning/PROJECT.md`

## 长期边界与决策

- `../architecture/authenticated-notice-source-architecture.md`
- `../architecture/authenticated-notice-source-truth-contract.md`
- `../decisions/adr-0024-authenticated-notice-source-channel.md`
- `../decisions/adr-0025-authenticated-notice-async-staged-closeout.md`
- `../decisions/adr-0031-authenticated-notice-attachment-typed-routing-and-spatial-review-boundary.md`
- `../decisions/adr-0035-notice-derived-regulation-promotion-boundary.md`

## 当前执行说明

- `authenticated_notice_portal` source foundation 已在 Phase 12 收口；默认不要再把 foundation 文档当当前 active phase 入口
- 当前前向工作重点是 `internal_notice` 的 triage、promotion、`institutional_regulations` / `scoped_rules` downstream consumption
- `campus_notices/internal_notice`、`regulations/institutional_regulations`、`regulations/scoped_rules` 当前都仍是 `offline_preparation`，不得写成已开放 query-serving
- live portal scheduling、authenticated control plane、collector repo migration 如需重开，应在 `.planning/PROJECT.md` / `.planning/STATE.md` 中显式建新执行面，而不是继续沿用已完成 foundation plan

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

- `../reference/authenticated-notice-portal-live-observations.md`
- `../reference/internal-notice-offline-preparation-strategy.md`
- `../reference/internal-notice-offline-preparation-quality-acceptance.md`
- `../reference/internal-notice-offline-preparation-quality-evidence.md`
- `../reference/institutional-regulations-promotion-quality-acceptance.md`
- `../reference/internal-notice-manual-review-collection-strategy.md`
- `../reference/internal-notice-manual-review-future-query-contract.md`

## Completed / Historical Plans

- `../plans/authenticated-notice-source-foundation.md`
- `../plans/authenticated-notice-historical-backfill-closeout.md`
- `../plans/local-live-eval-canonical-registry-recovery.md`

## Historical / Comparison Runbooks

- `../runbooks/authenticated-notice-historical-donor-intake-runbook.md`
- `../runbooks/authenticated-notice-historical-backfill-closeout-runbook.md`

## Historical Evidence / Archive

- `../reference/authenticated-notice-historical-closeout-evidence.md`
- `../reference/authenticated-notice-historical-donor-intake-evidence.md`
