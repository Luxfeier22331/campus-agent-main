---
workstream: restricted-document-rollout-verification
created: 2026-04-19
updated: 2026-04-27
---

# Project State

## Current Position

**Status:** Deferred
**Current Phase:** A
**Current Phase Name:** Restricted Surface Opening Admission
**Current Plan:** wait until product scope explicitly opens a restricted user-visible surface
**Total Phases:** 5
**Total Plans in Phase:** N/A
**Progress:** 0/5 phases complete
**Last Activity:** 2026-04-27
**Last Activity Description:** Reassessed as a still-valid deferred future rollout guard.
Identity/authz foundation is no longer pending here. Current `internal_notice` remains
`restricted + offline_preparation` with retrieval/query disabled, so this workstream should
only reopen for a real restricted reader/query/download surface opening.

## Reopen Rule

- 只有在产品范围显式决定打开 restricted 用户可见 surface、发布 restricted
  collection/query serving alias，或推进 authenticated document center / restricted
  reader / restricted retrieval 到真实用户路径时才恢复

## Blockers

- 当前没有 active restricted user-visible rollout
- `campus_notices/internal_notice` 仍为离线准备路径，不能反向视为已开放 surface
- 需要产品侧明确 principal / entitlement / surface / release posture 的 reopen 决策
- 恢复时不得重开 `app-api` canonical authz ownership，也不得把 Better Auth 登录态、
  Cloudflare Access 或 prompt-only filtering 当作 restricted data authorization

## Session Continuity

**Stopped At:** deferred pending restricted rollout decision
**Resume File:** `.planning/workstreams/restricted-document-rollout-verification/README.md`
