---
doc_type: phase_plan
status: pending
created: 2026-04-28
updated: 2026-04-28
---

# Phase 4 Plan: Fresh Baseline Evidence

## Goal

Run a fresh `university-core-baseline` collection and validate the full local
artifact chain.

## Inputs

- Phase 2 dev runner
- Phase 3 preflight
- `university-core-baseline` scheduler lane

## Primary Write Set

- `.tmp/official-web-university-level-collection-dev-closeout/<run-id>/...`
- this workstream `STATE.md`

## Steps

1. Run preflight for `university-core-baseline`.
2. Run crawl with the lane's host filter and page limits.
3. Run source-truth bundle validation.
4. Run QC.
5. Run projection replay.
6. Run projection validation.
7. Run chunk audit.
8. Record paths and counts in `STATE.md`.

## Verification

Expected command shape:

```bash
<official-web-dev-runner> \
  --lane university-core-baseline \
  --output-root <run-output-root>
```

Follow-up gates:

```bash
uv run --all-packages python \
  -m campus_ingestion_worker.validate_official_web_projection \
  --projection-output-dir <projection-output-dir>
uv run --all-packages \
  campus-ingestion-audit-official-web-projection-chunking \
  --projection-output-dir <projection-output-dir>
pnpm docs:lint
```

## Exit Criteria

- crawl validation errors = `0`
- QC fail pages = `0`
- projection validation errors = `0`
- chunk audit `passed = true`
- evidence paths and counts are recorded in `STATE.md`
