---
doc_type: plan
status: completed
created: 2026-04-29
updated: 2026-04-29
phase: 4.5
plan: notice-ingest-queue-contract
type: implementation
wave: 1
depends_on:
  - Phase 1
  - Phase 2
  - Phase 4
autonomous: true
---

<!-- markdownlint-disable MD013 -->

# Phase 4.5 Plan: Notice Ingest Queue Contract

## Objective

Freeze the shared ingest queue contract used by both historical captured inventory
and future live collectors. This phase prevents two divergent paths:

- historical inventory imported directly by one-off scripts
- newly discovered notices imported through a separate runtime queue later

The queue contract must sit between capture truth and source-truth/searchable
consumption:

`captured source objects + run ledger -> notice ingest job -> ingestion worker -> source-truth / holding / searchable`

## Canonical References

- `docs/architecture/system/data-plane-architecture.md`
- `docs/architecture/domains/authenticated-notice/architecture.md`
- `docs/data/authenticated-notice-source-truth-schema.md`
- `docs/decisions/adr-0024-authenticated-notice-source-channel.md`
- `docs/decisions/adr-0002-local-minio-conventions.md`
- `.planning/workstreams/collected-notice-consumption-replay-closeout/phases/phase-02-chain-contract-and-admission-design/CHAIN-CONTRACT.md`
- `.planning/workstreams/collected-notice-consumption-replay-closeout/phases/phase-04-dry-run-reimport-and-universal-search-preview/PLAN.md`

## Inputs

- Phase 1 `captured-runs-inventory.json`
- Phase 4 `reimport-plan.dry-run.json`
- Phase 4 `source-truth-preview.json`
- Phase 4 `searchable-notice-preview.json`
- Existing object-native collector run ledger and source object refs

## Non-Goals

- No scheduler, cron, webhook, or live polling rollout.
- No authentication renewal or credential lifecycle design.
- No queue store migration in this phase; Phase 4.6 owns PG persistence.
- No source-truth, object-store, or downstream writes.
- No regulation / schedule / status target admission execution.

## Tasks

1. [x] Define `notice_ingest` job schema.
   - Required fields:
     - `job_id`
     - `job_kind=notice_ingest`
     - `source_channel`
     - `source_surface`
     - `source_identity`
     - `capture_id`
     - `capture_manifest_object_ref`
     - `content_hash`
     - `run_id`
     - `enqueue_source`
     - `replay_batch_id`
     - `priority`
     - `idempotency_key`
   - Explicitly forbid large body/html/attachment payloads in the job.
2. [x] Define idempotency key rules.
   - Internal notice: `source_channel + source_surface + site_id + source_notice_id + content_hash`.
   - File release: `source_channel + source_surface + file_release_id + content_hash`.
   - WeChat and official-web can reuse the same shape later with canonical URL/article identity.
3. [x] Define queue state machine.
   - `queued`
   - `leased`
   - `succeeded`
   - `failed_retryable`
   - `failed_terminal`
   - `dead_letter`
4. [x] Define retry, terminal failure, and replay semantics.
   - Retry must not change `idempotency_key`.
   - Manual replay must create a new `replay_batch_id`, not mutate old evidence.
   - Terminal failures must retain source refs and reason codes.
5. [x] Add contract docs and fixtures.
   - `NOTICE-INGEST-QUEUE-CONTRACT.md`
   - schema fixture covering `historical_backfill`, `live_discovery`, and `manual_replay`.
6. [x] Add focused tests for job normalization and validation.
   - Empty object refs fail.
   - Body payload fields fail.
   - Same source/content yields stable idempotency key.
   - Different content hash yields a new ingest job version.

## Expected File Scope

- `packages/ingestion-core/src/campus_ingestion_core/collected_notice_ingest_queue.py`
- `tests/ingestion/test_collected_notice_ingest_queue.py`
- `.planning/workstreams/collected-notice-consumption-replay-closeout/phases/phase-04-5-notice-ingest-queue-contract/NOTICE-INGEST-QUEUE-CONTRACT.md`
- `.planning/workstreams/collected-notice-consumption-replay-closeout/phases/phase-04-5-notice-ingest-queue-contract/fixtures/`

## Verification

```bash
uv run --all-packages python -m unittest tests.ingestion.test_collected_notice_ingest_queue
uv run --all-packages ruff check packages/ingestion-core/src/campus_ingestion_core/collected_notice_ingest_queue.py tests/ingestion/test_collected_notice_ingest_queue.py
uv run --all-packages ruff format --check packages/ingestion-core/src/campus_ingestion_core/collected_notice_ingest_queue.py tests/ingestion/test_collected_notice_ingest_queue.py
pnpm exec markdownlint-cli2 ".planning/workstreams/collected-notice-consumption-replay-closeout/**/*.md"
pnpm docs:lint
git diff --check
```

## Success Criteria

- [x] Historical backfill, live discovery, and manual replay share one queue job contract.
- [x] Jobs carry object refs and identity only, not notice body or attachment bytes.
- [x] Idempotency is deterministic and content-version aware.
- [x] The next phase can implement a PG-backed queue without re-deciding schema semantics.
