---
doc_type: phase_plan
phase: "A"
phase_name: "Auth Check And Targeted Export"
status: completed
created: 2026-04-21
updated: 2026-04-21
---

# Phase A Plan

## Objective

把这条 auth-dependent workstream 从错误的“等待默认 target 执行”状态收回到真实 closeout：
利用当前 auth window 已经拿到的 `notice` / `file_release` export evidence，
冻结 readiness contract，显式关闭 `351119`，并把未来 owner-recovery execution 改成 reopen 条件。

## Decisions To Freeze

1. `351119` 继续保持显式 excluded，不再作为默认或备选 recovery target。
2. 本轮 workstream 不伪装成 target-specific owner recovery execution。
3. 当前 auth window 的真实产出是 readiness/foundation closeout，而不是 downstream promotion/materialization re-entry。
4. 未来若需要 bounded owner recovery，必须由新的 non-excluded target 显式 reopen。

## Execution Slices

### Slice 1: Freeze The Real Auth-Window Evidence

- 固定 latest `notice` export manifest：
  - `apps/authenticated-notice-collector/runtime/exports/export-manifest-20260421T091110.404Z.json`
- 固定 latest `file_release` export manifest：
  - `apps/authenticated-notice-collector/runtime/exports/file-releases-manifest-20260421T091153.551Z.json`

### Slice 2: Rewrite Planning Truth

- 更新 workstream：
  - `STATE.md`
  - `ROADMAP.md`
  - `REQUIREMENTS.md`
- 更新 phase:
  - `CONTEXT.md`
  - `PLAN.md`
  - `SUMMARY.md`
- 更新 repo registry 与 project truth：
  - `.planning/WORKSTREAMS.md`
  - `.planning/PROJECT.md`

### Slice 3: Archive The Root Entry

- 新增 completed archive entry：
  - `docs/plans/archive/completed/authenticated-notice-file-release-owner-recovery.md`
- 删除旧 root entry，并把相关索引全部改指向 completed archive
- 更新索引与域/参考文档指针

## Proposed Write Set

- `.planning/workstreams/authenticated-notice-file-release-owner-recovery/STATE.md`
- `.planning/workstreams/authenticated-notice-file-release-owner-recovery/ROADMAP.md`
- `.planning/workstreams/authenticated-notice-file-release-owner-recovery/REQUIREMENTS.md`
- `.planning/workstreams/authenticated-notice-file-release-owner-recovery/phases/phase-a-auth-check-and-targeted-export/CONTEXT.md`
- `.planning/workstreams/authenticated-notice-file-release-owner-recovery/phases/phase-a-auth-check-and-targeted-export/PLAN.md`
- `.planning/workstreams/authenticated-notice-file-release-owner-recovery/phases/phase-a-auth-check-and-targeted-export/SUMMARY.md`
- `.planning/WORKSTREAMS.md`
- `.planning/PROJECT.md`
- `docs/plans/README.md`
- `docs/plans/archive/completed/README.md`
- `docs/plans/archive/completed/authenticated-notice-file-release-owner-recovery.md`
- `docs/domains/authenticated-notice.md`
- `docs/reference/institutional-regulations-offline-inventory.md`
- `docs/reference/internal-notice-manual-review-collection-strategy.md`

## Verification Loop

- `gsd-sdk query workstream.status authenticated-notice-file-release-owner-recovery --raw --cwd /home/reptilian/code/campus-agent`
- `rg -n "archive/completed/authenticated-notice-file-release-owner-recovery.md" .planning docs`

## Exit Rule

Phase A 完成后，应满足：

- workstream registry 显示 `Completed`
- native phase 显示 `complete`
- root deferred entry 已移入 completed archive
- 当前 truth 只保留 readiness closeout，不再保留伪 deferred target execution
