---
workstream: wechat-official-account-public-source-channel
created: 2026-04-27
updated: 2026-04-30
---

# Project State

## Current Position

**Status:** Completed
**Current Phase:** 12 completed
**Current Phase Name:** Replay, Drift Guard, And Acceptance Closeout
**Current Plan:** `.planning/workstreams/wechat-official-account-public-source-channel/ROADMAP.md`
**Total Phases:** 12
**Progress:** 12/12 phases complete
**Last Activity:** 2026-04-30
**Last Activity Description:** Fixed modern mp.weixin shell parsing, reran live
FeedWe discovery plus real page/media capture, projected selected source-truth
through notice consumption, drained multimodal OCR, ran runtime smoke with
provider check, and closed historical state audit.

## Current Slice

- historical `Phase 1-6` closeout claim that FeedWe detail/download surfaces were
  sufficient body truth remains superseded
- repo-side canonical chain is now closed around:
  `FeedWe discovery -> real mp.weixin article URL -> canonical source-truth -> notice consumption`
- implemented closeout surfaces:
  - projection metadata now carries `consumer_admission_batch_id`
  - multimodal drain reprojects with fresh batch provenance
  - `campus-ingestion-smoke-wechat-public-notice-runtime`
    validates admission provenance, read-model consistency, source-truth object completeness,
    queryable-body gate, and pending multimodal attempt/image posture
  - `campus-ingestion-audit-wechat-public-notice-state`
    produces read-only suspect-state classification plus repair selection JSON
  - `campus-ingestion-purge-wechat-public-notices`
    supports explicit projection/read-model purge for unrecoverable rows
  - `scripts/run-wechat-public-notices.sh`
    now closes with projection -> optional multimodal drain -> runtime smoke
- Phase 12 live/operator closeout:
  - live capture selected 3 FeedWe-discovered `中央民族大学学生会` articles
  - source bucket contains real page HTML, source-truth, media refs, and media objects
  - projection wrote 3 `wechat_public_notice` rows and 3 read-model rows
  - multimodal drain attempted 11 images, admitted 9, left 1 pending, with 0 terminal failures
  - runtime smoke passed with provider config check and no missing source-truth objects
  - historical state audit reports `suspect_unit_count=0`

## Blockers / Open Questions

- `mp.weixin` raw page access remains an operational risk under anti-bot / verification pressure.
- deletion/update synchronization remains deferred outside this workstream.
- one live image remains pending due unsupported provider confidence, but runtime smoke confirms
  it has an attempt and remains non-queryable.

## Session Continuity

**Stopped At:** Phase 12 closeout completed. Reopen only if FeedWe/page shape
drift breaks source-truth capture, queryable gate regresses, or new WeChat
source-family serving admission is requested.
**Resume File:** `.planning/workstreams/wechat-official-account-public-source-channel/README.md`
