---
doc_type: summary
status: accepted
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

## Completed In This Execution

- Injected one real restricted current doc in registry and replayed publisher:
  - `doc_id=curriculum:中央民族大学大学生社会实践环节实施方案`
  - publish result: `document_count=116`, `public_entry_count=115`, `gated_entry_count=1`
- Replayed full local chain:
  - `app-api`: `db:migrate` + `docs:import-read-model` + `docs:export-public-sync-manifest`
  - `public-docs`: `build:published-reader-assets` / `sync:published-reader-assets`
  - copied result: `copiedAssetCount=464`, `copiedGatedDocumentCount=1`
- Replayed full staging chain and deployed:
  - `app-api`: `db:migrate:staging` + `docs:import-read-model:staging` + `docs:export-public-sync-manifest:staging`
  - `public-docs`: `deploy:staging`
  - deployed version: `7a8abe84-dc49-4586-9648-49ad497ceb56`
- Verified staging unauthenticated gated path is fail-closed:
  - `/_gated-docs/.../reader.json` returns `404`
  - response headers include `Cache-Control: no-store` and `Vary: Cookie, Authorization`
- Added repo-owned staging gated docs automation:
  - `app-api` staging smoke session endpoint can reset the smoke identity behind
    `APP_API_STAGING_SMOKE_AUTH_SECRET`, so smoke no longer requires browser login
    or local staging DB credentials.
  - ordinary Better Auth campus member sessions now carry the default
    `campus_members` entitlement needed by `campus_members` gated docs.
  - `docs:gated:smoke:staging` verifies unauthenticated `404` and authorized
    `200` on the real staging `/_gated-docs/.../reader.json` path.
- Rotated `APP_API_STAGING_SMOKE_AUTH_SECRET`, stored the current local operator copy
  in ignored `.env.staging.local`, and redeployed `app-api-staging`.
  - deployed version: `7bb6d1a4-9137-4f66-9b0d-3c35876f4bed`
- Verified staging authorized gated path succeeds:
  - `/_gated-docs/.../reader.json` returns `200`
  - response headers include `Cache-Control: no-store` and `Vary: Cookie, Authorization`

## Verification

- `uv run --all-packages python -m campus_ingestion_worker.publish_document_reader_assets --manifest-path var/docs-read-model-manifest.json --manifest-object-key manifests/public-docs-reader-assets.json`
- `pnpm --filter app-api db:migrate`
- `pnpm --filter app-api docs:import-read-model ../../var/docs-read-model-manifest.json`
- `pnpm --filter app-api docs:export-public-sync-manifest ../../var/public-docs-sync-manifest.json`
- `PUBLIC_DOCS_SYNC_MANIFEST_PATH=/home/reptilian/code/campus-agent/var/public-docs-sync-manifest.json pnpm --filter public-docs build:published-reader-assets`
- `pnpm --filter app-api db:migrate:staging`
- `pnpm --filter app-api docs:import-read-model:staging ../../var/docs-read-model-manifest.json`
- `pnpm --filter app-api docs:export-public-sync-manifest:staging ../../var/public-docs-sync-manifest.staging.json`
- `PUBLIC_DOCS_SYNC_MANIFEST_PATH=/home/reptilian/code/campus-agent/var/public-docs-sync-manifest.staging.json pnpm --filter public-docs deploy:staging`
- `curl -i -sS "https://campus-docs-staging.ayafeed.com/_gated-docs/curriculum/curriculum_plan/中央民族大学大学生社会实践环节实施方案/2022-current/reader.json" | sed -n '1,40p'`
- `pnpm --filter app-api exec vitest run -c vitest.node.config.mts test/docs.service.test.ts test/docs.route.test.ts test/route-exposure-inventory.test.ts`
- `pnpm --filter public-docs exec vitest run test/worker.test.ts test/sync-published-reader-docs.test.ts test/sync-published-reader-assets.test.ts`
- `pnpm --filter app-api typecheck`
- `pnpm --filter public-docs typecheck`
- `pnpm --filter public-docs lint:generated`
- `pnpm --filter public-docs build`
- `pnpm --dir apps/app-api exec vitest run -c vitest.node.config.mts test/principal-resolution.test.ts test/docs.service.test.ts test/staging-smoke-auth.route.test.ts test/staging-docs-gated-smoke.args.test.ts test/staging-chat-smoke.args.test.ts`
- `pnpm --dir apps/app-api typecheck`
- `pnpm --dir apps/app-api docs:gated:smoke:staging`

## Remaining Gap

None for Phase 6 acceptance. Cloudflare staging has live gated bytes,
fail-closed unauthenticated behavior, and authorized `campus_members` gated
reader delivery verified by repo-owned automation.
