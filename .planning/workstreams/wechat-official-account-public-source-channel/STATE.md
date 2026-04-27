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
**Last Activity Description:** Completed Phase 6. `wechat_public_notice` is now
served through the unified `campus_notice_discover/get` source-family policy,
retained projection rows are materialized into the notice read model, and
public notice get supports `reference_only=true` when no captured body exists.

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
  - `campus_notice_get`: `outcome=resolved_current`, `reference_only=true`
  - source URL:
    `https://mp.weixin.qq.com/s/I_0ji-iVJWm_ukb6UNDMiw`

## Blockers / Open Questions

- FeedWe rate limits, retention guarantees, account scoping, deletion/update
  semantics, and SLA are still deferred risks for production scheduling.
- The physical read model table is still named `internal_notice_read_model`;
  Phase 6 may use it because the schema is source-family capable, but the name
  should not define the long-term domain boundary.
- WeChat article body capture remains deferred; serving is intentionally
  reference-only until a body-capture source-truth contract is admitted.

## Session Continuity

**Stopped At:** Workstream complete. Reopen only for provider contract changes,
WeChat body capture, deletion/update synchronization, or a new explicit notice
source-family serving policy change.
**Resume File:**
`.planning/workstreams/wechat-official-account-public-source-channel/README.md`
