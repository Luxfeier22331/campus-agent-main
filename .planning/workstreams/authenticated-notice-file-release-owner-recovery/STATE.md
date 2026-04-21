---
workstream: authenticated-notice-file-release-owner-recovery
created: 2026-04-19
updated: 2026-04-21
---

# Project State

## Current Position

**Status:** Completed
**Current Phase:** None
**Current Phase Name:** None
**Current Plan:** `<none>`
**Total Phases:** 1
**Total Plans in Phase:** 0
**Progress:** 1/1 phases complete
**Last Activity:** 2026-04-21
**Last Activity Description:** Revalidated the auth window with a fresh `auth:check`, reran both live exports at `2026-04-21T12:12Z`, and confirmed the current `notice` / `file_release` inventories are unchanged from the earlier closeout evidence while object-store writes still succeed.

## Current Slice

- latest `notice` export 已落盘：
  - `apps/authenticated-notice-collector/runtime/exports/export-manifest-20260421T121246.588Z.json`
  - `items_inserted=60`
  - `detail_fetched=60`
- latest `file_release` export 已落盘：
  - `apps/authenticated-notice-collector/runtime/exports/file-releases-manifest-20260421T121246.594Z.json`
  - `items_inserted=56`
  - `detail_fetched=56`
  - `file_urls_resolved=56`
- `2026-04-21T12:12Z` re-export 与 `2026-04-21T09:11Z` closeout evidence 的 ID 集完全一致：
  - `notice`: `60 -> 60`, `added=0`, `removed=0`
  - `file_release`: `56 -> 56`, `added=0`, `removed=0`
- `351119` 已被显式排除；当前不存在 admitted owner-recovery target
- 未来若要继续做 bounded owner recovery，必须以新的 non-excluded target 显式 reopen，而不是沿用本次 auth window 的 closeout 状态

## Blockers

- 无 active blocker。workstream 已完成 closeout。
- 如果未来需要重开，前置条件仍然是：
  - 新的显式 non-excluded target
  - 可用认证窗口与登录态
  - 产品范围重新恢复 bounded owner recovery 优先级

## Verification

- `pnpm --dir apps/authenticated-notice-collector auth:check`
  - `notice.sampleCount=3`
  - `fileRelease.sampleCount=3`
- `apps/authenticated-notice-collector/runtime/exports/export-manifest-20260421T121246.588Z.json`
  - `attachment_storage_mode=object_store_write`
  - `items_inserted=60`
  - `detail_fetched=60`
- `apps/authenticated-notice-collector/runtime/exports/file-releases-manifest-20260421T121246.594Z.json`
  - `file_storage_mode=object_store_write`
  - `items_inserted=56`
  - `detail_fetched=56`
  - `file_urls_resolved=56`
- latest bundle parity
  - `notices-bundle-20260421T091110.404Z.json` vs `notices-bundle-20260421T121246.588Z.json`: identical notice-id set
  - `file-releases-bundle-20260421T091153.551Z.json` vs `file-releases-bundle-20260421T121246.594Z.json`: identical file-release-id set
- latest object materialization
  - notice attachments: `46` rows, all `storage_provider=object_store`, all `ingest_status=uploaded`
  - file releases: `56` rows, all `storage_provider=object_store`, all `ingest_status=uploaded`
- `docs/reference/authenticated-notice-file-release-export-contract.md`
- `docs/reference/authenticated-notice-file-release-owner-recovery-readiness-contract.md`
- `docs/runbooks/authenticated-notice-file-release-auth-window-runbook.md`

## Session Continuity

**Stopped At:** workstream closed as readiness/foundation closeout; future target-specific owner recovery now requires explicit reopen
**Resume File:** `<none>`
