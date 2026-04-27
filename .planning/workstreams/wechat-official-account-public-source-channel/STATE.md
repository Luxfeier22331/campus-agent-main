---
workstream: wechat-official-account-public-source-channel
created: 2026-04-27
updated: 2026-04-27
---

# Project State

## Current Position

**Status:** Active
**Current Phase:** Phase 4
**Current Phase Name:** Notice Consumption Projection Opening
**Current Plan:**
`.planning/workstreams/wechat-official-account-public-source-channel/phases/phase-4-notice-consumption-projection-opening/PLAN.md`
**Total Phases:** 5
**Progress:** 3/5 phases complete
**Last Activity:** 2026-04-27
**Last Activity Description:** Completed Phase 3. FeedWe history metadata now
replays into provider-agnostic `wechat_official_account` article source-truth
artifacts, app-api accepts source-truth refs, and query-serving remains closed.

## Current Slice

- Implement Phase 4 notice consumption projection opening from the planned
  `wechat_public_notice` source-family contract.
- Materialize WeChat source-truth into offline notice-consumption projection
  candidates with deterministic dedupe.
- Keep query-serving closed until read-model, dedupe, and leakage evidence exist.

## Blockers / Open Questions

- FeedWe rate limits, retention guarantees, account scoping, deletion/update
  semantics, and SLA must be verified before production scheduling.
- Notice runtime source-family contract currently has `official_web_public_notice`
  and `internal_notice_restricted`; `wechat_public_notice` must be introduced
  deliberately in Phase 4.
- Downstream public notice query-serving must remain closed until read-model and
  leakage/dedupe evidence exist.

## Session Continuity

**Stopped At:** Phase 3 completed; Phase 4 planning pending.
**Resume File:**
`.planning/workstreams/wechat-official-account-public-source-channel/README.md`
