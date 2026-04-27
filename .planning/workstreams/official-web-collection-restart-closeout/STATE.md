---
doc_type: state
status: active
created: 2026-04-28
updated: 2026-04-28
---

# State: Official Web Collection Restart Closeout

## Current Status

- status: `active`
- current phase: `Phase 2`
- owner: unassigned
- active implementation: planning and ops follow-up only
- latest completed slice: local official web batch restart evidence
- latest successful run id: `e0ed85dd-81fc-4882-b122-dae0246ac524`

## Current Repo Facts

- `scripts/run_ingestion_worker_batch.py` can run bounded `official_web` batches.
- Local dry-run for `official_web --limit 5` discovered candidates without writing.
- Local real batch for `official_web --limit 5` completed with `errors = 0`.
- `fresh_news` DB inspection showed archived documents with title, source path and content hash.
- Ports `8001`, `8081` and `8787` were not required for this local batch evidence.
- This evidence does not change serving surface status.

## Latest Evidence

- dry-run:
  `uv run --all-packages python scripts/run_ingestion_worker_batch.py --source-channel official_web --limit 5 --report-dir .tmp/official-web-restart-smoke --dry-run`
- real batch:
  `uv run --all-packages python scripts/run_ingestion_worker_batch.py --source-channel official_web --limit 5 --report-dir .tmp/official-web-restart-batch`
- DB inspection:
  `uv run --all-packages python scripts/inspect_ingestion_db.py --collection fresh_news --limit 10`
- unittest:
  `uv run --all-packages python -m unittest tests.ingestion_core.test_official_web_batch`
- lint:
  `uv run --all-packages ruff check apps/ingestion-worker packages/ingestion-core scripts tests/ingestion_core`
- format check:
  `uv run --all-packages ruff format apps/ingestion-worker packages/ingestion-core scripts tests/ingestion_core --check`

## Latest Batch Outcome

- candidates discovered: `5`
- committed: `5`
- skipped: `0`
- errors: `0`
- report:
  `.tmp/official-web-restart-batch/official_web_batch_e0ed85dd-81fc-4882-b122-dae0246ac524.json`

## Remaining Gaps

- `OFFICIAL-WEB-OPS-01`: dev/local scheduler entry still needs a documented command and repeated-run
  cadence.
- `OFFICIAL-WEB-OPS-02`: worker preflight should explicitly verify official web source channel
  readiness, writable target store and report directory behavior.
- `OFFICIAL-WEB-OPS-03`: repeated-run acceptance should prove idempotency or bounded duplicate
  handling across at least two consecutive runs.
- `OFFICIAL-WEB-OPS-04`: report retention needs a concrete age/count policy for local and future
  deployed runs.
- `OFFICIAL-WEB-OPS-05`: alerting needs concrete failure, zero-candidate and abnormal skip/error
  thresholds.
- `OFFICIAL-WEB-OPS-06`: deployment handoff evidence is pending; current evidence is local only.

## Continuity Notes

- Keep `official-web-source-channel-news-opening` in backlog until product scope explicitly reopens
  news query-serving.
- Do not use this workstream to change retrieval runtime profile or product routing gates.
- Next implementation should start with `OFFICIAL-WEB-OPS-01` through `OFFICIAL-WEB-OPS-03` before
  adding alert/retention policy.
