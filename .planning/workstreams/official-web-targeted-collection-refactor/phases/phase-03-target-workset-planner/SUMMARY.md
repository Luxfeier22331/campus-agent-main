---
doc_type: phase_summary
status: complete
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 3 Summary: Target Workset Planner

## Completed

- Extended `/api/official-web/plans:resolve` workset rows with target job id, target candidate id, declaration version, consumer family, selected-write target, retention/review/materialization policy, fetch profile and workset reason.
- Changed app-api planner store to resolve normal worksets from `official_web.target_jobs` plus `official_web.target_job_candidates`.
- Changed repair planning to source rows from `official_web.target_page_attempts` failed attempts, scoped back to the target job.
- Kept `hostFilter` as a narrowing filter only; it does not create workset rows without target job/candidate admission.
- Added service guard that rejects non-canonical consumer family names such as `public_notice_inventory`.
- Updated collector control-plane contract types for target-scoped worksets.

## Verification

```bash
pnpm --dir apps/app-api test -- official-web-planner
pnpm --dir apps/app-api typecheck
pnpm --dir apps/official-web-collector typecheck
pnpm --dir apps/official-web-collector test -- control-plane incremental
pnpm exec biome check apps/app-api/src/modules/official-web-planner apps/app-api/test/official-web-planner.service.test.ts apps/app-api/test/official-web-planner.route.test.ts apps/official-web-collector/src/control-plane-types.ts apps/official-web-collector/src/crawl.ts apps/official-web-collector/src/crawl-host-runner.ts apps/official-web-collector/test/crawl-incremental.test.ts
```

## Follow-Up

- Phase 4 must make collector request building consume `plan.duePages` as the only default execution frontier for app-api admitted runs.
