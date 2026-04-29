---
phase: "2"
name: "Published Reader Assets And App API Docs Control Plane"
created: 2026-04-27
updated: 2026-04-27
status: completed
---

# Phase 2 Summary

## Result

`Phase 2` 已把 canonical document reader 的 publish/read-model/deploy seam
收口成可执行链路：

`canonical artifacts -> reader-assets/* -> docs read-model manifest -> app-api docs.* -> public-docs sync manifest -> Rspress source + /_docs static assets`

本 phase 不改变 Rspress 原生 shell，也不把 `public-docs` 做成对象存储扫描器。

## Outputs

- `packages/ingestion-core/src/campus_ingestion_core/document_reader_publisher.py`
- `apps/ingestion-worker/src/campus_ingestion_worker/publish_document_reader_assets.py`
- `apps/app-api/src/modules/docs/read-model-manifest.ts`
- `apps/app-api/scripts/import-docs-read-model.ts`
- `apps/app-api/scripts/export-public-docs-sync-manifest.ts`
- `apps/public-docs/scripts/sync-published-reader-docs.ts`
- `apps/public-docs/scripts/sync-published-reader-assets.ts`
- `docs/runbooks/document-reader-publish-and-docs-deploy-runbook.md`

## Contract Decisions Landed

- data plane / `ingestion-core` 是 reader asset publisher owner。
- `app-api` docs read model 是 public subset、delivery mode、version、resolve/search
  control-plane owner。
- `public-docs` 默认 deploy path 改为 published reader assets，不再默认走
  `sync-real-docs`。
- public docs sync manifest 必须携带 `corpus`、`collection`、`documentSlug`、
  `versionSlug` 与 `title`，用于 build-time page generation。
- `public_static_asset` 与 `gated_asset` 在 manifest/read model 里显式分化；
  `gated_asset` 不进入匿名 `/_docs` static bundle。
- browser-facing docs response 与 public-docs source sync 不暴露 object storage key、
  raw source locator 或 `chunkId`。

## Verification

- `uv run --all-packages python -m unittest tests.ingestion.test_document_reader_publisher tests.ingestion.test_document_reader_assets`
- `pnpm --filter app-api exec vitest run -c vitest.node.config.mts test/docs.import-read-model-plan.test.ts test/docs.read-model-manifest.test.ts`
- `pnpm --filter app-api exec vitest run -c vitest.node.config.mts test/docs.read-model-manifest.test.ts test/docs.request-scope.test.ts test/docs.route.test.ts test/docs.service.test.ts`
- `pnpm --filter public-docs exec vitest run test/sync-published-reader-docs.test.ts`
- `pnpm --filter public-docs exec vitest run test/sync-published-reader-docs.test.ts test/sync-published-reader-assets.test.ts test/worker.test.ts`
- `pnpm --filter app-api typecheck`
- `pnpm --filter public-docs typecheck`
- `uv run --all-packages ruff check packages/ingestion-core/src/campus_ingestion_core/document_reader_publisher.py apps/ingestion-worker/src/campus_ingestion_worker/publish_document_reader_assets.py tests/ingestion/test_document_reader_publisher.py`
- `uv run --all-packages ruff format packages/ingestion-core/src/campus_ingestion_core/document_reader_publisher.py apps/ingestion-worker/src/campus_ingestion_worker/publish_document_reader_assets.py tests/ingestion/test_document_reader_publisher.py --check`
- `pnpm exec biome check apps/app-api/src/modules/docs/read-model-manifest.ts apps/app-api/scripts/import-docs-read-model.ts apps/app-api/scripts/export-public-docs-sync-manifest.ts apps/app-api/test/docs.import-read-model-plan.test.ts apps/app-api/test/docs.read-model-manifest.test.ts apps/public-docs/scripts/sync-published-reader-docs.ts apps/public-docs/test/sync-published-reader-docs.test.ts`

## Remaining Follow-Up

- 跑一次真实对象存储 / staging Postgres 的 live publish-import-export-build。
- `Phase 3` 继续处理 docs shell IA 与 reader navigation polish。
- `Phase 4` 继续处理 docs search UX、version switching 与 deep-link state。
