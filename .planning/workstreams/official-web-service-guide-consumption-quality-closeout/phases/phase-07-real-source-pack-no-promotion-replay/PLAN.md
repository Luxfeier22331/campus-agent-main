---
doc_type: plan
status: completed
created: 2026-05-04
updated: 2026-05-04
---

<!-- markdownlint-disable MD013 -->

# Phase 7 Plan: Real Source-Pack No-Promotion Replay

## Goal

Prove candidate extraction, projection shaping and runtime-preview quality on real captured
official-web source packs without current-truth writes.

## Inputs

- Phase 2 `SUMMARY.md`
- Phase 6 `SUMMARY.md`
- current official-web source-pack artifacts
- `configs/sources/official_web/muc_public/target-source-map.json`
- `configs/sources/official_web/muc_public/target-inventory.json`
- selected-write preview tooling

## Tasks

1. Re-run source-pack replay in no-promotion mode.
2. Limit proof to impacted service-guide targets:
   - VPN
   - campus network authentication
   - email service
   - information disclosure
   - campus card
3. Generate machine-readable quality summary:
   - service name
   - procedure group count
   - step count by group
   - selected/omitted section summary
   - material noise count
   - entry URL coverage
   - field-source coverage
   - source ref coverage
   - guardrail/eval result
4. Generate selected-write preview report only:
   - exact write plan
   - blocked/deferred reasons
   - task-scope record count
   - full-impact record count
   - source refs for every ready candidate
5. Record artifact paths in `SUMMARY.md`.

## Acceptance Criteria

- No PG/object-store current promotion occurs in this phase.
- Replay evidence demonstrates the five impacted service-guide targets do not regress.
- Preview report is reproducible from captured source-truth artifacts without re-fetching source
  pages.
- Quality summary is machine-readable and can be consumed by Phase 8/9 closeout.

## Verification

```bash
uv run --all-packages python -m unittest tests.ingestion.official_web_projection_core_replay_suite
uv run --all-packages python -m unittest tests.ingestion.test_release_official_web_selected_write
uv run --all-packages ruff check apps/ingestion-worker packages/ingestion-core packages/evals
```

## Done Summary Template

When complete, write `SUMMARY.md` with:

- source-pack IDs / artifact paths
- impacted targets
- no-promotion command and evidence
- quality summary path
- preview report path
- verification evidence
