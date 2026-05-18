---
doc_type: plan
phase: phase-09-closeout-and-guardrails
status: planned
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 9 Plan: Closeout And Guardrails

## Goal

Close the workstream with drift guards, docs alignment and clear reopen rules.

## Tasks

1. Add ToolSpec drift guard for Go/Python/eval/docs alignment.
2. Update architecture and contract docs with implemented state.
3. Add lint/test route for new tool additions.
4. Write phase/workstream closeout summary.
5. Update `.planning/WORKSTREAMS.md` with completion and reopen rule.

## Write Scope

- guard tests / scripts
- docs updates
- planning summary files

## Verification

```bash
pnpm docs:lint
pnpm yaml:lint
pnpm decomposition:lint
cd apps/supervisor-api && go test ./...
uv run --all-packages ruff check .
uv run --all-packages ruff format . --check
uv run --all-packages python -m unittest discover -s tests -t .
git diff --check
```
