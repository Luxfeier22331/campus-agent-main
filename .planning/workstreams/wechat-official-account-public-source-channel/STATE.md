---
workstream: wechat-official-account-public-source-channel
created: 2026-04-27
updated: 2026-04-27
---

# Project State

## Current Position

**Status:** Completed
**Current Phase:** closeout
**Current Phase Name:** Notice Source-family Serving Admission Complete
**Current Plan:**
`.planning/workstreams/wechat-official-account-public-source-channel/phases/phase-6-notice-source-family-serving-admission/SUMMARY.md`
**Total Phases:** 6
**Progress:** 6/6 phases complete
**Last Activity:** 2026-04-27
**Last Activity Description:** Reopened closeout to replace metadata-only
source-truth with real `mp.weixin.qq.com` page capture. FeedWe now remains
discovery-only, captured-body rows materialize canonical markdown into the
notice read model, and only captured-body rows are queryable.

## Current Slice

- Workstream lifecycle is complete.
- `wechat_public_notice` is a notice `source_family`, not a separate runtime or
  tool.
- Local smoke used completed capture run
  `wcrun_5e6910a81e714fcda0e44dfc2b1bda9c` and materialized one retained
  queryable read-model row for
  `woa_article_1335feaf76d3fc90b63b3999`.
- Go `supervisor-api` internal notice endpoints returned:
  - `campus_notice_discover`: `outcome=resolved_current`
  - `campus_notice_get`: `outcome=resolved_current`
  - source URL:
    `https://mp.weixin.qq.com/s/I_0ji-iVJWm_ukb6UNDMiw`

## Blockers / Open Questions

- FeedWe rate limits, retention guarantees, account scoping, deletion/update
  semantics, and SLA are still deferred risks for production scheduling.
- The physical read model table is still named `internal_notice_read_model`;
  Phase 6 may use it because the schema is source-family capable, but the name
  should not define the long-term domain boundary.
- Live closeout evidence should be refreshed after the captured-page pipeline
  replay so the workstream archive points at post-capture acceptance output.

## Session Continuity

**Stopped At:** Workstream complete. Reopen only for provider contract changes,
deletion/update synchronization, or a new explicit notice source-family serving
policy change.
**Resume File:**
`.planning/workstreams/wechat-official-account-public-source-channel/README.md`
