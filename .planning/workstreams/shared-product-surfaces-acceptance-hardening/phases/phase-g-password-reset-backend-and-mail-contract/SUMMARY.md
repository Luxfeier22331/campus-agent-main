---
phase: "G"
name: "Password Reset Backend And Mail Contract"
created: 2026-04-19
updated: 2026-04-19
status: completed
---

# Phase G Summary

## What Closed

- 在 `apps/app-api` 内补齐了 canonical Better Auth password reset backend：
  - `sendResetPassword`
  - `onPasswordReset`
  - `resetPasswordTokenExpiresIn = 3600`
  - `revokeSessionsOnPasswordReset = true`
- 把 auth transactional mail provider / sender / secret truth 冻结为 `Resend` over HTTPS，并在 README、secret inventory、staging runbook 中落盘 `RESEND_API_KEY`、`AUTH_RESET_EMAIL_FROM`、可选 `AUTH_RESET_EMAIL_REPLY_TO`。
- 把 reset redirect contract fail-close 到 `PUBLIC_CHAT_WEB_ORIGIN` 下的 `/reset-password`，不接受 panel 或任意外部 origin。
- 保持 `protected-panel-web` 继续排除在 self-serve password product 之外，避免 recovery product owner 漂移。

## Fresh Evidence

- Better Auth email/password docs: https://www.better-auth.com/docs/authentication/email-password
- Better Auth captcha docs: https://www.better-auth.com/docs/plugins/captcha
- Resend Cloudflare Workers docs: https://resend.com/docs/send-with-cloudflare-workers
- `pnpm --dir apps/app-api typecheck`
- `pnpm --dir apps/app-api exec vitest run -c vitest.node.config.mts test/auth-and-db.test.ts`
- `pnpm --dir apps/app-api test:node`
- `pnpm --dir apps/app-api test:worker`
- `pnpm --dir apps/app-api db:migrate`
- `pnpm --dir apps/app-api db:reconcile-shared-drift -- --json`
- `pnpm --dir apps/app-api test:shared-db-integration`

## Handoff

- 下一阶段固定进入 `Phase H: Public Recovery UX`。
- `Phase H` 只能复用 `Phase F` 已冻结的 public auth shell family 与 `Phase G` 已冻结的 same-site Better Auth reset backend，不得重新讨论 provider、callback 或 auth owner。
- `Phase I` 继续承接 enumeration-safe copy、captcha on `request-password-reset`、local/staging browser smoke 与 post-reset sign-in 闭环。
