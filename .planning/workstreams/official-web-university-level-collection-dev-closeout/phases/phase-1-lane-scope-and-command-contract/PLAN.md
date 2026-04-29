---
doc_type: phase_plan
status: pending
created: 2026-04-28
updated: 2026-04-28
---

# Phase 1 Plan: Lane Scope And Command Contract

## Goal

Freeze the local dev command contract for school-level official web collection
lanes.

## Inputs

- `configs/sources/official_web/muc_public/scheduler-policy.json`
- `configs/sources/official_web/muc_public/hosts.json`
- `apps/official-web-collector/README.md`
- `docs/runbooks/official-web-collector-smoke-and-audit.md`
- `docs/runbooks/official-web-source-truth-projection-replay.md`

## Primary Write Set

- `apps/official-web-collector/README.md`
- `docs/runbooks/official-web-collector-smoke-and-audit.md`
- this workstream `STATE.md`

## Steps

1. Document lane contract for:
   - `university-core-hot`
   - `university-core-baseline`
2. Define expected operator command shape:
   - `--lane university-core-hot`
   - `--lane university-core-baseline`
   - explicit output/report root
   - artifact-only default
3. Define run artifact naming:
   - run id
   - crawl output root
   - validation report
   - QC report
   - projection output root
   - projection validation report
   - chunk audit report
4. Define hard boundary that lane execution does not imply import/promote.

## Verification

```bash
pnpm docs:lint
```

## Exit Criteria

- Operator can identify the exact lane command contract before implementation.
- Lane scope matches scheduler policy.
- Docs do not imply serving opening or promotion.
