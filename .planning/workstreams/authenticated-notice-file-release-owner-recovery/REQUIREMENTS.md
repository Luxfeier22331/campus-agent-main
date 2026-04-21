---
doc_type: requirements
status: completed
created: 2026-04-19
updated: 2026-04-21
---

# Requirements: Authenticated Notice File Release Owner Recovery

## Goal

将这条 auth-dependent `file_release owner recovery` workstream 作为 readiness/foundation closeout 收口：
冻结 export contract、readiness taxonomy 与 auth-window runbook，完成当前 auth window 的 `notice` / `file_release` inventory materialization，并把 `351119` exclusion 与 future reopen rule 固定为 planning truth。

## In Scope

- `file_release` export contract、readiness taxonomy 与 auth-window runbook freeze
- 当前 auth window 的 `notice` inventory materialization
- 当前 auth window 的 `file_release` inventory materialization
- `351119` exclusion truth freeze
- planning closeout 与 reopen rule 收口

## Non-goals

- 在这条 workstream 里 admission 新的 owner-recovery target
- bounded owner body recovery / promotion / materialization re-entry 的重新执行
- full replay、collector foundation 重写或新的 source-wide hardening
- bucket versioning / retention hardening、release / alias publish

## Success Criteria

1. latest `notice` export manifest 已确认 `items_inserted=60`、`detail_fetched=60`，且附件继续按 `object_store_write` 落盘。
2. latest `file_release` export manifest 已确认 `items_inserted=56`、`detail_fetched=56`、`file_urls_resolved=56`，且原件继续按 `object_store_write` 落盘。
3. `351119` exclusion 在 planning/reference truth 中显式成立，不再继续伪装成待执行 owner-recovery frontier。
4. 未来 target-specific owner recovery 必须通过新的 non-excluded target 显式 reopen，而不是继续挂成一个假 `Deferred` workstream。

## Canonical Entry

- `docs/plans/archive/completed/authenticated-notice-file-release-owner-recovery.md`
