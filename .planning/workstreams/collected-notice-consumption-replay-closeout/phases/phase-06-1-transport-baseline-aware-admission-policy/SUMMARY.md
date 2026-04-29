---
doc_type: summary
status: completed
created: 2026-04-29
updated: 2026-04-29
---

<!-- markdownlint-disable MD013 -->

# Phase 6.1 Summary: Transport Baseline-Aware Admission Policy

## Result

Phase 6.1 is implemented as a no-write admission policy update. Transport schedule admission now records baseline status, temporal relation, overlay kind, OCR priority, current eligibility, and baseline gate reasons.

The current baseline state is `missing`, so schedule-image notices are not sent to OCR yet. They are preserved as `needs_multimodal` with `ocr_priority=defer_until_baseline`.

## Evidence

Policy:

- `TRANSPORT-BASELINE-AWARE-ADMISSION-POLICY.md`

Refreshed evidence:

- `.planning/workstreams/collected-notice-consumption-replay-closeout/evidence/phase-06-batched-downstream-replay/batch-transport-schedule/consumer-admission-manifest.json`
- `.planning/workstreams/collected-notice-consumption-replay-closeout/evidence/phase-06-batched-downstream-replay/batch-transport-schedule/rejected-deferred-source-report.json`
- `.planning/workstreams/collected-notice-consumption-replay-closeout/evidence/phase-06-batched-downstream-replay/pilot-transport-schedule-355512/consumer-admission-manifest.json`

## Batch Counts

- candidate entries: `4`
- downstream admitted: `1`
- needs multimodal: `3`
- OCR execute now: `0`
- OCR defer until baseline: `3`
- historical search only: `0`
- stage candidate count: `1`
- consistency verdict: `passed`

## Verification Commands

Focused red/green tests:

```bash
uv run --all-packages python -m unittest tests.ingestion.test_collected_notice_downstream_pilot
uv run --all-packages python -m unittest tests.ingestion.test_preview_collected_notice_downstream_pilot_worker
```

Evidence refresh:

```bash
uv run --all-packages python -m campus_ingestion_worker.preview_collected_notice_downstream_pilot --mode batch
uv run --all-packages python -m campus_ingestion_worker.preview_collected_notice_downstream_pilot
```

## Next

Phase 6.2 is blocked on the official `2026-03-01` transport baseline file. After it is provided, import the baseline as the current schedule base and reclassify `baseline_delta_candidate`, `temporary_overlay`, `temporary_exception`, and `historical_search_only` entries before running any schedule-image OCR mini batch.
