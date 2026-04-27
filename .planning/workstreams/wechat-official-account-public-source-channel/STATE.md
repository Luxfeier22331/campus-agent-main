---
workstream: wechat-official-account-public-source-channel
created: 2026-04-27
updated: 2026-04-28
---

# Project State

## Current Position

**Status:** Active
**Current Phase:** 12
**Current Phase Name:** Replay, Drift Guard, And Acceptance Closeout
**Current Plan:** `.planning/workstreams/wechat-official-account-public-source-channel/ROADMAP.md`
**Total Phases:** 12
**Progress:** 11/12 phases repo-side implementation complete; Phase 12 remains open for live repair and acceptance evidence
**Last Activity:** 2026-04-28
**Last Activity Description:** Added WeChat notice runtime smoke, historical state audit,
explicit purge CLI, batch-id provenance threading, and post-batch shell closeout.

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
- remaining live/operator work:
  - run audit against historical rows and repair or purge stale metadata-only entries
  - collect fresh live smoke and acceptance evidence on image-heavy and text-heavy samples
  - confirm no remaining pre-fix queryable rows without canonical body/source-truth completeness

## Blockers / Open Questions

- `mp.weixin` raw page access currently works with browser-profile request headers, but
  long-term stability under anti-bot / verification pressure is still an operational risk
- deletion/update synchronization remains deferred; current closeout优先级仍是正确采集与正确消费
- historical bad rows still need one轮 operator audit/repair before this line can fully close

## Session Continuity

**Stopped At:** Repo-side runtime closeout landed; next slice is live audit / repair /
acceptance evidence for Phase 12.
**Resume File:** `.planning/workstreams/wechat-official-account-public-source-channel/README.md`
