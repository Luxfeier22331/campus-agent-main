---
doc_type: plan
status: planned
created: 2026-04-30
updated: 2026-04-30
---

<!-- markdownlint-disable MD013 -->

# Phase 3 Plan: Media Role Classifier

## Goal

Classify media by its role in fact extraction, not by presence alone.

## Tasks

1. Add a media role classifier in `packages/ingestion-core`.
2. Inputs:
   - searchable unit title/body text/classification
   - media metadata from source object refs / multimodal candidate inventory
   - existing OCR attempt metadata where available
3. Outputs:
   - media role
   - role confidence
   - media state
   - target fact groups it may carry
   - reason codes
4. Add reports for Phase 1 corpus.
5. Add tests for:
   - schedule table carrier
   - supplemental location visual
   - visual text only
   - QR/reservation instruction
   - owner document
   - unknown/manual review

## Heuristic Boundary

Classifier can be heuristic-first, but must fail conservatively:

- unknown media is not automatically target-blocking.
- unknown media can trigger manual review or target-specific defer.
- if body facts are complete, unknown supplemental media must not erase ready facts.

## Acceptance Criteria

- `355881` image classified as `supplemental_location_visual` or non-required visual evidence.
- `355867` schedule images classified as `schedule_table_carrier`.
- ordinary notice images remain search-only unless target fact requirements say otherwise.

## Verification

```bash
uv run --all-packages python -m unittest tests.ingestion.test_collected_notice_media_role_classifier -q
uv run --all-packages ruff check packages/ingestion-core tests/ingestion
uv run --all-packages ruff format packages/ingestion-core tests/ingestion --check
git diff --check
```
