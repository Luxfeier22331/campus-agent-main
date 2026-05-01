---
doc_type: phase_summary
status: complete
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 2 Summary: App-API Job Control Plane

## Completed

- Added app-api owned/runtime schema tables for `official_web.target_jobs`,
  `official_web.target_job_candidates`, `official_web.target_page_attempts`,
  and `official_web.target_artifact_verification_summaries`.
- Generated migration `apps/app-api/drizzle/0028_goofy_sumo.sql` and matching Drizzle snapshot metadata.
- Added `official-web-target-jobs` service/store module with deterministic declared target job upsert and operator-safe list projection.
- Added `/api/operator/official-web/target-jobs` under the existing operator principal admission path.
- Kept artifact verification summaries projection-only by default via `canonicalVerification: false` unless an object verification id is attached later.

## Verification

```bash
pnpm --dir apps/app-api test -- official-web-target-jobs
pnpm --dir apps/app-api test -- official-web
pnpm --dir apps/app-api test:worker -- official-web
pnpm --dir apps/app-api typecheck
pnpm exec biome check apps/app-api/src/db/schema/official-web.ts apps/app-api/src/db/schema/index.ts apps/app-api/src/db/schema/owned.ts apps/app-api/src/modules/official-web-target-jobs apps/app-api/src/app/routes/official-web.ts apps/app-api/src/app/request-scope.ts apps/app-api/src/app/types.ts apps/app-api/src/app/route-exposure.ts apps/app-api/test/official-web-target-jobs.service.test.ts apps/app-api/test/official-web-target-jobs.route.test.ts
```

## Follow-Up

- Phase 3 must make `/api/official-web/plans:resolve` consume target job admission instead of page freshness as a host-first frontier.
