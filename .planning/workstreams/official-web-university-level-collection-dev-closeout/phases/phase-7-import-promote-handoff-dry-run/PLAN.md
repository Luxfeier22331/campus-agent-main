---
doc_type: phase_plan
status: pending
created: 2026-04-28
updated: 2026-04-28
---

# Phase 7 Plan: Import/Promote Handoff Dry-Run

## Goal

Verify the fresh school-level projection output is ready for import/promote
handoff without executing actual promotion.

## Inputs

- latest successful `university-core-baseline` projection output
- official web projection import command
- collection runtime profiles
- current registry configuration

## Primary Write Set

- import/promote dry-run command or documented invocation
- dry-run report artifact
- `STATE.md`
- `ROADMAP.md` closeout status if all phases pass

## Required Checks

- projection report exists and is valid.
- target collection split is expected:
  - `official_web/muc_public_pages`
  - `official_web/stable_reference`
- `fresh_news` and `news_archive` are not promoted by this workstream.
- object-store / registry writes are dry-run only.
- import command resolves required registry inputs without mutating them.
- release/promotion remains an explicit later operator action.

## Steps

1. Run projection validation and chunk audit on the selected projection output.
2. Run import/promote dry-run.
3. Confirm target collection split.
4. Confirm no registry mutation occurred.
5. Record dry-run report path and conclusion in `STATE.md`.
6. Mark roadmap complete only if Phase 0-7 exit criteria are satisfied.

## Verification

```bash
uv run --all-packages python \
  -m campus_ingestion_worker.validate_official_web_projection \
  --projection-output-dir <projection-output-dir>
uv run --all-packages \
  campus-ingestion-audit-official-web-projection-chunking \
  --projection-output-dir <projection-output-dir>
<official-web-import-command> \
  --projection-output-dir <projection-output-dir> \
  --dry-run
pnpm docs:lint
```

## Exit Criteria

- Dry-run report passes.
- No registry import/promote mutation happened.
- State clearly separates artifact evidence from current registry truth.
