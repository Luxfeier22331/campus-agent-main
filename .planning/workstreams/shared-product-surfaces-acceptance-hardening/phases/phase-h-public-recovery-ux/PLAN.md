---
doc_type: phase_plan
phase: "H"
phase_name: "Public Recovery UX"
status: completed
created: 2026-04-19
updated: 2026-04-19
---

# Phase H Plan

## Objective

在 `apps/public-chat-web` 内正式交付 `/forgot-password` 与 `/reset-password` recovery UX，使 end-user 能通过同一 public auth family 发起 reset mail、消费 token、完成密码重置并回到 `/login`，而不依赖 operator 手工改库。

## Why This Phase Exists

`Phase F` 只冻结了 auth shell 与 recovery CTA placement，`Phase G` 只冻结了 backend/provider/callback contract。当前真正缺的是 user-facing recovery UX：

- `/login` 还只是 placeholder CTA
- router 还没有 recovery routes
- 前端 auth client 还没有 request/reset adapter
- 用户还不能完成真实账户恢复闭环

所以 `Phase H` 必须把前端 recovery surface 补齐，但不得重新打开 backend/provider/owner 决策。

## External References

- Better Auth email/password docs:
  - https://www.better-auth.com/docs/authentication/email-password
- Better Auth captcha docs:
  - https://www.better-auth.com/docs/plugins/captcha
- Resend Cloudflare Workers docs:
  - https://resend.com/docs/send-with-cloudflare-workers

## Decisions To Freeze

1. recovery UX 继续属于 `public-chat-web` public auth family。
2. visual shell 继续沿用 donor auth language，不新造一套 repo-owned auth shell。
3. `AuthLayout` / `SubmitButton` / donor input primitives 可继续复用；但不强行复用当前写死 email+password 的 `AuthForm`。
4. `/forgot-password` 必须作为 `/login` recovery CTA 的真实落点。
5. `/reset-password` 只消费 `Phase G` same-site Better Auth reset contract。
6. reset redirect 继续固定回到 same-site `/reset-password`，前端不暴露外部 redirect customization。
7. `forgot-password` 的提交结果默认使用 neutral success copy，不把账号存在性变成页面 truth。

## Execution Slices

### Slice 1: Extend Public Auth Client Seam

- 在 `apps/public-chat-web/src/platform/auth/client.ts` 内补齐 recovery adapter：
  - request password reset
  - reset password with token
- 冻结 repo-owned client helper contract：
  - 构造 same-site reset redirect target
  - 统一分类 Better Auth recovery error
  - 不把 raw auth provider semantics 直接泄漏到 page components
- 若当前 `better-auth` client typings 不够直观，优先以 repo-local typed wrapper 收口，不在 page 里散落 ad-hoc casts。

### Slice 2: Add Recovery Actions And Validation

- 为 `/forgot-password` 添加 action state：
  - idle / invalid_data / failed / success
- 为 `/reset-password` 添加 action state：
  - idle / invalid_token / invalid_data / failed / success
- 最低校验包括：
  - email 格式
  - password 最短长度与 confirm password 一致
  - token 缺失时 fail-close
- 保持 action adapter 继续是 `public-chat-web -> auth client` 的薄层，不新增 repo-owned parallel fetch endpoint。

### Slice 3: Implement Recovery Pages In The Existing Auth Family

- 新增 `/forgot-password` page：
  - 延续 donor auth shell
  - 接收 email-only submission
  - 成功后显示 neutral mail-sent guidance
  - 提供返回 `/login` 的 CTA
- 新增 `/reset-password` page：
  - 从 query string 读取 `token`
  - 如果 query 带 `error=INVALID_TOKEN` 或 token 缺失，直接进入 invalid/expired state
  - 允许输入 new password + confirm password
  - success 后引导回 `/login`
- 保持与 `/login` `/register` 相同的 typography / spacing / component language，不要做成另一套 auth shell。

### Slice 4: Route And Navigation Contract

- 更新 `apps/public-chat-web/src/routes/app-router.tsx`：
  - 正式开放 `/forgot-password`
  - 正式开放 `/reset-password`
- 将 `/login` 里的 recovery CTA 从 placeholder 改成可点击 link。
- 明确 `/reset-password` 不是 authenticated route；它应在未登录状态下可访问。

### Slice 5: Verification And Regression Coverage

- tests 至少覆盖：
  - malformed forgot-password submission 不触发 auth client
  - forgot-password success/failure state mapping
  - malformed reset-password submission 不触发 auth client
  - token missing / invalid-token query -> invalid state
  - reset-password success/failure state mapping
  - router 暴露 `/forgot-password` 与 `/reset-password`
  - `/login` recovery CTA 不再是 placeholder text
  - 继续锁住 donor auth shell owner，而不是回退到 repo-owned custom auth page
- worker lane 继续证明 same-site browser shell 未被破坏。

### Slice 6: Handoff To Phase I

- `Phase I` 继续补：
  - captcha on recovery submit
  - local/staging browser smoke
  - post-reset sign-in closeout
  - stricter enumeration/abuse hardening evidence
- `Phase H` 不因等待这些 hardening 才开放 recovery UX，但必须保留明确 seam。

## Proposed Write Set For Later Execution

- `.planning/workstreams/shared-product-surfaces-acceptance-hardening/phases/phase-h-public-recovery-ux/CONTEXT.md`
- `.planning/workstreams/shared-product-surfaces-acceptance-hardening/phases/phase-h-public-recovery-ux/PLAN.md`
- `.planning/workstreams/shared-product-surfaces-acceptance-hardening/STATE.md`
- `.planning/WORKSTREAMS.md`
- `apps/public-chat-web/src/platform/auth/client.ts`
- `apps/public-chat-web/src/login/actions.ts`
- `apps/public-chat-web/src/login/page.tsx`
- `apps/public-chat-web/src/login/*recovery*.tsx`
- `apps/public-chat-web/src/routes/app-router.tsx`
- `apps/public-chat-web/test/public-chat-auth-actions.test.ts`
- `apps/public-chat-web/test/public-chat-auth-regressions.test.ts`
- `apps/public-chat-web/test/worker.test.ts`

## Verification Loop

- doc truth:
  - `Phase F` / `Phase G` handoff 没被重写
  - auth owner、callback、provider truth 仍留在既有边界
- code truth:
  - recovery pages 继续走 same-site Better Auth client seam
  - `/reset-password` 只消费 fixed same-site token/callback contract
  - donor auth shell visual owner 未漂移
- command truth:
  - `pnpm --dir apps/public-chat-web typecheck`
  - `pnpm --dir apps/public-chat-web test:worker`
  - 必要时补 targeted Vitest auth/recovery entry
- browser truth:
  - local browser smoke 至少能证明 forgot -> reset -> back-to-login shell continuity
- research truth:
  - Better Auth recovery client contract 与 invalid-token redirect contract 已被官方文档覆盖
  - captcha hardening 仍留给 `Phase I`

## Exit Rule

Phase H 完成后，repo 应达到：

- `public-chat-web` 已正式拥有 `/forgot-password` 与 `/reset-password`
- `/login` recovery CTA 已接入真实 route
- public auth family 内已形成 user-visible recovery 闭环
- `Phase I` 可以专注于 captcha / smoke / hardening，而不是继续补基础 UX 缺口
