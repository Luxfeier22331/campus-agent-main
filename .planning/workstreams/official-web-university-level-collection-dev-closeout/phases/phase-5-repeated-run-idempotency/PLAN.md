---
doc_type: phase_plan
status: pending
created: 2026-04-28
updated: 2026-04-28
---

# Phase 5 Plan: Repeated-Run Idempotency

## Goal

Prove consecutive school-level baseline runs are repeatable and do not create
duplicate side effects.

## Inputs

- Two fresh `university-core-baseline` runs from the Phase 2 runner
- Projection reports and document units from both runs

## Primary Write Set

- repeated-run comparison helper or script if none exists
- comparison report artifact
- `STATE.md` evidence update

## Comparison Dimensions

- normalized canonical URL set
- projected document ID set
- version ID / content hash behavior
- canonical markdown hash behavior
- semantic hash behavior where available
- target collection split
- document count delta
- failure / skip / warning counts

## Steps

1. Run `university-core-baseline` twice into isolated run directories.
2. Validate both runs independently.
3. Compare reports and projected document outputs.
4. Classify differences:
   - stable
   - expected live-content drift
   - suspicious duplicate
   - suspicious deletion
5. Write comparison artifact.
6. Record conclusion in `STATE.md`.

## Verification

```bash
uv run --all-packages python -m unittest <repeated-run-comparison-tests>
uv run --all-packages ruff check <changed-python-files>
uv run --all-packages ruff format <changed-python-files> --check
pnpm docs:lint
```

## Exit Criteria

- Two consecutive runs pass independent validation.
- Comparison report shows no duplicate document identity side effects.
- Any content drift is explicit and bounded.
