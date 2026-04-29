---
doc_type: plan
status: planned
created: 2026-04-29
updated: 2026-04-29
---

<!-- markdownlint-disable MD013 -->

# Phase 6.2 Plan: Official Transport Baseline Ingest And Overlay Reclassification

## Goal

用户提供官方 `2026-03-01` 车次表后，将它作为 transport schedule current
baseline 基底。notice-derived schedule 内容只作为 delta / exception /
temporary overlay，不直接替代 baseline。

## Inputs

- 官方 `2026-03-01` 车次表 source file
- Phase 6.1 baseline-aware admission policy
- Phase 4 searchable preview
- Phase 5 multimodal readiness evidence
- Phase 6 transport batch evidence

## Target Shape

Baseline source 进入 transport schedule projection 时必须表达：

- `source_kind=official_baseline`
- `effective_from=2026-03-01`
- route / direction / departure / rider type / calendar truth
- source object refs
- release candidate id
- no current promotion by default

Notice-derived overlays 必须表达：

- `source_kind=notice_delta`
- `overlay_kind`
- `applies_to_baseline_effective_date`
- `service_date_ranges`
- `current_eligible=false` unless explicitly opened later

## Tasks

1. Add baseline source ingestion dry-run path for the official table.
2. Generate baseline release candidate evidence.
3. Reclassify existing transport notice candidates relative to `2026-03-01`.
4. Split notice-derived records into:
   - `baseline_delta_candidate`
   - `temporary_overlay`
   - `temporary_exception`
   - `historical_search_only`
   - `manual_review`
5. Refresh transport batch evidence with baseline available.
6. Keep current promotion disabled.

## Acceptance

- Official baseline is the only current schedule base candidate.
- Historical notice content cannot overwrite baseline by default.
- Temporary overlays require explicit service windows.
- Missing/ambiguous windows go to manual review.
- Baseline and overlay evidence both preserve source object refs.

## Verification

```bash
uv run --all-packages python -m unittest tests.ingestion.test_transport_schedule_projection tests.ingestion.test_notice_derived_transport_schedule_materialization
uv run --all-packages python -m unittest tests.ingestion.test_collected_notice_downstream_pilot tests.ingestion.test_preview_collected_notice_downstream_pilot_worker
uv run --all-packages ruff check packages/ingestion-core/src/campus_ingestion_core
uv run --all-packages ruff format . --check
pnpm docs:lint
git diff --check
```
