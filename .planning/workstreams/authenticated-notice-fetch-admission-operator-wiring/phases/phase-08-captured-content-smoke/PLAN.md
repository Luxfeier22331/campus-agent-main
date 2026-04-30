---
doc_type: plan
phase: phase-08-captured-content-smoke
status: planned
created: 2026-04-30
updated: 2026-04-30
---

<!-- markdownlint-disable MD013 -->

# Phase 8 Plan: Captured Content Smoke

## Goal

Validate already collected authenticated notice content against the hardened
state machine before prioritizing fresh live collector smoke.

## Why This Comes Before Live Collector Smoke

Fresh selected collector smoke mainly proves live auth and collector manifest
consumption. It does not exercise the highest-risk logic changed in Phase 7:
target admission, media lifecycle normalization, closeout provenance, candidate
inventory validation, bytes availability, cleanup gates, and downstream
search-only vs target admission split.

The next proof should therefore replay existing captured source-truth/searchable
content through the current code and inspect outcomes by notice title and body.

## Execution Steps

1. Rebuild current-code searchable/source-truth replay from existing captured
   authenticated notice artifacts.
2. Recompute attachment fetch request manifests from current attachment refs.
3. Rebuild media extraction candidate inventory.
4. Rebuild target fact readiness for transport schedule, service status, and
   regulation candidates.
5. Apply available closeout result manifests for OCR / owner-text outputs.
6. Run quarantine cleanup dry-run against pre-closeout and post-closeout
   inventories.
7. Generate an operator-facing smoke report grouped by notice title:
   downstream admitted, blocked by target media, manual review,
   search-only/discover-only, invalid/deferred, and cleanup-blocking.
8. Confirm known examples match expected routing:
   `355867` remains target-blocking until schedule image OCR closeout;
   discover-only notices do not retain attachments for downstream consumption;
   low-confidence OCR is `manual_review`, not generic failed.

## Acceptance Criteria

- No whole-unit pending media status alone can produce `needs_multimodal`.
- Search-only / discover-only notices do not preserve attachments as downstream
  owner bytes.
- Target-blocking media candidates are preserved until `completed`, `skipped`,
  or `failed_terminal`.
- `manual_review` and `failed_retryable` remain non-terminal and cleanup-blocking
  when `target_blocking=true`.
- Fetch request recompute does not suppress stale object refs unless uploaded /
  downloaded byte availability is proven.
- Smoke output uses titles for review, not only numeric notice ids.

## Verification

```bash
uv run --all-packages python -m unittest \
  tests.ingestion.test_authenticated_notice_state_machine_audit \
  tests.ingestion.test_collected_notice_multimodal_readiness \
  tests.ingestion.test_collected_notice_fact_readiness \
  tests.ingestion.test_collected_notice_media_extraction_closeout \
  tests.ingestion.test_collected_notice_regulation_admission \
  tests.ingestion.test_collected_notice_service_status_downstream_replay \
  tests.ingestion.test_official_transport_baseline_preview -q
```

## Non-Goals

- Do not wait for refreshed portal auth.
- Do not use fresh collector export as the primary acceptance gate.
- Do not promote new serving surfaces from this smoke.
