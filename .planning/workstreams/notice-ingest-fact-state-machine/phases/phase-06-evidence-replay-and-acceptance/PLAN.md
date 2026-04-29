---
doc_type: plan
status: planned
created: 2026-04-30
updated: 2026-04-30
---

<!-- markdownlint-disable MD013 -->

# Phase 6 Plan: Evidence Replay And Acceptance

## Goal

Replay the fixed corpus and produce acceptance evidence for source/media/fact/target behavior.

## Tasks

1. Build `fact-state-machine-replay.json`.
2. Build target acceptance reports:
   - `transport-schedule-acceptance.json`
   - `service-status-acceptance.json`
   - `regulation-acceptance.json`
3. Build `source-to-media-to-fact-to-target-trace.json`.
4. Build `acceptance-summary.json`.
5. Verify no dry-run path wrote DB/object store/release/current truth.

## Acceptance Criteria

- Corpus coverage is 100% for required samples.
- `355881` verdict is passed with 7 text-primary rows.
- `355867` verdict is passed as OCR-primary/required-media case.
- service-status and regulation behave according to their target contracts.
- ordinary image notices stay searchable and do not become target-blocking false positives.

## Verification

```bash
uv run --all-packages python -m unittest discover -s tests/ingestion -t . -q
uv run --all-packages ruff check packages/ingestion-core apps/ingestion-worker tests/ingestion
uv run --all-packages ruff format packages/ingestion-core apps/ingestion-worker tests/ingestion --check
git diff --check
```
