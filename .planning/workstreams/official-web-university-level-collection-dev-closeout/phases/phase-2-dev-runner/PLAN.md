---
doc_type: phase_plan
status: pending
created: 2026-04-28
updated: 2026-04-28
---

# Phase 2 Plan: Dev Runner

## Goal

Provide a repeatable local dev runner for school-level official web collection
by `lane_id`.

## Inputs

- `configs/sources/official_web/muc_public/scheduler-policy.json`
- `apps/official-web-collector`
- `apps/ingestion-worker`
- existing official web crawl, validation, QC, projection, and chunk audit
  commands

## Primary Write Set

Use the smallest durable boundary already present in the repo:

- existing collector CLI / wrapper, if one already owns crawl execution
- otherwise a new thin dev runner under `apps/official-web-collector` or
  `apps/ingestion-worker`
- tests under `tests/` for lane resolution and command safety
- docs/runbook updates from Phase 1

## Steps

1. Inspect existing official-web collector and ingestion-worker commands.
2. Reuse existing crawl/projection/validation commands where available.
3. Add lane resolution from scheduler policy:
   - reject unknown lane
   - reject disabled lane unless explicitly allowed for operator single-host
     validation outside this workstream
   - resolve host filter and page limits from policy
4. Ensure default mode is artifact-only.
5. Emit one run summary with paths to all produced artifacts.
6. Add tests for lane resolution and artifact-only default.

## Verification

```bash
uv run --all-packages python -m unittest \
  <new-or-existing-official-web-dev-runner-tests>
uv run --all-packages ruff check <changed-python-files>
uv run --all-packages ruff format <changed-python-files> --check
pnpm docs:lint
```

## Exit Criteria

- `university-core-hot` and `university-core-baseline` can be invoked through
  one stable dev path.
- Runner returns machine-readable evidence paths.
- Runner does not import/promote by default.
