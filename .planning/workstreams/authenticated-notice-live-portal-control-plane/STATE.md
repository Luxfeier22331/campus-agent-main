---
workstream: authenticated-notice-live-portal-control-plane
created: 2026-04-19
updated: 2026-04-25
---

# Project State

## Current Position

**Status:** Active-blocked
**Current Phase:** A
**Current Phase Name:** Collector Runtime / Repo Migration Truth Refresh
**Current Plan:** restore collector auth bootstrap/readiness, then proceed to live portal runtime truth refresh once a fresh valid `SSO_TGC` is available
**Total Phases:** 6
**Total Plans in Phase:** N/A
**Progress:** 0/6 phases complete
**Last Activity:** 2026-04-25
**Last Activity Description:** Restored repo-owned `SSO_TGC` token seeding for collector `storageState.json` and added safe error redaction for authenticated collector CLIs. Real `auth:check` now reaches portal API without cookie-header construction failure, but the current candidate login material returns `auth-expired: session invalid`.

## Reopen Rule

- 只有在认证窗口恢复，或产品范围决定恢复 source-channel live portal scheduling / authenticated control-plane 时才恢复

## Blockers

- 当前候选 `SSO_TGC` 不是可用会话：`pnpm --dir apps/authenticated-notice-collector auth:check` 返回 `auth-expired: session invalid`
- 需要重新复制当前有效的 `SSO_TGC@.muc.edu.cn` 到本地 `.env` 的 `AUTHENTICATED_NOTICE_SSO_TGC`
- collector runtime / control-plane 还未被拉回 active implementation lane
- 已知 source-channel gap 尚未进入 active implementation：部分 notice 正文会声明附件，但当前 payload / source-truth 可能返回空 `notice_attachments`、空 `attachments` 与 `attachment_ref_count=0`；reopen 后必须把这类 mismatch 做成 machine-readable truth

## Session Continuity

**Stopped At:** active-blocked pending fresh valid `SSO_TGC`
**Resume File:** `.planning/workstreams/authenticated-notice-live-portal-control-plane/README.md`
