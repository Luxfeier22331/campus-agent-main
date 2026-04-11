# 260411-mpt Summary

## Objective

Close `public-chat-web` donor tech-debt convergence Wave 5 with fresh local verification, redacted browser smoke, and state/docs closeout.

## Root Cause

The blocked local smoke was not caused by donor shell drift or same-site proxy regressions.

- initial local `POST /api/chat/requests` failed with `500`
- physical local `chat.messages` was missing `structured_parts_json`
- the missing column belonged to `apps/app-api/db/shared-product-migrations/0004_chat_message_structured_parts.sql`
- `db:reconcile-shared-drift` did not flag this because it covers drizzle shared-db adoption truth, not `chat.*` shared-product bootstrap migrations

## Action

- reran `pnpm --dir apps/app-api db:bootstrap`
- confirmed local `chat.messages` now includes `structured_parts_json`
- reran fixed Wave 5 gates
- reran real local browser smoke on `http://127.0.0.1:5173`
- updated plan/readme/checklist/runbook/state to record closeout and the local bootstrap prerequisite

## Outcome

- Wave 5 fixed gates are green
- local same-site `/api/*` path is green again
- first send now returns `200` instead of the earlier `500`
- sidebar/history persistence survives reload
- typed outcome during this smoke was handled upstream `execution_timeout`, which is outside donor tech-debt convergence scope

## Evidence

- [Local smoke summary](/home/reptilian/code/campus-agent/.tmp/local-smoke/20260411T163903+0800-public-chat-wave5-closeout/SUMMARY.md)
- [Local smoke network summary](/home/reptilian/code/campus-agent/.tmp/local-smoke/20260411T163903+0800-public-chat-wave5-closeout/network-summary.md)
- [Plan](/home/reptilian/code/campus-agent/docs/plans/public-chat-web-vendor-tech-debt-convergence.md)
- [Checklist](/home/reptilian/code/campus-agent/docs/reference/public-chat-web-donor-parity-review-checklist.md)

## External Confirmation

- Playwright best practices continue to favor asserting user-visible behavior in isolated, reproducible browser tests rather than implementation details.
- Cloudflare Workers local development guidance continues to support local `wrangler dev` / Vite-backed runtime validation as the correct way to exercise the real Worker boundary.

References:

- https://playwright.dev/docs/best-practices
- https://developers.cloudflare.com/workers/local-development/
