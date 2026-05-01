---
doc_type: phase_outline
status: planned
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 9 Outline: Legacy Closeout And Acceptance

## Goal

Close the workstream by retiring unsafe legacy paths and recording acceptance evidence.

## Deliverables

- Legacy broad crawl path documented as explicit debug/operator-only.
- Any legacy broad run admission remains excluded from projection handoff and selected-write.
- Architecture, source-truth schema and crawl policy docs updated.
- Workstream `SUMMARY.md`.
- `STATE.md` and `.planning/WORKSTREAMS.md` updated.

## Non-Goals

- No deletion of canonical source-truth objects solely because they came from legacy runs.
- No fresh-news/news-archive runtime opening.
- No hidden migration of official-web current truth.

## Acceptance

- Target-first path is the default official-web collection path.
- Legacy path cannot dispatch/promote without explicit admission.
- All gates from `REQUIREMENTS.md` pass or documented with concrete blocker.
- GSD status shows only the current unclosed phase as `in_progress`; future phases must not remain executable `PLAN.md` without ownership.

## Verification

```bash
pnpm docs:lint
pnpm web:lint
pnpm web:typecheck
pnpm web:test:worker
pnpm web:test:integration
pnpm --dir apps/official-web-collector test
pnpm --dir apps/app-api test -- official-web
uv run --all-packages ruff check .
uv run --all-packages ruff format . --check
uv run --all-packages python -m unittest discover -s tests -t .
git diff --check
```
