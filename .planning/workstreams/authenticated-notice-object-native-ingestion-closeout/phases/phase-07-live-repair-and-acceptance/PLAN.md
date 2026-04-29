---
doc_type: plan
status: completed
created: 2026-04-28
updated: 2026-04-29
---

<!-- markdownlint-disable MD013 -->

# Phase 7 Plan: Live Repair And Acceptance

## Goal

Repair current stale state and prove the target chain works without local filesystem handoff.

## Implementation Steps

1. Add an audit command/report for authenticated notice object locator health.
2. Audit current source bucket refs for `notice`, `file_release_capture`, and `file_release_source`.
3. Produce
   `evidence/phase-07-live-repair-and-acceptance/object-locator-audit.json`
   first; this command must not write PG or object store.
4. Produce
   `evidence/phase-07-live-repair-and-acceptance/selected-repair-manifest.json`
   with row ids, object keys, proposed action, and rollback notes.
5. Export selected rows to
   `evidence/phase-07-live-repair-and-acceptance/backup/` before any repair write.
6. Recollect selected stale `file_release_capture` rows through the live object-backed collector and run-id worker import path.
7. Run collector in Docker-compatible mode with object-store write enabled.
8. Run ingestion worker from `run_id` or object refs only.
9. Produce
   `evidence/phase-07-live-repair-and-acceptance/docker-handoff-acceptance.json`
   with:
   collector run id, object refs, verification counts, import result, historical repair batch result, dry-run no-write evidence, downstream untouched proof.
10. Update `STATE.md` and `WORKSTREAMS.md` closeout status.

## Tests / Verification

```bash
pnpm web:lint
uv run --all-packages ruff check .
uv run --all-packages ruff format . --check
uv run --all-packages python -m unittest discover -s tests -t .
git diff --check
```

## Exit Criteria

- No accepted live rows point to missing required source objects.
- Any repaired rows are backed by a selected manifest and backup artifact.
- Docker collector -> object store -> worker import smoke succeeds without shared local export directory.
- Workstream can be archived with clear reopen rules.
