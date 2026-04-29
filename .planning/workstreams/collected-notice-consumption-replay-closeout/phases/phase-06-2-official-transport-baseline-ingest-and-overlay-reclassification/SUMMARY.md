---
doc_type: summary
status: completed
created: 2026-04-29
updated: 2026-04-29
---

<!-- markdownlint-disable MD013 -->

# Phase 6.2 Summary: Official Transport Baseline Ingest And Overlay Reclassification

## Result

Phase 6.2 imported the user-provided transport baseline image through no-write
OCR and produced an official baseline canonical preview.

The baseline is recorded as a local probe only. It has not been mirrored into
object storage, written to DB tables, published as current, embedded, or opened
to query-serving.

The baseline reference date remains `2026-03-01`, but the OCR-visible table
title says `新增班次3月20日起执行`; the canonical baseline `effective_from` is
therefore `2026-03-20`.

## Evidence

Evidence is under:

`evidence/phase-06-2-official-transport-baseline-ingest-and-overlay-reclassification/`

Primary files:

- `official-baseline-canonical-preview.json`
- `official-baseline-consistency-report.json`
- `official-baseline-ocr-probe-report.json`
- `official-baseline-ocr-plain-text.md`
- `transport-batch-reclassified/consumer-admission-manifest.json`
- `transport-batch-reclassified/consistency-report.json`

## Counts

- official baseline canonical rows: `32`
- official baseline route count: `2`
- official baseline projection validation issues: `0`
- transport notice batch entries: `4`
- downstream admitted notice overlays: `1`
- search-only / covered-by-baseline notices: `1`
- needs multimodal overlays: `2`
- OCR execute now: `2`

## Transport Reclassification

- `355122` is `covered_by_official_baseline`, `search_only`, and no longer
  consumes OCR budget.
- `355512` is an expired `temporary_overlay`; it remains a no-write downstream
  stage candidate with `current_eligible=false`.
- `355867` is an active/future `temporary_overlay` and stays
  `needs_multimodal` with `ocr_priority=execute_now`.
- `355881` is an active/future `temporary_overlay` and stays
  `needs_multimodal` with `ocr_priority=execute_now`.

## Boundaries

- No database writes.
- No object-store writes.
- No release publication.
- No current promotion.
- No query-serving opening.

## Next

Phase 6.3 should OCR only the two baseline-aware eligible schedule image
overlays: `355867` and `355881`.
