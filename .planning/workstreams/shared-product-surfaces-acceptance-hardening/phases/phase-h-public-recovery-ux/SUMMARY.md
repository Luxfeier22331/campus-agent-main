---
phase: "H"
name: "Public Recovery UX"
created: 2026-04-19
updated: 2026-04-19
status: completed
---

# Phase H Summary

## What Closed

- 在 `apps/public-chat-web` 内正式开放了 `/forgot-password` 与 `/reset-password` 两个 public recovery routes。
- `public-chat-web` auth client seam 已补齐：
  - `requestPasswordReset`
  - `resetPasswordWithToken`
  - same-site `/reset-password` redirect target construction
- `/login` recovery CTA 已从 placeholder 改成真实可点击的 `/forgot-password` 入口。
- recovery UX 继续沿用 donor auth shell visual language，但没有强行复用写死 email/password 的 `AuthForm`；新 recovery forms 只复用了 donor layout、button 与 input primitives。
- `/reset-password` 已按 `Phase G` contract 消费 same-site token / invalid-token callback，并在 success 后引导回 `/login`。

## Fresh Evidence

- Better Auth email/password docs: https://www.better-auth.com/docs/authentication/email-password
- Better Auth captcha docs: https://www.better-auth.com/docs/plugins/captcha
- `pnpm --dir apps/public-chat-web exec vitest run test/public-chat-auth-actions.test.ts`
- `pnpm --dir apps/public-chat-web exec vitest run test/public-chat-auth-regressions.test.ts`
- `pnpm --dir apps/public-chat-web typecheck`
- `pnpm --dir apps/public-chat-web test:worker`
- `pnpm --dir apps/public-chat-web build`

## Handoff

- 下一阶段固定进入 `Phase I: Auth Hardening And Smoke`。
- `Phase I` 继续承接：
  - captcha on recovery submit
  - local/staging browser smoke
  - post-reset sign-in closeout
  - enumeration / abuse hardening evidence
