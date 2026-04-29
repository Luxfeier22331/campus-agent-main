# Testing Patterns

**Analysis Date:** 2026-03-31

## Test Framework

**Python runner:**
- `uv run --all-packages python -m unittest discover -s tests -t .` remains the repo baseline.
- Targeted Python runs may still use `uv run --all-packages python -m pytest ...` when a package-local workflow explicitly needs pytest filtering, but that does not replace the baseline contract.

**JS/TS runner:**
- JS/TS surfaces are orchestrated through repo root `pnpm` + `turbo`.
- Vitest remains the test runner for the current workspace apps.
- `apps/app-api` now uses explicit test lanes instead of a single mixed config:
  - `test:node`
  - `test:worker`
  - `test:shared-db-integration`

## Run Commands

```bash
uv run --all-packages python -m unittest discover -s tests -t .
pnpm web:typecheck
pnpm web:test
pnpm web:test:worker
pnpm web:test:integration
pnpm web:build
pnpm web:check:affected
```

Meaning:

- `pnpm web:test` is the JS/TS stable default gate.
- `pnpm web:test:worker` is the explicit Worker runtime lane.
- `pnpm web:test:integration` is the explicit shared-db integration lane for `apps/app-api`.
- `pnpm web:test:integration` is expected to fail closed when the connected shared DB has drifted away from the repo-owned adoption snapshot.

## Current JS/TS Lane Map

### apps/app-api

- `pnpm --dir apps/app-api test`
  - stable Node lane
- `pnpm --dir apps/app-api test:all`
  - local non-DB fanout (`node` + `worker`)
- `pnpm --dir apps/app-api test:worker`
  - Worker runtime lane
- `pnpm --dir apps/app-api test:shared-db-integration`
  - shared Postgres / Better Auth integration lane

### apps/public-chat-web

- `pnpm --dir apps/public-chat-web test`
  - alias of `test:worker`
- `pnpm --dir apps/public-chat-web test:worker`
  - Worker runtime lane

### apps/protected-panel-web

- `pnpm --dir apps/protected-panel-web test`
  - alias of `test:worker`
- `pnpm --dir apps/protected-panel-web test:worker`
  - Worker runtime lane

## Test File Organization

- Python tests still live under `tests/` and mirror repo layers such as `tests/api/`,
  `tests/ingestion/`, `tests/retrieval/`, `tests/agent/`, and `tests/supervisor/`.
- `apps/app-api/test/` now has an explicit split between:
  - `*.test.ts` for default Node lane coverage
  - `worker.test.ts` for Worker runtime coverage
  - `*.integration.test.ts` for explicit shared-db integration coverage
- `apps/public-chat-web/test/worker.test.ts` and `apps/protected-panel-web/test/worker.test.ts` remain Worker-first suites.

## Coverage Expectations

- The repo still treats passing baseline commands as the merge gate, not a numeric coverage percentage.
- Default merge confidence comes from:
  - Python baseline
  - JS/TS stable gate
  - any explicit worker or integration lane affected by the change

## Verification Notes

- Worker lanes may require permission to bind local ports in restricted sandboxes.
- `pnpm web:test` should not be described as “everything”; explicit worker and integration lanes remain separate by design.
- Retired apps such as `public-consumer-chat` and `public-entry-worker` are no longer part of the current test truth.
