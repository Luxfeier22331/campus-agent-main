---
doc_type: plan
status: planned
created: 2026-04-29
updated: 2026-04-29
---

# Plan: Phase 2 Scheduled Runner And Single-flight Lock

## Goal

Add a scheduled-check runner for `apps/public-docs` that can be called by CI or a
controlled operator runner. It must respect the accepted Shanghai schedule, acquire
a single-flight lock before checking, append the Phase 1 ledger record, and clean
up stale locks.

Phase 2 still must not build, smoke, deploy, rollback or call Wrangler.

## Requirements

- Expose the schedule contract:
  - Shanghai windows: `00:00 / 06:00 / 12:00 / 18:00`
  - UTC cron: `0 4,10,16,22 * * *`
- Support `force` mode for manual operator dry-run.
- Return `not_due` outside schedule window without touching manifest or lock.
- Acquire an atomic file lock before manifest check.
- Return `lock_busy` if a non-stale lock exists.
- Remove stale lock and continue when the lock expired.
- Append the Phase 1 ledger record when a check runs.
- Preserve `lockId`, `runnerId`, trigger type and schedule key in the ledger record.
- Keep runtime state in `.planning/runtime/public-docs-publish/` by default.

## Implementation Tasks

1. Add scheduled runner module.
   - Suggested file:
     `apps/public-docs/scripts/run-published-reader-scheduled-check.ts`.
   - Export pure schedule functions for tests.
   - Export lock acquire/release helpers.
   - Export `runPublishedReaderScheduledCheck()`.

2. Add CLI and package script.
   - Suggested script:
     `check:published-reader-scheduled`.
   - Support `--env`, `--ledger`, `--lock-file`, `--manifest-path`,
     `--manifest-key`, `--now`, `--force`, `--due-window-minutes`,
     `--lock-stale-ms`.

3. Add tests.
   - outside accepted Shanghai window -> `not_due`
   - due window -> lock acquired -> manifest checked -> ledger appended
   - unchanged manifest -> appended `skipped` ledger record
   - active lock -> `lock_busy` and no ledger append
   - stale lock -> lock removed, check proceeds
   - CLI args tolerate pnpm `--` separator

4. Update runbook and workstream docs.
   - Explain CI should call the scheduled runner at UTC `0 4,10,16,22 * * *`.
   - Explain Phase 2 does not deploy.
   - Explain lock/ledger default paths.

## Verification

```bash
pnpm --filter public-docs test
pnpm --filter public-docs typecheck
pnpm --filter public-docs exec biome check \
  scripts/run-published-reader-scheduled-check.ts \
  test/run-published-reader-scheduled-check.test.ts \
  package.json
pnpm docs:lint
```

Run a package-script smoke with a temporary manifest:

```bash
PUBLIC_DOCS_SYNC_MANIFEST_PATH=<tmp>/manifest.json \
  pnpm --filter public-docs check:published-reader-scheduled -- \
  --env staging \
  --force \
  --ledger <tmp>/ledger.json \
  --lock-file <tmp>/lock.json
```

## Done Criteria

- Scheduled runner can produce `not_due`, `lock_busy` and `checked` outcomes.
- Runner appends manifest check ledger records only after acquiring the lock.
- Active locks block concurrent execution.
- Stale locks are removed before retry.
- No build/deploy command is invoked in Phase 2.
