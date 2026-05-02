---
workstream: authenticated-notice-run-level-operator-view
status: completed
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Project State

## Current Position

**Status:** Completed
**Current Phase:** Phase 6 selected notice canary completed
**Last Activity:** 2026-05-01
**Last Activity Description:** Fixed selected source-truth-only notice processing
projection identity propagation and verified real selected canary notice `355959`.

## Completed In Current Worktree

- `apps/app-api` owns
  `operator.authenticated_notice_run_processing_projection` and
  `operator.authenticated_notice_run_processing_event_projection`.
- `apps/app-api` exposes internal snapshot ingest and operator list/detail
  routes for run-processing.
- `packages/ingestion-core` builds sanitized run-processing snapshots from
  queue records and queue-consumer trace rows.
- `apps/ingestion-worker` can report run-processing snapshots from queue
  consumer execution and historical backfill.
- `apps/protected-panel-web` exposes `authenticatedNoticeRunProcessing` as a
  read-only resource.
- Source-truth-only collector runs now use `import_result.notice_count` and
  related aggregate counts, so the real run `20260428T181953007Z` does not
  render as a zero-notice run.
- Selected source-truth-only runs now preserve sanitized `selected_notice_ids`
  and selected notice title summaries through queue-consumer trace summaries, so
  notice-level processing projection is reported even when downstream
  materialization is intentionally skipped.

## Real Sample Result

- collector run token: `20260428T181953007Z`
- run id: `muc_internal_portal:notice:20260428T181953007Z`
- queue job id:
  `authenticated_notice_ingest_job:cf7648ac1c5709c57b356e24`
- lifecycle status: `succeeded`
- latest queue status: `succeeded`
- source-truth-only import: `true`
- imported notice count: `282`
- attachment fetch-status record count: `305`
- downstream status: `skipped_source_truth_only`

Evidence:

- `evidence/phase-05-real-sample-20260428T181953007Z/acceptance-summary.json`
- `evidence/phase-05-real-sample-20260428T181953007Z/run-processing-snapshot.json`
- `evidence/phase-05-real-sample-20260428T181953007Z/source-evidence-summary.json`

## Phase 6 Selected Canary Result

- notice id: `355959`
- title: `新闻与传播学院科级以下岗位聘用工作安排的通知`
- run id:
  `muc_internal_portal:notice:20260428T180931937Z:canary2:355959:20260501T171611Z`
- queue job id:
  `authenticated_notice_ingest_job:0c168aedfc719fde71a3e6e1`
- queue terminal state: `succeeded`
- source-truth-only import: `true`
- imported notice count: `1`
- per-notice processing projection: `reported`, snapshot count `1`
- run-level processing projection: `reported`, snapshot count `1`
- smoke verdict: `passed`
- medium-or-higher findings: `0`

Evidence:

- `evidence/phase-06-canary-355959-20260501T171611Z/source-truth-only-smoke-summary.json`
- `evidence/phase-06-canary-355959-20260501T171611Z/source-truth-only-smoke/authenticated-notice-ingest-queue-e2e-smoke.json`
- `evidence/phase-06-canary-355959-20260501T171611Z/replay-ledger/authenticated-notice-smoke-replay-run.execute.json`

## Verification

Targeted verification to rerun before merge:

```bash
uv run --all-packages python -m unittest tests.ingestion.test_authenticated_notice_run_processing_projection tests.ingestion.test_authenticated_notice_run_processing_projection_backfill tests.ingestion.test_authenticated_notice_run_processing_projection_reporter tests.ingestion.test_backfill_authenticated_notice_run_processing_projection_worker tests.ingestion.test_consume_authenticated_notice_ingest_queue_worker tests.ingestion.test_authenticated_notice_run_queue_consumer.AuthenticatedNoticeRunQueueConsumerTest.test_execute_reports_operator_run_processing_projection
pnpm --dir apps/app-api exec vitest run -c vitest.node.config.mts test/authenticated-notice-run-processing.service.test.ts test/authenticated-notice-run-processing.route.test.ts test/authenticated-notice-run-processing.store.test.ts
pnpm --dir apps/protected-panel-web exec vitest run -c vitest.node.config.mts test/data-provider.authenticated-notice-run-processing.suite.ts test/authenticated-notice-run-processing-ui.test.ts test/worker.operator-domains.suite.ts
pnpm --dir apps/app-api typecheck
pnpm --dir apps/protected-panel-web typecheck
pnpm docs:lint
git diff --check
```

## Reopen Rule

Reopen only if app-api run-processing projection stops accepting sanitized
snapshots, protected-panel starts reading raw ingestion truth directly, run-level
source-truth-only counts regress, selected source-truth-only notices stop
producing notice-level processing snapshots, or a write/action collector
control-plane is admitted as a separate product requirement.
