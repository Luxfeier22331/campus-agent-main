---
phase: "3"
name: "Public Docs Shell Convergence And Information Architecture"
created: 2026-04-27
updated: 2026-04-27
status: completed
---

# Phase 3 Summary

## Result

`Phase 3` 已把 `public-docs` 的 published reader source generation、
Rspress sidebar、local scaffold 与 generated content guard 收口到统一
`/docs/:corpus/:collection/:documentSlug` 信息架构。

本 phase 没有引入自建 shell，也没有改写 Phase 2 的 published reader
assets / `app-api` control-plane truth。

## Outputs

- `apps/public-docs/scripts/sync-published-reader-docs.ts`
- `apps/public-docs/scripts/rspress-sidebar.ts`
- `apps/public-docs/scripts/ensure-docs-scaffold.ts`
- `apps/public-docs/scripts/check-generated-docs.ts`
- `apps/public-docs/.gitignore`
- `apps/public-docs/test/sync-published-reader-docs.test.ts`
- `apps/public-docs/test/generated-docs-checker.test.ts`
- `apps/public-docs/test/public-docs-scaffold.test.ts`

## Contract Decisions Landed

- published reader docs 的长期 Rspress source route 固定为
  `/docs/:corpus/:collection/:documentSlug`。
- root `/` 是文档站首页，`/docs/` 是公开文档总览。
- corpus landing 与 collection landing 是 IA 节点，不再把 `student-handbook`
  / `curriculum-plan` 作为顶层默认结构。
- `public-docs` 继续使用 Rspress 原生 layout/topnav/sidebar/outline。
- browser-facing generated markdown 不暴露 object storage key、raw source
  locator 或 chunk id。
- `apps/public-docs/docs/docs/**` 属于 generated deploy/docs-sync 产物，不得
  tracked。

## Verification

- `pnpm --filter public-docs test`
- `pnpm --filter public-docs exec vitest run test/sync-published-reader-docs.test.ts test/generated-docs-checker.test.ts test/public-docs-scaffold.test.ts`
- `pnpm --filter public-docs exec vitest run test/sync-real-docs-reader-ui.test.ts`
- `pnpm exec biome check apps/public-docs/scripts/rspress-sidebar.ts apps/public-docs/scripts/sync-published-reader-docs.ts apps/public-docs/scripts/check-generated-docs.ts apps/public-docs/scripts/ensure-docs-scaffold.ts apps/public-docs/test/sync-published-reader-docs.test.ts apps/public-docs/test/generated-docs-checker.test.ts apps/public-docs/test/public-docs-scaffold.test.ts`
- `pnpm --filter public-docs typecheck`
- `pnpm --filter public-docs lint:generated`
- `pnpm --filter public-docs build`
- `pnpm docs:lint`
- `pnpm yaml:lint`
- `git diff --check`

## Remaining Follow-Up

- `Phase 4` 继续处理 docs search UX、version switching、anchor/highlight
  deep-link state 与 reader-side static state continuity。
- staging 仍需在真实 publish/import/export/build 链路后做 live acceptance。
