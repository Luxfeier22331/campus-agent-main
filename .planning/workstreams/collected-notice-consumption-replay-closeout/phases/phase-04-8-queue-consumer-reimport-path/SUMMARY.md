---
doc_type: summary
status: completed
created: 2026-04-29
updated: 2026-04-29
phase: 4.8
---

<!-- markdownlint-disable MD013 -->

# Phase 4.8 Summary: Queue Consumer Reimport Path

## Result

Implemented the first queue consumer path for collected notice replay.

The worker can now:

- lease `notice_ingest` jobs with optional `replay_batch_id` filtering;
- load collector bundle / manifest object refs from the job payload;
- reuse the Phase 4 reimport preview path to build source-truth candidates and searchable units;
- keep dry-run no-write semantics;
- complete execute-mode jobs only after an explicit writer reports success;
- mark missing input refs as terminal failures and missing source objects as retryable failures;
- emit trace, failed-job, and searchable coverage evidence.

Downstream admission remains out of scope for this phase.

## Implemented Files

- `packages/ingestion-core/src/campus_ingestion_core/collected_notice_queue_consumer.py`
- `apps/ingestion-worker/src/campus_ingestion_worker/consume_collected_notice_ingest_queue.py`
- `tests/ingestion/test_collected_notice_queue_consumer.py`
- `tests/ingestion/test_consume_collected_notice_ingest_queue_worker.py`

## Evidence

Generated under:

`.planning/workstreams/collected-notice-consumption-replay-closeout/evidence/phase-04-8-queue-consumer-reimport-path/`

Files:

- `queue-consume.dry-run.json`
- `queue-consume.trace.json`
- `queue-consume-failed-report.json`
- `searchable-coverage-after-queue-consume.json`

Dry-run counts:

- leased jobs: `25`
- projected jobs: `25`
- searchable units: `25`
- source-truth candidates: `25`
- failed jobs: `0`
- completed jobs: `0`
- downstream admission rows: `0`
- coverage verdict: `passed`

The evidence used the Phase 4.7 historical enqueue plan as an in-memory dry-run queue seed because Phase 4.7 intentionally did not execute PG enqueue.

## Execute Boundary

Execute mode is implemented as a writer-gated path: the consumer completes a job only after a configured `CollectedNoticeQueueConsumeWriter` succeeds. The default worker does not silently install a no-op writer, so production execute must provide a real writer before queue jobs can be marked succeeded.

## Next Phase

Continue with Phase 6R.1 regulation candidate audit and admission using queue-backed searchable evidence. Transport baseline-dependent work remains blocked until the official `2026-03-01` schedule baseline arrives.
