---
doc_type: plan
status: planned
created: 2026-04-30
updated: 2026-04-30
---

<!-- markdownlint-disable MD013 -->

# Phase 7 Plan: Guardrails And Closeout

## Goal

Prevent regression to notice-level media hard gates and close the workstream with explicit evidence.

## Tasks

1. Add drift guard tests:
   - target candidate with supplemental pending image cannot be blocked solely by pending media.
   - target candidate with required carrier media pending remains blocked/deferred.
2. Add focused rg/lint guard if practical:
   - target replay cannot use `multimodal_status` as sole blocker.
3. Update workstream docs:
   - `STATE.md`
   - `ROADMAP.md`
   - `SUMMARY.md`
4. Update `.planning/WORKSTREAMS.md` status row.
5. Run final verification.

## Acceptance Criteria

- Guard tests fail on the old `355881` behavior.
- Guard tests pass with fact-level readiness.
- Workstream closeout summarizes remaining deferred items, if any.
- No unrelated workstream evidence is modified.

## Verification

```bash
pnpm docs:lint
uv run --all-packages ruff check .
uv run --all-packages ruff format . --check
uv run --all-packages python -m unittest discover -s tests -t .
git diff --check
```
