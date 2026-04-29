# Quick Task 260411-pbp Verification

## Targeted Checks

Command:

- `uv run --all-packages python -m unittest tests.ingestion.test_authenticated_notice_import tests.ingestion.test_import_authenticated_notice_export_worker tests.ingestion.test_smoke_authenticated_notice_bootstrap_local_worker`

Observed facts:

- `Ran 10 tests`
- `OK`
- `tests.ingestion.test_authenticated_notice_import` now covers:
  - attachment-backed normalized donor batch without `attachment_blob_root` -> `ValueError`
  - body-only normalized donor batch without `attachment_blob_root` -> success
  - attachment-backed batch with `attachment_blob_root` -> success with attachment object backfill
- worker CLI typed-request tests remain green, so the cleanup stayed inside the core import boundary rather than fragmenting behavior across entrypoints

## Documentation / Planning Checks

Verified by direct file inspection:

- [authenticated-notice-historical-donor-intake-runbook.md](/home/reptilian/code/campus-agent/docs/runbooks/authenticated-notice-historical-donor-intake-runbook.md) explicitly states that missing `attachment_blob_root` is now an import-preflight execution error
- [authenticated-notice-historical-donor-intake-evidence.md](/home/reptilian/code/campus-agent/docs/reference/authenticated-notice-historical-donor-intake-evidence.md) records that local smoke inventory remains routing truth and the old dual-truth mode is no longer allowed
- [post-closeout-follow-up-execution-plan.md](/home/reptilian/code/campus-agent/docs/plans/archive/historical/post-closeout-follow-up-execution-plan.md) records the cleanup as completed
- [.planning/STATE.md](/home/reptilian/code/campus-agent/.planning/STATE.md) no longer lists this mismatch as remaining follow-up

## Final Verdict

- historical donor local-smoke routing mismatch: closed
- contract posture: fail closed
- remaining authenticated-notice follow-up: target chunk-prep / validation acceptance, plus deferred live portal / authenticated control-plane work
