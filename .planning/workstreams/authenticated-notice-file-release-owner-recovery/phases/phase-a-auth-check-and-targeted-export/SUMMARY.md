---
phase: "A"
name: "Auth Check And Targeted Export"
created: 2026-04-21
updated: 2026-04-21
status: completed
---

# Phase A Summary

## What Closed

- 用真实 auth window 完成了当前 `notice` 与 `file_release` inventory materialization，而不是继续停留在“等待第一个 target”的 planning 假设。
- 明确冻结了这条线真正已经成立的 readiness truth：export contract、readiness taxonomy 与 auth-window operator runbook。
- 把 `351119` 固定为显式 excluded 样本，关闭了“仍有一个默认 owner-recovery target 待执行”的错误信号。

## Fresh Evidence

- `apps/authenticated-notice-collector/runtime/exports/export-manifest-20260421T091110.404Z.json`
  - `items_inserted=60`
  - `detail_fetched=60`
  - `attachment_storage_mode=object_store_write`
- `apps/authenticated-notice-collector/runtime/exports/file-releases-manifest-20260421T091153.551Z.json`
  - `items_inserted=56`
  - `detail_fetched=56`
  - `file_urls_resolved=56`
  - `file_storage_mode=object_store_write`

## Planning Outcome

- `authenticated-notice file_release owner recovery` 不再保持假 `Deferred`。
- workstream 当前已按 readiness/foundation closeout 完成。
- 未来若要继续做 bounded owner recovery，必须以新的显式 non-excluded target 重新 reopen。
