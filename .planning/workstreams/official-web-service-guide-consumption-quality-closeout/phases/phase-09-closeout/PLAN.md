---
doc_type: plan
status: active
created: 2026-05-04
updated: 2026-05-04
---

<!-- markdownlint-disable MD013 -->

# Phase 9 Plan: Closeout

## Goal

Close the workstream with durable evidence, updated docs and no hidden follow-up debt inside the
declared scope.

## Inputs

- Phase 1-8 `SUMMARY.md` files
- `GAP-REVIEW.md`
- `README.md`
- `REQUIREMENTS.md`
- `ROADMAP.md`
- `STATE.md`
- `.planning/WORKSTREAMS.md`

## Tasks

1. Verify every Phase 0 gap has a resolved outcome:
   - fixed
   - explicitly out of scope with reason
   - deferred only if outside this workstream boundary
2. Add `CLOSEOUT.md` with:
   - final architecture/contract state
   - changed files by layer
   - verification commands
   - artifact paths
   - remaining deferred items
3. Update `STATE.md` and `.planning/WORKSTREAMS.md`.
4. Ensure no local evidence files are left in repo root.
5. Run docs lint and targeted implementation gates from phase summaries.

## Acceptance Criteria

- Workstream can be resumed or audited without chat history.
- Deferred gaps are outside this workstream's scope, not unfinished acceptance criteria.
- Registry state matches local workstream state.
- Verification evidence is recorded with exact commands.

## Verification

```bash
pnpm docs:lint
pnpm web:typecheck:affected
uv run --all-packages ruff check .
uv run --all-packages python -m unittest discover -s tests -t .
```

## Done Summary Template

When complete, write `CLOSEOUT.md` with:

- final status
- phase summary links
- verification evidence
- artifact cleanup status
- reopen rules
