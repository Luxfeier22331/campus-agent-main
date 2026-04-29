---
doc_type: plan
status: completed
created: 2026-04-27
updated: 2026-04-27
---

# Phase 3: WeChat Article Source-truth And Replay Contract

## Goal

Freeze and implement metadata-first source-truth for public WeChat official
account articles. FeedWe remains acquisition only; source-truth becomes the
repo-owned replay boundary.

## Implementation

- Add a TS core package for `wechat_official_account` article source-truth.
- Normalize FeedWe history article metadata into provider-agnostic manifest,
  content block, and media ref artifacts.
- Write source-truth artifacts during capture and through replay from provider
  response JSONL.
- Allow app-api run ledger to accept source-truth artifact refs while still
  rejecting projection and query-serving artifacts.
- Document that Phase 3 does not capture article body HTML and records
  `bodyState: "not_captured"`.

## Acceptance

- Source-truth object keys follow ADR-0002 source prefix conventions.
- `rawVersionId` is stable for unchanged metadata and independent of capture
  time.
- App-api stores artifact refs only, not provider bytes.
- No notice projection, read model, document registry, Qdrant, or query-serving
  opening is added.
