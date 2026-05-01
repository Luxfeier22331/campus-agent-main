---
doc_type: plan
status: completed
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 8 Plan: Closeout And Handoff

## Goal

Close the consumer-denominator recovery workstream and hand off future production cadence or news
runtime opening to separate workstreams.

## Tasks

1. Update workstream `STATE.md`, `ROADMAP.md` and `README.md`.
2. Add `CLOSEOUT.md` with evidence, selected-write posture and reopen rule.
3. Update official-web architecture docs if implementation changed source/channel boundaries.
4. Update crawl policy or serving strategy docs if default scheduler or downstream posture changed.
5. Create dormant seeds for future news/runtime opening or broader host rollout if needed.
6. Run planning docs lint, focused code tests and affected web/typecheck gates.

## Verification

```bash
pnpm docs:lint
pnpm web:typecheck:affected
pnpm web:test:affected
uv run --all-packages ruff check .
uv run --all-packages python -m unittest discover -s tests -t .
```

## Acceptance

- Workstream evidence is complete.
- Consumer denominator is the documented default for official-web recovery.
- Future broad news/opening work is not hidden in this workstream.
- Reopen rule is explicit.
