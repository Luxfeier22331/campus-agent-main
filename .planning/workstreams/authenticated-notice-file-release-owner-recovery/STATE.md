---
workstream: authenticated-notice-file-release-owner-recovery
created: 2026-04-19
updated: 2026-04-19
---

# Project State

## Current Position

**Status:** In Progress
**Current Phase:** A
**Current Phase Name:** Auth Check And Targeted Export
**Current Plan:** first bounded slice is `351119 / 中央民族大学差旅费管理办法（民大校发〔2025〕104号）`
**Total Phases:** 5
**Total Plans in Phase:** N/A
**Progress:** 0/5 phases complete
**Last Activity:** 2026-04-19
**Last Activity Description:** Created a dedicated native workstream so auth-window work no longer rides inside the non-auth regulation lane.

## Current Slice

- 当前首条前向切片固定为 `351119`
- 顺序固定为 `auth:check -> targeted export -> bounded owner recovery -> promotion/materialization re-entry -> bounded rerun`
- 不用 full export、source-wide replay 或 collector 主线改造代替这一步

## Blockers

- 需要真实认证窗口与可用登录态
- 当前 repo 内仍缺真正消费 recovered owner body 的 downstream consumer closeout

## Verification

- `file_release` bundle / manifest contract 已冻结
- auth-window runbook 已冻结 `auth:check -> targeted export -> optional bounded smoke -> optional full export`
- readiness taxonomy 已冻结 `ready / missing_capture / missing_source_bytes / ambiguous_match`

## Session Continuity

**Stopped At:** awaiting auth-window execution for `351119`
**Resume File:** docs/plans/authenticated-notice-file-release-owner-recovery.md
