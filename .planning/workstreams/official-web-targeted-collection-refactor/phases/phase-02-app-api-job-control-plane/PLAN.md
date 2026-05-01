---
doc_type: plan
status: active
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 2 Plan: App-API Job Control Plane

## Goal

Move target job truth into `app-api`, while keeping the existing crawl run lifecycle backward compatible.

## Deliverables

- Drizzle schema for target jobs, candidate URLs, page attempts, and projection-only artifact verification summaries.
- Service/store contracts for target job query and deterministic job creation from target declarations.
- Operator-safe query projection for target job state.
- Control-plane compatibility mapping from existing crawl run lifecycle to target job lineage.
- Explicit documentation that artifact verification summaries are projection-only unless backed by shared source-handoff `ObjectVerification`.

## Implementation Tasks

1. Add app-api schema tables under `official_web`:
   `target_jobs`、`target_job_candidates`、`target_page_attempts`、`target_artifact_verification_summaries`.
2. Add app-api service/store module for target job projection, keeping verification summary projection-only.
3. Add operator route for listing target jobs through existing operator auth, without object-store access.
4. Add tests for schema shape, service idempotency/read projection, operator route access, and worker route inventory.
5. Keep `/api/official-web/runs` and `/api/official-web/plans:resolve` backward compatible for Phase 3.

## Non-Goals

- No collector workset execution change yet.
- No ingestion selected-write or release implementation.
- No panel UI change.
- No duplicate canonical object verification ledger.

## Acceptance

- Each target job projection carries idempotency key, declaration version, consumer family, selected-write target, and target policy fields.
- Candidate URL rows carry target lineage and pre-fetch eligibility reason.
- Operator query can list target jobs without object-store access.
- Artifact verification summaries explicitly mark `canonicalVerification: false` unless a shared object verification id is present.
- Existing official-web run lifecycle tests remain green.

## Verification

```bash
pnpm --dir apps/app-api test -- official-web
pnpm --dir apps/app-api test:worker -- official-web
pnpm --dir apps/app-api typecheck
pnpm exec biome check apps/app-api/src/db/schema/official-web.ts apps/app-api/src/modules/official-web-target-jobs apps/app-api/src/app/routes/official-web.ts apps/app-api/src/app/request-scope.ts apps/app-api/src/app/types.ts apps/app-api/test/official-web-target-jobs.service.test.ts apps/app-api/test/official-web-target-jobs.route.test.ts
```
