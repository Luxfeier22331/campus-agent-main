---
doc_type: requirements
status: active
created: 2026-04-19
updated: 2026-04-19
---

# Requirements: Authenticated Notice File Release Owner Recovery

## Goal

在 auth window 内完成 `351119` 为首的 bounded `file_release` capture 与 owner body recovery，并把 recovered owner body 回接到既有 promotion / materialization 路径。

## In Scope

- `auth:check`
- 精确 `file_release_id` 的 targeted export
- bounded owner recovery consumer
- recovered owner body 的 promotion / materialization re-entry
- 目标 regulation 的 bounded rerun 与 target-side validation

## Non-goals

- full export
- source-wide replay
- 新的 collector foundation 改造
- OCR provider、chunk policy 泛化或 release / alias publish

## Success Criteria

1. `351119` 的 bundle / manifest / source locator 成功落盘。
2. bounded consumer 能把目标 `file_release` 还原为可消费的 owner body source。
3. recovered owner body 成功回接到 downstream promotion / materialization，而不是只停在 readiness。
4. 目标 regulation 的 rerun 与 target-side validation 能作为 bounded lane 独立完成。

## Canonical Entry

- `docs/plans/authenticated-notice-file-release-owner-recovery.md`
