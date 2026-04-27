---
doc_type: summary
status: local-verification-passed
created: 2026-04-27
updated: 2026-04-27
---

# Phase 6 Summary: Restricted / Historical Reader Handoff And Acceptance

## Completed Locally

- `app-api` now resolves restricted reader descriptors for principals whose entitlement groups satisfy the document version.
- `app-api` now exposes a gated reader asset endpoint with per-request authz and server-only object-key lookup.
- `public-docs` now returns a generic reader fallback shell when canonical docs routes miss static assets.
- `public-docs` static asset config now uses `404-page` fallback so Worker code can detect missing static reader pages before serving the gated reader shell.
- Contracts and architecture docs now describe the gated reader asset endpoint and no-store delivery posture.

## Verification

- `pnpm --filter app-api exec vitest run -c vitest.node.config.mts test/docs.service.test.ts test/docs.route.test.ts test/route-exposure-inventory.test.ts`
- `pnpm --filter public-docs exec vitest run test/worker.test.ts test/sync-published-reader-docs.test.ts test/sync-published-reader-assets.test.ts`
- `pnpm --filter app-api typecheck`
- `pnpm --filter public-docs typecheck`
- `pnpm --filter public-docs lint:generated`
- `pnpm --filter public-docs build`

## Remaining Infrastructure Gap

Cloudflare staging now has `campus-agent-reader-assets-staging` bound as `DOCS_READER_ASSETS`. Real staging acceptance for restricted byte delivery is still blocked until gated reader asset objects are synced into that bucket.
