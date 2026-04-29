---
doc_type: summary
status: implemented-local
created: 2026-04-29
updated: 2026-04-29
---

# Summary: Phase 2 Scheduled Runner And Single-flight Lock

## Implemented

- Added `apps/public-docs/scripts/run-published-reader-scheduled-check.ts`.
- Added `pnpm --filter public-docs check:published-reader-scheduled`.
- Added schedule resolution for Shanghai `00:00 / 06:00 / 12:00 / 18:00`.
- Recorded the controlled runner UTC cron as `7 4,10,16,22 * * *`.
- Added `not_due`, `lock_busy` and `checked` outcomes.
- Added file-based single-flight lock with stale lock cleanup.
- Added scheduled / forced ledger append on top of Phase 1 manifest check.
- Added `trigger`, `scheduleKey` and `lockId` ledger metadata.
- Updated the publish/deploy runbook with scheduled-check usage.

## Not Implemented In Phase 2

- Build orchestration.
- Preview smoke.
- Cloudflare deploy.
- Deployment id capture.
- Retry / rollback.
- Deploy-hook nudger.

These remain Phase 3+.

## Evidence

- `.planning/workstreams/public-docs-rolling-publish-automation/evidence/phase-2-scheduled-runner-and-single-flight-lock/verification.md`
