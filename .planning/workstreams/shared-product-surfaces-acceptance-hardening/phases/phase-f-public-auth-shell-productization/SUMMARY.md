---
phase: "F"
name: "Public Auth Shell Productization"
created: 2026-04-19
updated: 2026-04-19
status: completed
---

# Phase F Summary

## What Closed

- 把 `public-chat-web` 的 `/login` `/register` 正式收口为 public auth surface，不再继续维持 `out-of-scope donor wrapper` 口径。
- 保持 donor `AuthLayout` / `AuthForm` 为可见 owner，只在 repo-owned wrapper 内补 campus product copy、same-site Better Auth action adapter 与 compat seam。
- 冻结 `/login` recovery CTA slot，让 future `/forgot-password` `/reset-password` 必须继续挂在同一 auth family，而不是另起 repo 自写壳。
- 明确 `protected-panel-web` `/login` 继续只是 Cloudflare Access reentry，不进入 end-user password product。

## Fresh Evidence

- `.tmp/local-smoke/20260419T061332+0800-sps-phase-f-auth-shell/SUMMARY.md`
- `.tmp/local-smoke/20260419T182700+0800-sps-phase-f-auth-shell/SUMMARY.md`
- `pnpm --dir apps/public-chat-web typecheck`
- `pnpm --dir apps/public-chat-web exec vitest run test/public-chat-auth-regressions.test.ts test/public-chat-auth-actions.test.ts test/worker.test.ts`
- `pnpm --dir apps/public-chat-web test:worker`
- `pnpm --dir apps/public-chat-web build`

## Handoff

- 下一阶段固定进入 `Phase G: Password Reset Backend And Mail Contract`。
- `Phase G` 只允许在 `apps/app-api` Better Auth owner 内补 reset backend 与 auth mail contract，不得回退重开 auth shell owner 讨论。
