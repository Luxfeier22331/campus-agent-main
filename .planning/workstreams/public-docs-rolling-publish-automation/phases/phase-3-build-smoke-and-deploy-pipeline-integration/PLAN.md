---
doc_type: plan
status: planned
created: 2026-04-29
updated: 2026-04-29
---

# Plan: Phase 3 Build, Smoke, And Deploy Pipeline Integration

## Goal

Add a controlled publish pipeline for `apps/public-docs` that turns a scheduled
`changed` manifest verdict into ordered build, smoke and deploy execution, then
records final deployment state in the release ledger.

Phase 3 must remain dry-run safe in tests and must not implement retry, rollback
or deploy-hook behavior.

## Requirements

- Keep Phase 2 as the admission gate and single-flight owner.
- Do not execute build/smoke/deploy for:
  - `not_due`
  - `lock_busy`
  - `unchanged`
  - `invalid`
  - `blocked`
- Execute ordered deployment commands for `changed`:
  - build published reader assets
  - smoke the built reader bundle
  - verify deploy config
  - run Wrangler deploy
- Allow tests to inject a command runner.
- Append a final `deployed` ledger record only after all deployment commands
  succeed.
- Append a final `failed` ledger record if any command fails.
- Stop at the first failing command and do not run deploy after a failed build
  or smoke.
- Capture `cloudflareDeploymentId` from deploy output when available.
- Expose a package script that CI / controlled runners can call.

## Implementation Tasks

1. Add Phase 3 tests first.
   - Suggested file:
     `apps/public-docs/test/run-published-reader-deploy-pipeline.test.ts`.
   - Cover changed, unchanged, blocked/invalid, command failure and dry-run
     behavior.

2. Add deploy pipeline module.
   - Suggested file:
     `apps/public-docs/scripts/run-published-reader-deploy-pipeline.ts`.
   - Export pure command planning helpers.
   - Export `runPublishedReaderDeployPipeline()`.
   - Export CLI arg parser for package-script use.

3. Add a build-output smoke helper.
   - Suggested file:
     `apps/public-docs/scripts/smoke-published-reader-build.ts`.
   - Validate the Rspress output exists and manifest target objects are present
     in `doc_build`.
   - Keep it as a short-running command, not a long-running preview server.

4. Add package scripts.
   - `smoke:published-reader-build`
   - `deploy:published-reader-scheduled`

5. Update runbook and workstream state.
   - Explain the Phase 3 scheduled deploy command.
   - Explain skip / changed / failure ledger behavior.
   - Keep Phase 4 rollback and retry explicitly out of scope.

## Verification

```bash
pnpm --filter public-docs test -- \
  test/run-published-reader-deploy-pipeline.test.ts \
  test/smoke-published-reader-build.test.ts \
  test/run-published-reader-scheduled-check.test.ts \
  test/check-published-reader-manifest.test.ts
pnpm --filter public-docs typecheck
pnpm --filter public-docs exec biome check \
  scripts/run-published-reader-deploy-pipeline.ts \
  scripts/smoke-published-reader-build.ts \
  test/run-published-reader-deploy-pipeline.test.ts \
  test/smoke-published-reader-build.test.ts \
  package.json
pnpm docs:lint
```

## Done Criteria

- `changed` manifest runs build, smoke and deploy in order.
- Non-deployable outcomes do not run deployment commands.
- Failed build/smoke/deploy appends `failed` and never appends `deployed`.
- Successful deploy appends `deployed` with deployment metadata.
- Tests prove the pipeline without calling real Cloudflare deploy.
