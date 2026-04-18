# 12-04 Summary

## Outcome

- Phase 12 is now closed in the current worktree.
- The repo now has a consistent authenticated-notice foundation story across planning, runbook, collector runtime shell, importer verification, and bounded historical replay evidence.
- Phase closeout stays narrow: `campus_notices/internal_notice` remains `restricted + offline_preparation`, and this phase does not claim live portal scheduling, authenticated control-plane ownership, or query-serving promotion.

## Verified Phase 12 Truth

- `authenticated_notice_portal` remains a dedicated source channel rather than an `official_web` subtype.
- `apps/authenticated-notice-collector` remains a runtime shell only:
  - auth bootstrap
  - list/detail fetch
  - typed bootstrap export
  - reference-only link / attachment observations
- `packages/ingestion-core` plus `apps/ingestion-worker` remain the owners of:
  - bootstrap import
  - source-truth reconstruction
  - object-store writes
  - document registry projection
- bounded historical replay is now proven with real summary evidence for:
  - `2` notices: `.tmp/authenticated-notice-smoke/20260404T131900-2-timed/summary.json`
  - `10` notices: `.tmp/authenticated-notice-smoke/20260404T131350-10/summary.json`
  - `50` notices: `.tmp/authenticated-notice-smoke/20260404T131544-50/summary.json`
  - `240` notices: `.tmp/authenticated-notice-smoke/20260404T152745-240/summary.json`

## Deferred After Phase 12

- full `6694` replay or larger backfill execution
- renewed live portal access, scheduled runs, or incremental sync control
- authenticated notice control-plane/read-model ownership on `app-api`
- query-serving promotion for `campus_notices/internal_notice`
- attachment downloading or object upload ownership inside the collector shell

## Verification

- `pnpm --dir apps/authenticated-notice-collector test`
- `pnpm --dir apps/authenticated-notice-collector typecheck`
- `pnpm --dir apps/authenticated-notice-collector build`
- `uv run --package campus-ingestion-worker python -m unittest tests.ingestion.test_authenticated_notice_import tests.ingestion.test_import_authenticated_notice_export_worker tests.ingestion.test_smoke_authenticated_notice_bootstrap_worker`
- `uv run --package campus-ingestion-worker python -m campus_ingestion_worker.smoke_authenticated_notice_bootstrap --bundle-path .tmp/authenticated-notice-smoke/20260404T152745-240/notices-bundle-slice-240.json --manifest-path /home/reptilian/code/rag-data/muc-notice-collector/runtime/exports/export-manifest-20260403-run-2.json --site-id muc_internal_portal --source-home-url https://my.muc.edu.cn --expect-notice-count 240 --summary-output-path .tmp/authenticated-notice-smoke/20260404T152745-240/summary.json`
