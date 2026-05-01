---
doc_type: plan
status: complete
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 5 Plan: No-Promotion Preview Batch

## Goal

Allow target-level no-promotion preview commands to resolve inventory entries without opening broad
crawl.

## Tasks

1. Add `--inventory-id` to `scripts/official_web_live_seam_no_promotion.py`.
2. Resolve target id, target URL and host from `target-inventory.json`.
3. Keep old explicit flags working for debug and compatibility.
4. Add unittest coverage for inventory-id resolution.

## Verification

- `uv run --all-packages python -m unittest tests.ingestion.test_official_web_live_seam_no_promotion_script`
