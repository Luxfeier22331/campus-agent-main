# 12-02 Summary

## Outcome

- Phase 12 now has bounded historical replay evidence beyond the earlier one-record sample.
- The apparent replay "hang" was traced to repo-local MinIO interaction in the shared S3 writer path, not to bundle parsing, raw asset dedupe, or document registry writes.
- `S3ObjectStoreWriter` now isolates zero-byte object writes to a throwaway client, which removes the replay stall without changing authenticated-notice source-truth semantics.

## Root Cause

- A `2`-record import with real Postgres registries plus `NoopWriter` completed in `4.783s`, which ruled out importer parsing and registry ownership as the blocker.
- The shared `boto3` S3 client consistently slowed down after a zero-byte `put_object`:
  - authenticated notices legitimately emit empty `provider/attachment-observations.jsonl`
  - authenticated notices can also emit empty `source-truth/attachment-refs.jsonl`
- Direct reproduction against local MinIO showed the next reused write stalled after the zero-byte object:
  - shared client: `first non-empty -> zero-byte -> next non-empty` delayed the next write by about `30.525s`
  - fresh client per write completed without the stall
  - resetting the client after the zero-byte write also completed without the stall
- This isolated the root cause to shared-client connection reuse after zero-byte object writes on repo-local MinIO.

## Main Changes

- `packages/ingestion-core/src/campus_ingestion_core/campusrag_ingestion_support.py`
  - `S3ObjectStoreWriter` now routes zero-byte payloads through a one-shot S3 client and closes it immediately after the write
- `tests/ingestion/test_campusrag_ingestion_support.py`
  - adds a regression test proving empty payload writes do not reuse the shared client
- `docs/runbooks/authenticated-notice-bootstrap-smoke-runbook.md`
  - records the zero-byte object-store caveat so future replay debugging starts from the right boundary
- `docs/plans/authenticated-notice-source-foundation.md`
  - records that empty authenticated-notice artifacts are valid and should not be "fixed" by mutating source-truth semantics

## Replay Evidence

- `2`-record replay
  - summary: `.tmp/authenticated-notice-smoke/20260404T131900-2-timed/summary.json`
  - elapsed: `14.64s`
  - result: `notice_count=2`, `created=0`, `updated=0`, `skipped=2`, `raw_uploaded=0`, `raw_reused=2`, `errors=[]`
- `10`-record replay
  - summary: `.tmp/authenticated-notice-smoke/20260404T131350-10/summary.json`
  - elapsed: `39.66s`
  - result: `notice_count=10`, `created=8`, `updated=0`, `skipped=2`, `raw_uploaded=6`, `raw_reused=4`, `errors=[]`
- `50`-record replay
  - summary: `.tmp/authenticated-notice-smoke/20260404T131544-50/summary.json`
  - elapsed: `184.53s`
  - result: `notice_count=50`, `created=48`, `updated=0`, `skipped=2`, `raw_uploaded=0`, `raw_reused=50`, `errors=[]`
  - note: this was a rerun after smaller slices had already seeded the same raw assets, so all raw outcomes were `reused`

## Verification

- red/green regression test
  - `uv run --package campus-ingestion-worker python -m unittest tests.ingestion.test_campusrag_ingestion_support.CampusragIngestionSupportTest.test_s3_object_store_writer_uses_one_shot_client_for_zero_byte_payloads`
- focused authenticated-notice verification
  - `uv run --package campus-ingestion-worker python -m unittest tests.ingestion.test_collection_config tests.ingestion.test_corpus_runtime_profile tests.ingestion.test_authenticated_notice_import tests.ingestion.test_import_authenticated_notice_export_worker tests.ingestion.test_smoke_authenticated_notice_bootstrap_worker tests.ingestion.test_campusrag_ingestion_support`
- real historical replay smoke
  - `uv run --package campus-ingestion-worker python -m campus_ingestion_worker.smoke_authenticated_notice_bootstrap --bundle-path .tmp/authenticated-notice-smoke/20260404T131900-2-timed/notices-bundle-slice-2.json --manifest-path /home/reptilian/code/rag-data/muc-notice-collector/runtime/exports/export-manifest-20260403-run-2.json --site-id muc_internal_portal --source-home-url https://my.muc.edu.cn --expect-notice-count 2 --summary-output-path .tmp/authenticated-notice-smoke/20260404T131900-2-timed/summary.json`
  - `uv run --package campus-ingestion-worker python -m campus_ingestion_worker.smoke_authenticated_notice_bootstrap --bundle-path .tmp/authenticated-notice-smoke/20260404T131350-10/notices-bundle-slice-10.json --manifest-path /home/reptilian/code/rag-data/muc-notice-collector/runtime/exports/export-manifest-20260403-run-2.json --site-id muc_internal_portal --source-home-url https://my.muc.edu.cn --expect-notice-count 10 --summary-output-path .tmp/authenticated-notice-smoke/20260404T131350-10/summary.json`
  - `uv run --package campus-ingestion-worker python -m campus_ingestion_worker.smoke_authenticated_notice_bootstrap --bundle-path .tmp/authenticated-notice-smoke/20260404T131544-50/notices-bundle-slice-50.json --manifest-path /home/reptilian/code/rag-data/muc-notice-collector/runtime/exports/export-manifest-20260403-run-2.json --site-id muc_internal_portal --source-home-url https://my.muc.edu.cn --expect-notice-count 50 --summary-output-path .tmp/authenticated-notice-smoke/20260404T131544-50/summary.json`

## Next Slice

- `12-03` can now focus back on collector artifact convergence and workspace hygiene instead of replay triage.
- Larger historical batches (`240`, then broader backfills) should continue using the staged summary pattern from this slice, with the current zero-byte write guard treated as required runtime behavior for repo-local MinIO.
