---
doc_type: phase_plan
status: pending
created: 2026-04-28
updated: 2026-04-28
---

# Phase 3 Plan: Preflight

## Goal

Add fail-close preflight checks for school-level official web collection.

## Inputs

- Phase 2 dev runner contract
- `configs/sources/official_web/muc_public/hosts.json`
- `configs/sources/official_web/muc_public/scheduler-policy.json`
- projection declarations
- report/output roots

## Primary Write Set

- official-web collector or ingestion-worker preflight module
- tests for preflight success and failure cases
- runbook documentation
- `STATE.md` evidence path once executed

## Required Checks

- hosts config exists and parses.
- scheduler policy exists and parses.
- requested lane exists.
- requested lane is enabled for this workstream.
- lane hosts are present in hosts config and are allowed school-level hosts.
- output root is writable.
- report root is writable.
- projection declarations are readable.
- validator, QC, projection, and chunk audit commands are reachable.
- artifact-only mode is active unless import/promote dry-run is explicitly
  requested in Phase 7.

## Steps

1. Add preflight report model with `passed`, `checks`, and `failure_codes`.
2. Add checks listed above.
3. Wire preflight into dev runner before crawl execution.
4. Add unit tests for:
   - valid `university-core-baseline`
   - unknown lane
   - disabled lane
   - host outside allowlist
   - unwritable output/report root
5. Document command and failure behavior.

## Verification

```bash
uv run --all-packages python -m unittest <official-web-preflight-tests>
uv run --all-packages ruff check <changed-python-files>
uv run --all-packages ruff format <changed-python-files> --check
pnpm docs:lint
```

## Exit Criteria

- Preflight blocks unsafe or malformed runs before network work starts.
- Preflight writes a durable report.
- Failure codes are actionable for an operator.
