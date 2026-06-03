---
phase: "4"
name: "Docs Search, Version Navigation, And Static Reader State"
created: 2026-04-27
updated: 2026-04-27
status: completed
---

# Phase 4 Summary

## Result

`Phase 4` 已完成 docs search enhancement、current/historical static reader
version routes、reader anchor/highlight state 与 low-disturbance version switcher。

本 phase 没有替换 Rspress native shell，也没有打开 restricted reader 或 chat
source-card integration。

## Outputs

- `apps/app-api/src/modules/docs/read-model-manifest.ts`
- `apps/app-api/src/modules/docs/service.ts`
- `apps/app-api/test/docs.read-model-manifest.test.ts`
- `apps/app-api/test/docs.service.test.ts`
- `apps/public-docs/scripts/sync-published-reader-docs.ts`
- `apps/public-docs/src/components/ReaderStateEnhancer.tsx`
- `apps/public-docs/src/reader/reader-state-core.ts`
- `apps/public-docs/src/search/docs-api-search-core.ts`
- `apps/public-docs/src/search/docs-search-hook.ts`
- `apps/public-docs/src/search/docs-api-search-core.ts`
- `apps/public-docs/rspress.config.ts`
- `apps/public-docs/theme/docs-ui.css`
- `apps/public-docs/test/sync-published-reader-docs.test.ts`
- `apps/public-docs/test/reader-state-core.test.ts`
- `apps/public-docs/test/docs-api-search-core.test.ts`
- `apps/public-docs/test/generated-docs-checker.test.ts`

## Contract Decisions Landed

- Current reader route remains
  `/docs/:corpus/:collection/:documentSlug`.
- Historical explicit reader route is
  `/docs/:corpus/:collection/:documentSlug/v/:versionSlug`.
- Search and source jump URLs use `?hl=...#anchor`; legacy
  `#anchor?hl=...` remains accepted only as reader-side parsing compatibility.
- `hl` is temporary reader highlight state; it is not permission, version or
  historical query state.
- Public sync manifest includes every public static version, while collection
  navigation and counts continue to treat only current versions as collection docs.
- Browser-facing reader metadata exposes only corpus/collection/document/version route
  state needed for same-site versions API; it does not expose object storage keys,
  raw locators or chunk ids.

## Verification

- `pnpm --filter public-docs exec vitest run test/generated-docs-checker.test.ts`
- `pnpm --filter app-api exec vitest run -c vitest.node.config.mts test/docs.read-model-manifest.test.ts test/docs.service.test.ts`
- `pnpm --filter public-docs test`
- `pnpm --filter public-docs typecheck`
- `pnpm --filter public-docs lint:generated`
- `pnpm exec biome check apps/app-api/src/modules/docs/service.ts apps/public-docs/test/generated-docs-checker.test.ts`
- `pnpm --filter public-docs build`
- `pnpm --filter app-api typecheck`

## Remaining Follow-Up

- `Phase 5` 接入 public chat source cards，把 answer citations 跳转到 canonical
  reader target。
- `Phase 6` 处理 restricted / historical reader handoff 与 gated delivery acceptance。
