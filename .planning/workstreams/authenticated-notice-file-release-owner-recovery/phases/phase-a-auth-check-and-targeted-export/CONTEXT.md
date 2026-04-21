---
phase: "A"
name: "Auth Check And Targeted Export"
created: 2026-04-19
status: completed
---

# Phase A Context

## Goal

利用本次真实 auth window 完成 export/readiness closeout：
冻结 `auth:check -> targeted export -> optional bounded smoke -> optional full export` 的 operator 顺序，
并把当前 `notice` / `file_release` inventory materialization 与 exclusion truth 收口为 completed phase。

## Current Truth

- 当前 auth window 已产出：
  - `notice` export manifest：`items_inserted=60`、`detail_fetched=60`
  - `file_release` export manifest：`items_inserted=56`、`detail_fetched=56`、`file_urls_resolved=56`
- `351119` 已被显式排除；当前不存在 admitted owner-recovery target
- 这条 phase 的 closeout 不再继续推进 bounded owner recovery / promotion/materialization re-entry

## Guardrails

- 不扩成 source-wide replay
- 不在这条线里改 collector foundation
- 不推进 release / alias publish

## Entry

- `docs/plans/archive/completed/authenticated-notice-file-release-owner-recovery.md`
