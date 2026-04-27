---
workstream: wechat-official-account-public-source-channel
created: 2026-04-27
updated: 2026-04-28
---

# Project State

## Current Position

**Status:** Active
**Current Phase:** 7
**Current Phase Name:** Reopen And Truth Correction
**Current Plan:** `.planning/workstreams/wechat-official-account-public-source-channel/ROADMAP.md`
**Total Phases:** 12
**Progress:** 6/12 phases historically complete; Phase 7-12 reopened
**Last Activity:** 2026-04-28
**Last Activity Description:** Live verification confirmed that FeedWe article detail and
download surfaces are summary-only or placeholder HTML for the verified sample.
The workstream is reopened to restore the accepted primary chain
`FeedWe discovery -> real mp.weixin page capture -> canonical source-truth`.

## Current Slice

- historical `Phase 1-6` artifacts remain archived, but their closeout claim
  that FeedWe authenticated web article/download surfaces are sufficient body
  truth is superseded
- repo-frozen source-truth schema already expects:
  `FeedWe discovery -> real mp.weixin article URL -> canonical source-truth`
- live verification completed on the current sample article:
  - `/articles/{accountId}/{articleId}` is a summary page with `阅读原文`
  - `GET /api/articles/{articleId}` returns metadata, summary, cover image, and source URL
  - `POST /api/articles/download` returns placeholder HTML with `无法提取文章内容`
  - `POST /api/articles/download-local` returns the same placeholder HTML inside a zip
  - browser-profile `Mozilla` request can currently fetch the real
    `mp.weixin.qq.com/s/...` HTML and observe `js_content` plus inline image markers
- implementation gap in current collector:
  - `capture.ts` still materializes source-truth directly from FeedWe article payload
  - page fetch artifacts are not yet written as first-class capture evidence
  - queryable notice gating still needs to be re-hardened against metadata-only rows

## Blockers / Open Questions

- `mp.weixin` raw page access currently works with browser-profile request headers, but
  long-term stability under anti-bot / verification pressure is still an operational risk
- deletion/update synchronization remains deferred; the reopened phases first target
  correct acquisition and truth boundaries
- image-heavy notices require OCR before they can safely become queryable; that lane needs
  to be wired into notice projection without breaking source-truth boundaries
- any previously materialized metadata-only queryable rows should be treated as suspect
  until Phase 10 re-hardens consumption gates

## Session Continuity

**Stopped At:** Phase 7 planning truth correction recorded; next implementation slice is
Phase 8 collector pipeline conversion from FeedWe-direct materialization to
FeedWe discovery plus real `mp.weixin` page capture.
**Resume File:** `.planning/workstreams/wechat-official-account-public-source-channel/README.md`
