---
doc_type: phase_summary
status: completed
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 7 Summary: Operator Panel Projection

## Completed

- Added app-api operator target-job detail projection at `GET /api/operator/official-web/target-jobs/:jobId`.
- Target-job detail now exposes job declaration, candidate URLs, page attempts, and artifact verification summaries in an operator-safe shape.
- Page attempts expose `artifactCaptured` instead of `artifactObjectKey`, so panel does not receive object-store keys as navigation or action truth.
- Target-job list projection now includes `attemptCount` and uses latest verification summary without duplicating jobs across multiple summary rows.
- Protected panel now has read-only `officialWebTargetJobs` list/detail resources backed only by protected Worker BFF -> app-api operator routes.
- Protected Worker BFF now proxies `/api/official-web/target-jobs` and `/api/official-web/target-jobs/:jobId` to app-api with the existing trusted operator bridge.
- Protected panel typecheck now allows source package `.ts` exports consistently with the other Worker apps that consume `official-web-core`.

## Verification

```bash
pnpm --dir apps/app-api test -- official-web-target-jobs
pnpm --dir apps/protected-panel-web test:node -- data-provider.official-web worker.operator-domains
pnpm --dir apps/app-api typecheck
pnpm --dir apps/protected-panel-web typecheck
pnpm --dir apps/app-api test:worker -- official-web
pnpm --dir apps/protected-panel-web test:worker -- worker.operator-domains
```

## Follow-Up

- Phase 8 should run a no-promotion live seam and prove the target job shown in panel matches collector workset lineage, app-api run ledger, handoff dispatch, and ingestion staging output.
