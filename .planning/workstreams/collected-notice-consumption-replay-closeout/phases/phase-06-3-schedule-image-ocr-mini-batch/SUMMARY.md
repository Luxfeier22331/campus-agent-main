---
doc_type: summary
status: completed
created: 2026-04-29
updated: 2026-04-29
---

<!-- markdownlint-disable MD013 -->

# Phase 6.3 Summary: Schedule Image OCR Mini Batch

## Result

Phase 6.3 completed a no-write baseline-aware schedule image OCR mini batch.

- Selected source notices: `355867`, `355881`
- Selected image count: `4`
- OCR provider calls: enabled for this dry-run
- DB writes: disabled
- Object-store writes: disabled
- Release/current promotion: disabled

## Evidence

Evidence directory:

`evidence/phase-06-3-schedule-image-ocr-mini-batch/`

Key files:

- `schedule-image-ocr-execution-manifest.json`
- `schedule-image-ocr-evidence-inventory.json`
- `schedule-image-ocr-gap-report.json`
- `ocr-dry-run/*/image-*/manifest.json`
- `ocr-dry-run/*/image-*/ocr-result.json`
- `ocr-dry-run/*/image-*/tables.json`
- `post-run-preview/schedule-image-ocr-searchable-merge-preview.json`
- `post-run-preview/transport-ocr-replay.dry-run.json`
- `post-run-preview/transport-ocr-stage-report.json`
- `post-run-preview/transport-ocr-consistency-report.json`
- `post-run-preview/schedule-image-ocr-post-run-gap-report.json`

## OCR Outcome

- `355867` image 1: processed, medium confidence, extractable schedule table.
- `355867` image 2: processed, medium confidence, extractable schedule table.
- `355867` image 3: processed, low confidence, rejected from transport stage.
- `355881` image 1: processed, low confidence, rejected from transport stage.

## Transport Replay Outcome

- Extracted transport rows: `32`
- Stage candidates: `32`
- Consistency verdict: `passed`
- Rows by notice:
  - `355867`: `32`
  - `355881`: `0`
- Rows by route:
  - `route:haidian-to-fengtai`: `16`
  - `route:fengtai-to-haidian`: `16`
- Service windows:
  - `2026-04-27` to `2026-04-27`: `24`
  - `2026-04-28` to `2026-05-05`: `8`

## Remaining Review

The post-run gap report remains `requires_review` because two images were processed but rejected:

- `355867` image 3: `low_confidence`
- `355881` image 1: `low_confidence`

These rejected images were not staged downstream.
