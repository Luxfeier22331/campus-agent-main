---
phase: "H"
name: "Public Recovery UX"
created: 2026-04-19
updated: 2026-04-19
status: completed
---

# Phase H Context

## Goal

在 `apps/public-chat-web` 内把 `/forgot-password` 与 `/reset-password` 落成正式 public auth family recovery surface，直接消费 `Phase G` 已冻结的 Better Auth same-site reset backend，而不是继续停留在 `/login` recovery CTA placeholder。

## Current Truth

- `apps/app-api` 继续是唯一 product-layer auth owner；`public-chat-web` 只能消费 same-site `/api/auth/*` seam。
- `Phase F` 已冻结：
  - donor `AuthLayout` / `SubmitButton` / auth visual language 继续是 public auth surface visible owner
  - `/login` recovery CTA slot 已落在现有 donor shell 中
  - `/register` 与 `/login` 已是正式 public auth routes
- `Phase G` 已冻结：
  - Better Auth password reset backend 已在 `apps/app-api` 内接通
  - reset callback contract 固定回到 `PUBLIC_CHAT_WEB_ORIGIN` 下的 `/reset-password`
  - reset completion 会撤销旧 session
  - transactional mail provider / sender / secret truth 已冻结为 `Resend` over HTTPS
- 当前 `apps/public-chat-web` 只有 sign-in / sign-up adapter：
  - `src/platform/auth/client.ts` 只封装 `signUp.email` / `signIn.email` / `signOut`
  - `src/login/actions.ts` 只覆盖 login/register
  - router 只开放 `/login` `/register` `/chat`
- donor `AuthForm` 当前把 `email` 与 `password` 字段写死：
  - 它适合 login/register
  - 不适合 email-only forgot-password，也不适合带 confirm-password 的 reset-password

## Official Doc Facts

- Better Auth email/password docs 说明前端 recovery path 通过 auth client 触发：
  - `requestPasswordReset({ email, redirectTo })`
  - `resetPassword({ newPassword, token })`
- Better Auth docs 同时说明：
  - invalid/expired token 会把用户带回 `redirectTo`
  - page 需要从 query string 读取 `token`，并处理 `error=INVALID_TOKEN`
- Better Auth captcha plugin docs 说明 reset-related auth endpoints 属于可被 captcha 保护的 auth family；但当前 repo 还没有在 public chat recovery UI 接入 captcha，这属于 `Phase I`。
- Resend Cloudflare Workers docs 已在 `Phase G` 用于 backend/provider freeze；`Phase H` 不重新打开 mail provider 讨论。

## Locked Decisions

### Surface Ownership

- `/forgot-password` 与 `/reset-password` 继续属于 `public-chat-web` public auth family。
- `protected-panel-web` 不参与 self-serve recovery product。

### UX Shell Posture

- 继续沿用 donor auth shell visual language：
  - `AuthLayout`
  - `SubmitButton`
  - existing donor/ui primitives
- 但不强行复用当前写死 password field 的 `AuthForm`。
- 如需 recovery-specific form，允许在 repo-owned wrapper 中复用 donor input/button primitives；不另起一套视觉语言或 repo-owned auth shell。

### Route Contract

- 固定新增两个 public routes：
  - `/forgot-password`
  - `/reset-password`
- `/login` recovery CTA 必须真实指向 `/forgot-password`。
- `reset-password` page 只能消费 same-site reset token contract，不接受 panel/operator recovery affordance。

### Redirect Contract

- 前端传给 Better Auth 的 reset redirect 继续指向 same-site `/reset-password`。
- 由于 `Phase G` backend 已 fail-close 到 public origin + fixed path，前端不允许引入 caller-controlled external redirect。

### Product Copy Boundary

- `forgot-password` 的 success state 默认使用 neutral copy，不在页面上确认账号是否存在。
- `Phase I` 仍负责更强的 enumeration hardening/captcha/browser smoke closeout，但 `Phase H` 不应把 copy 写成明显的 existence leak。

## Existing Code Insights

### Reusable Assets

- `apps/public-chat-web/src/login/page.tsx`
- `apps/public-chat-web/src/login/register-page.tsx`
- `apps/public-chat-web/src/login/actions.ts`
- `apps/public-chat-web/src/platform/auth/client.ts`
- `apps/public-chat-web/src/routes/app-router.tsx`
- `apps/public-chat-web/vendor/vercel-ai-chatbot/components/chat/auth-form.tsx`
- `apps/public-chat-web/vendor/vercel-ai-chatbot/components/chat/submit-button.tsx`
- `apps/public-chat-web/vendor/vercel-ai-chatbot/app/(auth)/layout.tsx`

### Established Test Seams

- `apps/public-chat-web/test/public-chat-auth-actions.test.ts`
- `apps/public-chat-web/test/public-chat-auth-regressions.test.ts`
- `apps/public-chat-web/test/worker.test.ts`

## Non-goals

- 不重写 donor auth shell
- 不为 panel 打开 recovery UI
- 不在本 phase 里接 captcha / Turnstile
- 不在本 phase 里重开 mail provider / callback / auth owner 决策
- 不把 reset flow 改成 repo-owned parallel endpoint

## Canonical References

- `docs/architecture/system/identity-and-authorization-architecture.md`
- `docs/architecture/system/product-runtime-architecture.md`
- `.planning/workstreams/shared-product-surfaces-acceptance-hardening/REQUIREMENTS.md`
- `.planning/workstreams/shared-product-surfaces-acceptance-hardening/ROADMAP.md`
- `.planning/workstreams/shared-product-surfaces-acceptance-hardening/STATE.md`
- `.planning/workstreams/shared-product-surfaces-acceptance-hardening/phases/phase-f-public-auth-shell-productization/SUMMARY.md`
- `.planning/workstreams/shared-product-surfaces-acceptance-hardening/phases/phase-g-password-reset-backend-and-mail-contract/SUMMARY.md`
- Better Auth email/password docs: `https://www.better-auth.com/docs/authentication/email-password`
- Better Auth captcha docs: `https://www.better-auth.com/docs/plugins/captcha`
- Resend Cloudflare Workers docs: `https://resend.com/docs/send-with-cloudflare-workers`
