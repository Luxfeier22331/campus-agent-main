---
doc_type: summary
status: completed
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 1 Summary: Target Contract

## Completed

- Promoted `target-source-map.json` to v2-compatible target-first semantics.
- Added canonical target declaration fields:
  `url_hints`、`title_hints`、`retention_policy`、`review_policy`、
  `materialization_policy`、`inventory_only`.
- Loaded repo-tracked snake_case config into camelCase runtime model:
  `urlHints`、`titleHints`、`retentionPolicy`、`reviewPolicy`、
  `materializationPolicy`、`inventoryOnly`.
- Preserved lossless v1 compatibility for old `url_patterns` / `title_keywords` inputs.
- Added validation for owner-surface drift, selected-write drift, unavailable source hosts, and inventory-only target selected-write leakage.
- Updated official-web architecture and source-truth schema docs to distinguish source capability registry from target declaration truth.

## Verification

```bash
pnpm --dir packages/official-web-core test
pnpm --dir packages/official-web-core typecheck
pnpm --dir apps/official-web-collector test
pnpm --dir apps/official-web-collector typecheck
pnpm docs:lint
pnpm exec biome check apps/official-web-collector/src/crawl.ts apps/official-web-collector/src/crawl-cli.ts apps/official-web-collector/test/crawl-core.suite.ts apps/official-web-collector/test/crawl-cli.suite.ts apps/official-web-collector/test/test-support.ts packages/official-web-core/src/config-models.ts packages/official-web-core/src/config-parsing.ts packages/official-web-core/src/config-loading.ts packages/official-web-core/src/config-validation.ts packages/official-web-core/src/config.ts packages/official-web-core/src/index.ts packages/official-web-core/test/config.test.ts packages/official-web-core/test/policy.test.ts
```

All commands passed on 2026-05-01.

`pnpm web:lint` still fails on an unrelated pre-existing protected-panel file:
`apps/protected-panel-web/src/panel/authenticated-notices/processing-show.tsx`.

## Follow-Up

Phase 2 can now implement app-api target job/control-plane state without changing the target declaration contract.
