---
doc_type: context
status: active
created: 2026-04-29
updated: 2026-04-29
---

# Context: Phase 2 Scheduled Runner And Single-flight Lock

## Problem

Phase 1 can check a manifest and produce a release ledger record, but it is
still an operator-invoked CLI. Rolling publish needs a repeatable scheduled
entrypoint that can be called by CI or a controlled runner at the accepted
publish windows.

Without Phase 2, the system cannot reliably answer:

- whether this invocation is inside an accepted Shanghai schedule window
- whether another runner is already checking the same surface/environment
- whether a stale crashed runner should be cleaned up
- whether an unchanged manifest was explicitly skipped in the ledger

## Accepted Direction

- Prod check windows remain Shanghai time `00:00 / 06:00 / 12:00 / 18:00`.
- Controlled runner UTC cron is `7 4,10,16,22 * * *`, remaining within the accepted
  Shanghai publish windows.
- The scheduled runner performs manifest check and ledger append only.
- Build, smoke, deploy and rollback remain Phase 3+.
- The lock is owned by the controlled runner substrate, not by browser runtime.
- The lock state is operational runtime state and must stay gitignored.

## Phase 1 Inputs

- `apps/public-docs/scripts/check-published-reader-manifest.ts`
- `pnpm --filter public-docs check:published-reader-manifest`
- `.planning/runtime/public-docs-publish/*.json` as local operator runtime state
