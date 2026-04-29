# 12-01 Summary

## Outcome

- Phase 12 is now a formal `.planning` workstream instead of only an architecture/plan handoff.
- The repo-native authenticated-notice bootstrap foundation is now explicit: collection config, importer/source-truth builder, worker smoke CLI, collector runtime scaffold, and runbook all point at the same `authenticated_notice_portal -> campus_notices/internal_notice` direction.
- Fresh verification confirms the current foundation can consume real historical exports without depending on live portal access.

## Main Changes

- `.planning/phases/12-authenticated-notice-source-foundation/12-CONTEXT.md`
  - freezes the phase boundary, locked posture, current implementation truth, and next workstreams
- `.planning/phases/12-authenticated-notice-source-foundation/12-RESEARCH.md`
  - records what is already landed, what is still missing, and why historical replay is the next execution substrate
- `.planning/phases/12-authenticated-notice-source-foundation/12-01-PLAN.md`
  - formalizes the first already-landed slice as completed phase work
- existing repo truth explicitly recognized by this slice:
  - `configs/ingestion/campus_notices/internal_notice/*`
  - `packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_import.py`
  - `packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_source_truth.py`
  - `apps/ingestion-worker/src/campus_ingestion_worker/smoke_authenticated_notice_bootstrap.py`
  - `apps/authenticated-notice-collector/*`
- verified contract/config coverage explicitly included in this slice:
  - `tests/ingestion/test_collection_config.py`
  - `tests/ingestion/test_corpus_runtime_profile.py`
  - `tests/ingestion/test_authenticated_notice_import.py`
  - `tests/ingestion/test_import_authenticated_notice_export_worker.py`
  - `tests/ingestion/test_smoke_authenticated_notice_bootstrap_worker.py`

## Verification

- `pnpm --dir apps/authenticated-notice-collector test`
  - pass (`6` files, `11` tests)
- `pnpm --dir apps/authenticated-notice-collector typecheck`
  - pass
- `pnpm --dir apps/authenticated-notice-collector build`
  - pass
- `uv run --package campus-ingestion-worker python -m unittest tests.ingestion.test_collection_config tests.ingestion.test_corpus_runtime_profile tests.ingestion.test_authenticated_notice_import tests.ingestion.test_import_authenticated_notice_export_worker tests.ingestion.test_smoke_authenticated_notice_bootstrap_worker`
  - pass (`15` tests)
- real historical sample smoke
  - command: `uv run --package campus-ingestion-worker python -m campus_ingestion_worker.smoke_authenticated_notice_bootstrap --bundle-path /tmp/notices-bundle-sample-1.json --manifest-path /home/reptilian/code/rag-data/muc-notice-collector/runtime/exports/export-manifest-20260403-run-2.json --site-id muc_internal_portal --source-home-url https://my.muc.edu.cn --expect-notice-count 1`
  - pass
  - result: `notice_count=1`, `raw_reused_count=1`, `skipped_document_ids=["notice:muc_internal_portal:355385"]`, `errors=[]`

## Next Slice

- `12-02` should execute staged historical replay beyond the one-record sample, starting from bounded slices before attempting the larger `run-2` / `run-14` exports.
- `12-03` should tighten collector output and attachment/object reference semantics toward the repo-native long-term shape while keeping bootstrap compatibility.
