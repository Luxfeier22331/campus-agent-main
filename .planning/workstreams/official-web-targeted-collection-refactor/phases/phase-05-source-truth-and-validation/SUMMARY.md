---
doc_type: phase_summary
status: complete
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 5 Summary: Source-Truth And Validation

## Completed

- Added camelCase target lineage fields to official-web page manifests and source-truth bundle pages.
- Added source-truth bundle target summary counters by target job, consumer family, retention decision and materialization policy.
- Added quality audit target-family and retention-decision counters.
- Propagated target workset lineage from collector request user data into fetched page artifacts.
- Made validator reject target-workset retained pages without lineage and reject snake_case target lineage keys.

## Verification

```bash
pnpm --dir packages/official-web-core test
pnpm --dir packages/official-web-core typecheck
pnpm --dir apps/official-web-collector test
pnpm --dir apps/official-web-collector typecheck
pnpm exec biome check packages/official-web-core/src/source-truth.ts packages/official-web-core/src/artifacts.ts packages/official-web-core/src/index.ts apps/official-web-collector/src/page-artifacts.ts apps/official-web-collector/src/crawl-single-host.ts apps/official-web-collector/src/crawl-artifacts.ts apps/official-web-collector/src/crawl.ts apps/official-web-collector/src/quality-audit.ts apps/official-web-collector/src/validate.ts apps/official-web-collector/src/validate-page-artifacts.ts apps/official-web-collector/src/validate-shared.ts apps/official-web-collector/src/qc-report.ts apps/official-web-collector/src/qc-report-types.ts apps/official-web-collector/test/crawl-workset-executor.test.ts apps/official-web-collector/test/validate.test.ts
```

## Follow-Up

- Phase 6 must consume target lineage in ingestion and fail promotion for inventory-only or missing-lineage rows.
