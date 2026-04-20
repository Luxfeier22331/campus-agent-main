---
phase: "I"
name: "Auth Hardening And Smoke"
created: 2026-04-19
updated: 2026-04-19
status: planned
---

# Phase I Context

## Goal

在不重开 `Phase F-H` 已冻结的 auth owner / provider / callback truth 的前提下，为 `public-chat-web` 的 public auth family 补齐 captcha、枚举防护、same-site auth continuity 与 local/staging browser smoke，把 `/login` `/register` `/forgot-password` `/reset-password` 真正收口为可验收的产品 auth surface。

## Current Truth

- `apps/app-api` 继续是唯一 product-layer auth / session / principal owner；browser 只能通过 same-site `public-chat-web -> /api/auth/* -> app-api` 路径访问 Better Auth。
- `Phase F` 已冻结：
  - donor auth shell visual language 继续是 `/login` `/register` 的 visible owner
  - `/login` `/register` 已是正式 public auth routes
  - future recovery 仍必须挂在同一 auth family
- `Phase G` 已冻结：
  - Better Auth password-reset backend 已在 `apps/app-api` 内成立
  - reset callback contract 固定回到 same-site `/reset-password`
  - auth mail provider / secret / sender truth 已冻结为 `Resend` over HTTPS
- `Phase H` 已关闭：
  - `public-chat-web` 已正式开放 `/forgot-password` 与 `/reset-password`
  - `/login` recovery CTA 已接到真实 route
  - reset success / invalid-token UX 已有基础闭环
- 当前 repo 仍缺以下 Phase I 级 hardening truth：
  - `apps/app-api` 还没有 Better Auth captcha plugin 或 Turnstile secret contract
  - `apps/public-chat-web` auth client / actions / pages 还没有 captcha token seam
  - `apps/public-chat-web/src/index.ts` 目前只对 auth family 转发 `Origin` / `Referer`，没有转发 captcha response header
  - local / staging 仍缺一套 fresh forgot -> reset -> post-reset sign-in continuity browser evidence
  - 部分 docs 仍停留在 `Phase F` 前后的旧叙事，例如 `apps/public-chat-web/README.md` 还把 recovery CTA 描述为 placeholder

## Official Doc Facts

- Better Auth captcha plugin 官方文档说明：
  - 可直接接 `turnstile` provider
  - 默认保护端点包含 `"/sign-up/email"`、`"/sign-in/email"`、`"/request-password-reset"`
  - 前端需把 captcha token 放在 `x-captcha-response` header 里
- Better Auth email/password 官方文档说明：
  - recovery client contract 是 `requestPasswordReset({ email, redirectTo })` 与 `resetPassword({ newPassword, token })`
  - invalid / expired reset token 会回到 `redirectTo` 并带 `error=INVALID_TOKEN`
  - valid token redirect 会把 `token` 放回 callback URL query string
- Cloudflare Turnstile 官方文档说明：
  - 对 SPA / dynamic content 更适合 explicit rendering
  - token 必须在服务端通过 Siteverify 校验
  - token 有效期 `300` 秒且只能使用一次
  - hostname / action 应纳入服务端校验 truth
- Cloudflare Turnstile testing 官方文档说明：
  - 官方提供 testing sitekey / secret 组合，可用于 local/CI 的 deterministic pass/fail smoke
  - 因此 local automated smoke 不需要伪造 repo-owned bypass seam

## Locked Decisions

### Captcha Provider

- `Phase I` 的 captcha provider 固定为 `Cloudflare Turnstile`。
- 集成点固定在 `apps/app-api` 的 Better Auth `captcha()` plugin，不新建 repo-owned parallel captcha verify endpoint。
- 不重新打开 `reCAPTCHA` / `hCaptcha` provider 选择。

### Protected Auth Scope

- captcha 保护范围固定跟随 Better Auth email/password 默认端点：
  - `/sign-up/email`
  - `/sign-in/email`
  - `/request-password-reset`
- `/reset-password` 继续保持 token-only flow，不额外叠第二层 captcha；它的风险控制继续依赖 fixed same-site callback、短 TTL、单次 token 与 old-session revocation。

### Same-Site Transport Contract

- browser 仍只向 same-site `/api/auth/*` 提交 auth 请求。
- `public-chat-web` Worker 必须只在 auth family proxy path 上转发 `x-captcha-response`，并与现有 `Origin` / `Referer` preservation 一起工作。
- 不给非 auth `/api/*` 扩散 captcha transport header。

### Runtime And Env Truth

- `apps/app-api` 新增 Turnstile secret truth，供 Better Auth captcha plugin 使用。
- `apps/public-chat-web` 新增 public sitekey truth，但必须通过单一 repo-owned config seam 暴露到 client，不允许把 sitekey 字符串散落在 page 组件里。
- local automation 使用 Cloudflare 官方 testing credentials。
- staging smoke 使用真实、hostname-admitted 的 Turnstile widget credentials。

### UX Security Posture

- `forgot-password` success copy 继续保持 neutral，不确认账号是否存在。
- sign-in / sign-up / recovery error copy 不把账号存在性、token 原文或 provider 细节暴露成页面 truth。
- reset 完成后必须回到 `/login` 并显式证明新密码可登录、旧 session 已被撤销。

## Existing Code Insights

### Server Seams

- `apps/app-api/src/modules/auth/auth.ts`
  - 已拥有 Better Auth owner、allowlist admission、rate-limit、same-site reset redirect validation
  - 目前还没有 captcha plugin
- `apps/app-api/src/config.ts`
  - 当前已冻结 `BETTER_AUTH_SECRET`、`RESEND_API_KEY`、`AUTH_RESET_EMAIL_FROM`、`PUBLIC_CHAT_WEB_ORIGIN` 等 auth 必要配置
  - 还没有 Turnstile secret key

### Public Auth Seams

- `apps/public-chat-web/src/platform/auth/client.ts`
  - 目前只封装 sign-in / sign-up / request-reset / reset-password
  - 还没有 captcha token input / transport contract
- `apps/public-chat-web/src/login/actions.ts`
  - 已有 login/register/forgot/reset 的表单校验与 action state
  - 可继续作为 page -> auth client 的薄层
- `apps/public-chat-web/src/login/page.tsx`
- `apps/public-chat-web/src/login/register-page.tsx`
- `apps/public-chat-web/src/login/forgot-password-page.tsx`
- `apps/public-chat-web/src/login/reset-password-page.tsx`
  - auth family 页面已统一在 donor visual shell 下，但还没有 captcha UI seam

### Worker / Test Seams

- `apps/public-chat-web/src/index.ts`
  - 当前 auth proxy 只额外转发 `Origin` / `Referer`
- `apps/public-chat-web/test/worker.test.ts`
  - 已锁住 same-site auth header forwarding 行为，是补 captcha header forwarding 的现成回归位点
- `apps/public-chat-web/test/public-chat-auth-actions.test.ts`
- `apps/public-chat-web/test/public-chat-auth-regressions.test.ts`
  - 已锁住 auth family route/action truth，可继续加入 captcha / enumeration / docs drift regression

## Non-goals

- 不重开 `Phase F-G-H` 已冻结的 auth owner、callback、mail provider truth
- 不给 `protected-panel-web` 打开 self-serve auth / recovery 产品面
- 不重写 donor auth shell 或另起一套 repo-owned auth visual language
- 不新增 repo-owned captcha verify endpoint、bypass header 或 operator-only recovery 通道
- 不把 `Phase I` 扩成 MFA / social login / passkey / profile management phase

## Canonical References

- `docs/architecture/identity-and-authorization-architecture.md`
- `docs/architecture/product-runtime-architecture.md`
- `docs/environment/provider-and-secret-inventory.md`
- `docs/runbooks/staging-worker-deploy-runbook.md`
- `.planning/workstreams/shared-product-surfaces-acceptance-hardening/REQUIREMENTS.md`
- `.planning/workstreams/shared-product-surfaces-acceptance-hardening/ROADMAP.md`
- `.planning/workstreams/shared-product-surfaces-acceptance-hardening/STATE.md`
- `.planning/workstreams/shared-product-surfaces-acceptance-hardening/phases/phase-f-public-auth-shell-productization/SUMMARY.md`
- `.planning/workstreams/shared-product-surfaces-acceptance-hardening/phases/phase-g-password-reset-backend-and-mail-contract/SUMMARY.md`
- `.planning/workstreams/shared-product-surfaces-acceptance-hardening/phases/phase-h-public-recovery-ux/SUMMARY.md`
- Better Auth captcha docs: `https://better-auth.com/docs/plugins/captcha`
- Better Auth email/password docs: `https://better-auth.com/docs/authentication/email-password`
- Cloudflare Turnstile client-side rendering docs: `https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/`
- Cloudflare Turnstile server-side validation docs: `https://developers.cloudflare.com/turnstile/get-started/server-side-validation/`
- Cloudflare Turnstile testing docs: `https://developers.cloudflare.com/turnstile/troubleshooting/testing/`
