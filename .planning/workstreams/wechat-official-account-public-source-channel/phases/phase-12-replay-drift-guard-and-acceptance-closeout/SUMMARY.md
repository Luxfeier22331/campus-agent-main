---
phase: "12"
name: "Replay, Drift Guard, And Acceptance Closeout"
status: completed
created: 2026-04-28
updated: 2026-04-30
---

# Phase 12 Summary

## What Closed

- Fixed the live parser gap for modern `mp.weixin` shell pages and Windows Chrome
  browser-profile fetching.
- Captured 3 live FeedWe-discovered articles from `中央民族大学学生会`.
- Materialized real page source-truth plus media objects into source bucket.
- Projected the 3 selected source-truth articles through `wechat_public_notice`.
- Ran default multimodal drain and rebuilt read model.
- Ran runtime smoke with multimodal provider config check.
- Ran post-live historical state audit.

## Acceptance Evidence

- Live capture:
  `evidence/phase-12-replay-drift-guard-and-acceptance-closeout/live-capture-three-decoded-20260430070701.json`
  - `articlesMaterialized=3`
  - `bodyCapturedArticles=3`
  - `mediaCapturedCount=14`
  - `failures=0`
- Projection dry-run:
  `evidence/phase-12-replay-drift-guard-and-acceptance-closeout/projection-dry-run-decoded-20260430070751.json`
  - `projection_entry_count=3`
  - `retained_count=0`
  - `read_model_queryable_count=0`
- Unified shell:
  `evidence/phase-12-replay-drift-guard-and-acceptance-closeout/unified-shell-live-20260430070843.log`
  - projection write succeeded
  - drain processed 11 images
  - `admitted_count=9`
  - `terminal_failure_count=0`
  - runtime smoke `ok=true`
- Provider-check smoke:
  `evidence/phase-12-replay-drift-guard-and-acceptance-closeout/runtime-smoke-provider-check-20260430071654.json`
  - `multimodal_provider_checked=true`
  - `multimodal_provider_ok=true`
  - `source_truth_missing_object_count=0`
  - `projection_entries_missing_admission_count=0`
- State audit:
  `evidence/phase-12-replay-drift-guard-and-acceptance-closeout/state-audit-after-live-20260430071624.json`
  - `projection_entry_count=3`
  - `read_model_entry_count=3`
  - `suspect_unit_count=0`

## Residual Risk

- One image remained pending because the provider returned unsupported confidence.
  This is not a serving leak: runtime smoke confirms it has an attempt, source
  image refs, and remains non-queryable.
- WeChat anti-bot behavior remains operationally unstable and should stay under
  collector monitoring, not query-time runtime.
