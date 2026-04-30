---
phase: "10"
name: "Notice Consumption Gate Re-hardening"
status: completed
created: 2026-04-28
updated: 2026-04-30
---

# Phase 10 Summary

## What Closed

- WeChat projection now consumes explicit source-truth refs from selection,
  manifest key, or capture-run selection.
- Captured notices with pending inline-image OCR remain non-queryable and target
  `multimodal_processing_candidate`.
- Projection and read-model rows carry source-truth provenance and admission
  batch metadata.

## Acceptance Evidence

- `projection-dry-run-decoded-20260430070751.json`:
  `article_count=3`, `projection_entry_count=3`, `retained_count=0`,
  `read_model_queryable_count=0`, all entries `pending_multimodal_processing`.
