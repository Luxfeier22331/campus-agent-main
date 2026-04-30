---
phase: "9"
name: "Parser Hardening And Fail-Closed Body Semantics"
status: completed
created: 2026-04-28
updated: 2026-04-30
---

# Phase 9 Summary

## What Closed

- Added modern `mp.weixin` shell parsing for `content_noencode`,
  escaped meta descriptions, `ori_create_time`, and picture-page image URLs.
- Switched the page fetch user agent to a Windows Chrome browser profile; the
  previous Linux Chrome UA triggered WeChat captcha in live tests.
- Verification pages still classify as non-queryable fail-closed captures.

## Acceptance Evidence

- `pnpm --filter wechat-official-account-collector test`
- Final live capture evidence:
  `evidence/phase-12-replay-drift-guard-and-acceptance-closeout/live-capture-three-decoded-20260430070701.json`
