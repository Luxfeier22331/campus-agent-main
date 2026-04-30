---
phase: "8"
name: "Discovery-To-Page Capture Pipeline"
status: completed
created: 2026-04-28
updated: 2026-04-30
---

# Phase 8 Summary

## What Closed

- Collector now writes FeedWe provider response, real page fetch metadata,
  captured HTML, parser extraction, source-truth artifacts, and media objects
  under `wechat_official_account/...`.
- Source-truth materialization uses the real page capture result.
- Media capture happens at collection time, not deferred until OCR.

## Acceptance Evidence

- `evidence/phase-12-replay-drift-guard-and-acceptance-closeout/live-capture-three-decoded-20260430070701.json`
  recorded 3 materialized articles, 3 captured bodies, 14 captured media items,
  and 0 failures.
