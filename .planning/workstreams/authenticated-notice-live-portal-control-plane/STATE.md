---
workstream: authenticated-notice-live-portal-control-plane
created: 2026-04-19
updated: 2026-04-23
---

# Project State

## Current Position

**Status:** Deferred
**Current Phase:** A
**Current Phase Name:** Collector Runtime / Repo Migration Truth Refresh
**Current Plan:** wait for auth-window reopening or explicit product reprioritization
**Total Phases:** 6
**Total Plans in Phase:** N/A
**Progress:** 0/6 phases complete
**Last Activity:** 2026-04-23
**Last Activity Description:** Added a future follow-up for notices whose body declares attachments but current detail/source-truth payloads materialize no attachment entities or refs.

## Reopen Rule

- 只有在认证窗口恢复，或产品范围决定恢复 source-channel live portal scheduling / authenticated control-plane 时才恢复

## Blockers

- 缺少当前可用的认证窗口与登录凭据
- collector runtime / control-plane 还未被拉回 active implementation lane
- 已知 source-channel gap 尚未进入 active implementation：部分 notice 正文会声明附件，但当前 payload / source-truth 可能返回空 `notice_attachments`、空 `attachments` 与 `attachment_ref_count=0`；reopen 后必须把这类 mismatch 做成 machine-readable truth

## Session Continuity

**Stopped At:** deferred pending auth-window recovery
**Resume File:** `.planning/workstreams/authenticated-notice-live-portal-control-plane/README.md`
