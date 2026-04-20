---
phase: "G"
name: "Password Reset Backend And Mail Contract"
created: 2026-04-19
updated: 2026-04-19
status: completed
---

# Phase G Context

## Goal

在 `apps/app-api` 内补齐 canonical Better Auth password-reset backend，并把 end-user auth mail provider / sender / secret / callback / runbook truth 一次性落盘，作为 `Phase H` public recovery UX 的后端基础。

## Current Truth

- `apps/app-api` 是唯一 product-layer auth / session / principal owner；`public-chat-web` 只能消费 same-site `/api/auth/*` 与 session projection。
- 当前 `app-api` Better Auth 只启用了 email/password 的 sign-up / sign-in；reset request、reset token consumption、reset completion callback 还没有 repo-owned truth。
- `app_auth.verification` schema 已存在，可作为 Better Auth reset token contract 的 shared-db 基础。
- `Phase F` 已把 `/login` `/register` 冻结为正式 public auth surface，并在 `/login` 预留了 recovery CTA slot；future `/forgot-password` `/reset-password` 必须继续挂在同一 auth family。
- `docs/environment/provider-and-secret-inventory.md` 当前只记录了 `BETTER_AUTH_SECRET`；repo 还没有 end-user auth transactional mail provider、sender identity、deploy secret ownership 与 reset runbook truth。
- `protected-panel-web` 已明确不拥有 self-serve signup、password reset 或 profile management。

## Locked Decisions

### Auth Owner

- password reset backend 继续属于 `apps/app-api` Better Auth owner。
- 不新建独立 reset service，不通过 panel/operator 路径绕过 canonical auth contract。

### Runtime Boundary

- browser 继续只走 `public-chat-web` same-site `/api/auth/*`。
- reset request / token consumption 继续挂在 Better Auth auth family，不新增 repo-owned parallel auth endpoints。

### Mail Provider Freeze

- 默认 transactional mail provider 冻结为 `Resend` over HTTPS。
- 理由不是“偏好 Resend 品牌”，而是当前 canonical runtime 已冻结为 Cloudflare Worker；repo 当前没有 SMTP runtime truth，Resend 具备官方 Cloudflare Workers JS path，更符合当前部署边界。
- provider 选择可以在未来被显式替换，但 `Phase G` 不能继续保持 provider 未定状态。

### Redirect And Token Contract

- reset completion 必须回到 public auth family；默认目标是 `public-chat-web` 的 `/reset-password`。
- reset redirect 不得旁路到 `protected-panel-web`、operator route 或任意外部 origin。
- password reset 完成后应撤销旧 session，避免旧会话继续有效。

### Out Of Scope

- `/forgot-password` 与 `/reset-password` 的 visible UX 属于 `Phase H`。
- enumeration-safe copy、captcha hardening、local/staging browser closeout 属于 `Phase I`，但 `Phase G` 必须给这些后续 phase 留出 backend seam。

## Existing Code Insights

### Reusable Assets

- `apps/app-api/src/modules/auth/auth.ts`：当前 Better Auth owner 与 `buildBetterAuthConfig()` 落点。
- `apps/app-api/src/app.ts`：`ALL /api/auth/*` 当前挂载位置。
- `apps/app-api/src/config.ts`：当前 app-api runtime config / readiness 必要键。
- `apps/app-api/src/db/schema/auth.ts`：`app_auth.verification` schema 已存在。
- `apps/public-chat-web/src/platform/auth/client.ts`：当前 same-site Better Auth client seam；后续 `Phase H` 可在此扩 recovery actions。

### Established Patterns

- 当前 auth admission 已通过 Better Auth middleware 统一管 end-user email allowlist。
- runtime config 缺失时，`GET /readyz` 已按 app-owned config fail-close。
- `public-chat-web` 已通过 worker tests 锁住 same-site `/api/auth/*` request header forwarding。

### Known Gaps

- 当前没有 `sendResetPassword` / `onPasswordReset` runtime truth。
- 当前没有 auth mail provider secret inventory、sender identity、staging runbook 与 smoke contract。
- 当前没有 same-site reset redirect validation truth。

## Canonical References

- `docs/architecture/identity-and-authorization-architecture.md`
- `docs/architecture/product-runtime-architecture.md`
- `docs/environment/provider-and-secret-inventory.md`
- `docs/contracts/app-api-http.md`
- `docs/plans/archive/completed/shared-product-surfaces-acceptance-hardening.md`
- `.planning/workstreams/shared-product-surfaces-acceptance-hardening/REQUIREMENTS.md`
- `.planning/workstreams/shared-product-surfaces-acceptance-hardening/ROADMAP.md`
- `.planning/workstreams/shared-product-surfaces-acceptance-hardening/STATE.md`
- Better Auth email/password docs: `https://www.better-auth.com/docs/authentication/email-password`
- Better Auth captcha plugin docs: `https://www.better-auth.com/docs/plugins/captcha`
- Resend Cloudflare Workers docs: `https://resend.com/docs/send-with-cloudflare-workers`

## Deferred Ideas

- social login、magic link、MFA、profile management、panel-side account recovery 都不属于本 phase。

## Entry

- `docs/plans/archive/completed/shared-product-surfaces-acceptance-hardening.md`
