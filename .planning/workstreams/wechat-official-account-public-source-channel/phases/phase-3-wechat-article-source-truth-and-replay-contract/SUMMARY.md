---
doc_type: summary
status: completed
created: 2026-04-27
updated: 2026-04-27
---

# Phase 3 Summary: WeChat Article Source-truth And Replay Contract

## Outcome

Phase 3 is implemented. FeedWe history metadata is now normalized into
provider-agnostic `wechat_official_account` article source-truth artifacts.
The collector writes those artifacts during capture, and the replay path can
rebuild them from provider-response JSONL.

## Implemented

- Added `wechat-official-account-core`.
- Added article identity, version hash, publish time, media ref, and validator
  helpers.
- Added source-truth artifacts:
  - `source-truth/article-manifest.json`
  - `source-truth/content-blocks.jsonl`
  - `source-truth/media-refs.jsonl`
- Added collector replay support for provider-response JSONL.
- Extended app-api artifact guard to accept source-truth refs and continue
  rejecting projections.
- Added `docs/data/wechat-official-account-source-truth-schema.md`.

## Boundaries

- Article body capture is not part of Phase 3.
- `bodyState` is explicitly `not_captured`.
- Notice projection and query-serving stay closed until Phase 4/5.
