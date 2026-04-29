# Quick Task 260412-j1s Summary

**Description:** 冻结 `authenticated_notice` `file_release` 导出契约与认证窗口执行 runbook  
**Mode:** quick-full  
**Status:** completed

## Outcome

- 新增了 repo-tracked `file_release` export contract，明确 bundle / manifest shape、schema version、object key 规则，以及 `reference_only` / `object_store_write` 语义
- 新增了认证窗口 runbook，固定执行顺序为 `auth:save -> auth:check -> bounded smoke -> full export`
- `pnpm auth:check` 现在会同时验证 `notice` 与 `file_release` 两个 authenticated surface，避免 notice 可用但 `file_release` 已失效时误判为可采集

## Files

- `docs/reference/authenticated-notice-file-release-export-contract.md`
- `docs/runbooks/authenticated-notice-file-release-auth-window-runbook.md`
- `docs/runbooks/README.md`
- `docs/architecture/domains/authenticated-notice/architecture.md`
- `docs/data/authenticated-notice-source-truth-schema.md`
- `apps/authenticated-notice-collector/README.md`
- `apps/authenticated-notice-collector/src/auth-check.ts`
- `apps/authenticated-notice-collector/test/auth-check.test.ts`

## Verification

- `rg` contract/runbook anchor checks passed
- `pnpm --dir apps/authenticated-notice-collector test`
- `pnpm --dir apps/authenticated-notice-collector typecheck`

## Scope Guard

本 quick task 明确停在 capture-side readiness：

- 不继续 replay
- 不继续 regulation promotion
- 不继续 OCR / chunk / index / release
