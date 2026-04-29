---
doc_type: summary
status: completed
created: 2026-04-29
updated: 2026-04-29
---

<!-- markdownlint-disable MD013 -->

# Phase 4.5 Summary: Notice Ingest Queue Contract

## Result

Phase 4.5 froze the `notice_ingest` queue contract used by historical captured
inventory, future live discovery, and manual replay.

This phase did not implement a PG queue store, enqueue historical inventory,
consume jobs, write source-truth, write object storage, or run downstream
admission.

## Delivered

- `NOTICE-INGEST-QUEUE-CONTRACT.md`
- `packages/ingestion-core/src/campus_ingestion_core/collected_notice_ingest_queue.py`
- `tests/ingestion/test_collected_notice_ingest_queue.py`
- fixtures:
  - `fixtures/historical-backfill.notice-ingest-job.json`
  - `fixtures/live-discovery.notice-ingest-job.json`
  - `fixtures/manual-replay.notice-ingest-job.json`

## Contract

- `job_kind=notice_ingest`
- `enqueue_source` values:
  - `historical_backfill`
  - `live_discovery`
  - `manual_replay`
- queue states:
  - `queued`
  - `leased`
  - `succeeded`
  - `failed_retryable`
  - `failed_terminal`
  - `dead_letter`

Jobs carry object refs and identity only. They reject body text, raw HTML,
attachments, attachment bytes, OCR payloads, and content blocks.

## Verification

```bash
uv run --all-packages python -m unittest tests.ingestion.test_collected_notice_ingest_queue
```
