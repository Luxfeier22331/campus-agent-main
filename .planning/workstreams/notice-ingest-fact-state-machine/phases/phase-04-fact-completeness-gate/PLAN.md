---
doc_type: plan
status: planned
created: 2026-04-30
updated: 2026-04-30
---

<!-- markdownlint-disable MD013 -->

# Phase 4 Plan: Fact Completeness Gate

## Goal

Build target-specific fact readiness so admission depends on required facts, not whole-notice multimodal state.

## Tasks

1. Add target fact requirement registry:
   - `transport_schedule`
   - `service_status`
   - `regulation`
2. Implement text-first readiness:
   - body text
   - owner text
   - existing OCR text/table output
3. Implement media-required resolution:
   - required fact missing + carrier media pending => `blocked_by_required_media`
   - required fact complete + supplemental media pending => `ready_from_text` plus `supplemental_media_pending`
4. Emit fact readiness reports for corpus.
5. Add tests for body-complete, OCR-complete, mixed-source, partial and missing cases.

## Target Fact Groups

`transport_schedule`:

- route / direction
- service date or effective window
- departure time
- stop or boarding point when required by route semantics

`service_status`:

- service family / subject
- observed status
- time window or observed date
- scope / affected campus or service area when available

`regulation`:

- owner document text
- issuing authority or source lineage
- effective scope when available
- document identity/provenance

## Acceptance Criteria

- Fact readiness for `355881` is `ready_from_text`.
- Fact readiness for `355867` is `blocked_by_required_media` unless OCR rows are supplied.
- Service-status text-complete samples are not blocked by supplemental media.
- Regulation owner document samples require owner text or verified OCR/document extraction.

## Verification

```bash
uv run --all-packages python -m unittest tests.ingestion.test_collected_notice_fact_readiness -q
uv run --all-packages ruff check packages/ingestion-core tests/ingestion
uv run --all-packages ruff format packages/ingestion-core tests/ingestion --check
git diff --check
```
