---
doc_type: state
workstream: notice-agent-card-first-tool-boundary
status: completed
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# State: Notice Agent Card-First Tool Boundary

## Current Position

**Status:** Completed
**Current Phase:** Phase 6 complete
**Last Activity:** 2026-05-01
**Last Activity Description:** Completed card-first notice tool/function boundary implementation. `campus_notice_discover` remains agent-facing; `campus_notice_get` is internal/closed for provider and SDK surfaces; Go finalizer inference, API readyz, workflow trace evals, docs, eval denominator and opening review were updated.

## Current Blockers

- None.

## Next Slice

No active implementation slice. Reopen only under the reopen rule in `CLOSEOUT.md`.

## Initial Verification Targets

```bash
pnpm docs:lint
(cd apps/supervisor-api && go test ./internal/...)
uv run --all-packages ruff check apps/supervisor-agent-worker packages/notice-agent packages/evals tests
uv run --all-packages python -m unittest discover -s tests -t .
git diff --check
```
