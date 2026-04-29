---
doc_type: summary
status: implemented-local
created: 2026-04-29
updated: 2026-04-29
---

# Summary: Phase 3 Build, Smoke, And Deploy Pipeline Integration

## Implemented

- Added `apps/public-docs/scripts/run-published-reader-deploy-pipeline.ts`.
- Added `apps/public-docs/scripts/smoke-published-reader-build.ts`.
- Added `pnpm --filter public-docs deploy:published-reader-scheduled`.
- Added `pnpm --filter public-docs smoke:published-reader-build`.
- Wired Phase 2 scheduled manifest check into the Phase 3 deploy pipeline.
- Preserved skip behavior for `not_due`, `lock_busy`, `unchanged`, `invalid`
  and `blocked`.
- Added ordered `build -> smoke -> verify -> deploy` command planning for
  changed manifests.
- Added injectable command runner so tests never call real Cloudflare deploy.
- Added build-output smoke for manifest target assets under `doc_build`.
- Added final `deployed` ledger append after successful deploy.
- Added final `failed` ledger append on first command failure.
- Added Cloudflare deployment id extraction from deploy output.
- Updated the publish/deploy runbook with scheduled deploy usage.

## Not Implemented In Phase 3

- Retry policy.
- Rollback drill.
- Manual rollback command.
- Deploy-hook nudger.
- Production acceptance evidence.

These remain Phase 4+.

## Evidence

- `.planning/workstreams/public-docs-rolling-publish-automation/evidence/phase-3-build-smoke-and-deploy-pipeline-integration/verification.md`
