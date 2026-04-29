---
doc_type: phase_plan
status: pending
created: 2026-04-28
updated: 2026-04-28
---

# Phase 6 Plan: Retention And Alerts

## Goal

Define and implement local report retention and alert summary rules for
school-level official web runs.

## Inputs

- Phase 4 / Phase 5 run reports
- existing ingestion worker report retention utilities
- official web run artifacts

## Primary Write Set

- retention policy config or command docs
- alert summary helper or integration with existing report summary command
- tests for retention and alert threshold behavior
- runbook update
- `STATE.md` evidence update

## Retention Rules

Default local policy:

- keep the latest `20` runs per lane
- keep runs newer than `14` days
- never prune the latest successful baseline run
- dry-run mode required before destructive prune

## Alert Rules

Alert summary should flag:

- preflight failed
- crawl failure count > `0`
- source validation errors > `0`
- QC fail pages > `0`
- projection emitted documents = `0`
- projection validation errors > `0`
- chunk audit failed
- baseline document count below `70%` of the latest successful baseline

## Steps

1. Reuse existing report retention infrastructure if present.
2. Add official-web lane-aware retention defaults.
3. Add alert summary classification.
4. Add tests for threshold and dry-run behavior.
5. Generate one retention dry-run report and one alert summary report.
6. Record evidence in `STATE.md`.

## Verification

```bash
uv run --all-packages python -m unittest <retention-alert-tests>
uv run --all-packages ruff check <changed-python-files>
uv run --all-packages ruff format <changed-python-files> --check
pnpm docs:lint
```

## Exit Criteria

- Retention can run in dry-run mode.
- Alert summary reports actionable failure codes.
- No destructive prune is required for workstream completion.
