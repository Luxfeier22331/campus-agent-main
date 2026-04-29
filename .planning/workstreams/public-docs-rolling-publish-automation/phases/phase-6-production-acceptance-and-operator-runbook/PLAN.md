---
doc_type: plan
status: planned
created: 2026-04-29
updated: 2026-04-29
---

# Plan: Phase 6 Production Acceptance And Operator Runbook

## Goal

Close the public docs rolling publish workstream with a repeatable production
acceptance harness, operator runbook coverage and final evidence.

## Requirements

- Cover staging and prod acceptance paths.
- Verify dry-run, unchanged, changed, invalid, blocked, lock-busy, failed,
  rollback and hook-nudge behavior.
- Use injected command runners / fetch and in-memory object store fixtures.
- Generate machine-readable acceptance evidence under the workstream evidence
  directory.
- Add a `public-docs` package script for repeatable operator acceptance.
- Update the runbook to point operators at the acceptance harness.
- Mark the workstream complete only after fresh verification.

## Implementation Tasks

1. Add TDD coverage for the acceptance harness.
   - File:
     `apps/public-docs/test/published-reader-production-acceptance.test.ts`.
   - Assert the matrix contains all required scenario names, all pass and the
     JSON output is written.

2. Add production acceptance evidence generator.
   - File:
     `apps/public-docs/scripts/generate-published-reader-production-acceptance-evidence.ts`.
   - Reuse existing pipeline / rollback / hook APIs.
   - Avoid real Cloudflare and object store side effects.

3. Add package script.
   - `acceptance:published-reader-production`

4. Generate Phase 6 acceptance evidence.
   - Output:
     `.planning/workstreams/public-docs-rolling-publish-automation/evidence/phase-6-production-acceptance-and-operator-runbook/acceptance.json`

5. Update operator runbook and workstream state.
   - Document acceptance harness usage.
   - Mark Phase 6 complete and workstream complete after verification.

## Verification

```bash
pnpm --filter public-docs test -- \
  test/published-reader-production-acceptance.test.ts \
  test/nudge-published-reader-deploy-hook.test.ts \
  test/run-published-reader-deploy-pipeline.test.ts \
  test/check-published-reader-manifest.test.ts \
  test/rollback-published-reader-release.test.ts
pnpm --filter public-docs typecheck
pnpm --filter public-docs exec biome check \
  scripts/generate-published-reader-production-acceptance-evidence.ts \
  scripts/nudge-published-reader-deploy-hook.ts \
  scripts/run-published-reader-deploy-pipeline.ts \
  scripts/rollback-published-reader-release.ts \
  test/published-reader-production-acceptance.test.ts \
  package.json
pnpm docs:lint
```

## Done Criteria

- Acceptance evidence status is `passed`.
- Evidence contains all 11 required scenarios.
- No scenario uses real network, object store or Cloudflare deploy.
- Runbook points to the acceptance harness.
- Workstream state is marked complete.
