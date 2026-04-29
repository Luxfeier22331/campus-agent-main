---
doc_type: phase_plan
phase: "I"
phase_name: "Auth Hardening And Smoke"
status: active
created: 2026-04-19
updated: 2026-04-19
---

# Phase I Plan

## Objective

在 `apps/app-api` 与 `apps/public-chat-web` 之间补齐 Turnstile-backed auth hardening，并产出 fresh local / staging evidence，证明 public auth family 的 `login/register/forgot/reset/post-reset sign-in` 闭环具备 same-site、enumeration-safe、可验收的产品 truth。

## Why This Phase Exists

`Phase F-H` 已经把 auth shell、reset backend 与 recovery UX 打开，但现在还缺最后一层上线前硬化：

- 没有 captcha / abuse hardening
- 没有 Turnstile env / runbook truth
- 没有 local / staging 的 forgot -> reset -> sign-in continuity evidence
- docs 里还残留一部分旧 placeholder 叙事

如果直接把 `Phase H` 当作收尾，就会把公开 auth surface 留在“能用但没硬化、能演示但没 smoke closeout”的状态。

## External References

- Better Auth captcha docs:
  - https://better-auth.com/docs/plugins/captcha
- Better Auth email/password docs:
  - https://better-auth.com/docs/authentication/email-password
- Cloudflare Turnstile client-side rendering docs:
  - https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/
- Cloudflare Turnstile server-side validation docs:
  - https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
- Cloudflare Turnstile testing docs:
  - https://developers.cloudflare.com/turnstile/troubleshooting/testing/

## Decisions To Freeze

1. captcha provider 固定为 `Cloudflare Turnstile`，并通过 Better Auth `captcha()` plugin 接到 `apps/app-api`，不新建 parallel captcha service。
2. captcha 保护范围固定跟随 Better Auth 默认 email/password auth family：
   - `/sign-up/email`
   - `/sign-in/email`
   - `/request-password-reset`
3. `/reset-password` 不追加第二层 captcha；它继续走 fixed same-site token flow。
4. auth captcha token 只走 same-site `public-chat-web -> /api/auth/* -> app-api` transport，`public-chat-web` Worker 必须转发 `x-captcha-response`，同时保持现有 `Origin` / `Referer` contract。
5. runtime/env truth 必须新增：
   - `apps/app-api` 的 Turnstile secret key
   - `apps/public-chat-web` 的 public Turnstile sitekey
   - staging hostname admission 与 local testing-credential posture
6. `forgot-password` success copy 继续 neutral；本 phase 不允许把账号存在性、reset token 或 provider internals 泄漏成页面 truth。
7. `Phase I` 还必须关闭 `Phase F-H` 残留 docs drift，避免 README / runbook / state truth 与当前 auth surface 脱节。

## Execution Slices

### Slice 1: Freeze Captcha Runtime Contract

- 在 `apps/app-api/src/config.ts` 内新增 Turnstile secret runtime config，并把它纳入 readiness / missing-config truth。
- 在 `apps/app-api/.dev.vars.example`、`apps/app-api/wrangler.toml`、`docs/environment/provider-and-secret-inventory.md`、`docs/runbooks/staging-worker-deploy-runbook.md` 内收口 Turnstile secret ownership。
- 在 `apps/public-chat-web` 侧新增单一 sitekey config seam：
  - 不把 sitekey 写死在 page 组件
  - 不依赖 ad-hoc `window` global 注入
  - 与当前 Vite/Worker build seam 兼容
- 明确 local 使用 Cloudflare 官方 testing credentials，staging 使用真实 admitted credentials。

### Slice 2: Enable Better Auth Captcha On Server

- 在 `apps/app-api/src/modules/auth/auth.ts` 内接入 Better Auth `captcha()` plugin，并将 provider 固定为 Turnstile。
- 保持现有 allowlist admission、origin check、CSRF check、rate-limit 与 reset redirect validation 同时成立；不要为了接 captcha 降低已有 auth hardening。
- 新增 / 更新 node + worker 测试，覆盖：
  - missing captcha response -> fail closed
  - invalid captcha response -> fail closed
  - valid captcha response -> sign-in / sign-up / request-password-reset happy path
  - `/reset-password` 不被错误纳入 captcha mandatory scope

### Slice 3: Wire Captcha Through The Public Auth Family

- 在 `apps/public-chat-web` 内新增 shared captcha wrapper / hook / component，服务于：
  - `/login`
  - `/register`
  - `/forgot-password`
- 采用 explicit rendering posture，确保 route 切换、form resubmit、error retry 时 widget/token lifecycle 可控。
- auth client / action seam 负责把 token 带入 auth request，但不把 Turnstile vendor semantics 扩散到每个 page component。
- `/reset-password` 继续不展示 captcha widget。

### Slice 4: Preserve Same-Site Proxy And Header Contract

- 更新 `apps/public-chat-web/src/index.ts` auth proxy header allowlist，使 `x-captcha-response` 只在 `/api/auth/*` 路径向 `app-api` 转发。
- worker tests 必须继续锁住：
  - auth family 保留 `Origin` / `Referer`
  - auth family 新增 `x-captcha-response`
  - 非 auth `/api/*` 仍不扩散 captcha header
- 不允许把 captcha token 暴露到 panel、chat command 路径或其他非 auth runtime API。

### Slice 5: Enumeration-Safe UX And Post-Reset Sign-In

- login/register/forgot/reset 页面 copy 做一次 security wording pass：
  - `forgot-password` success 保持 neutral
  - sign-in/register failure 不把账号存在性变成页面 truth
  - reset invalid/expired 状态不泄漏 token 原文
- reset success 之后必须明确回到 `/login`，并把“用新密码重新登录”作为真实闭环，而不是 toast-only 结束。
- 如现有 README / route inventory / runbook 仍保留 placeholder 叙事，随本 slice 一并修正。

### Slice 6: Local And Staging Smoke Evidence

- local smoke：
  - 使用 Cloudflare 官方 testing credentials
  - 证明 `/login` `/register` `/forgot-password` 都能通过 captcha-protected same-site auth seam
  - 证明 reset 完成后可用新密码重新登录，且旧 session 不再有效
- staging smoke：
  - 使用真实 Turnstile admitted hostname + secret
  - 默认采用 visible browser hybrid smoke；必要时允许人工完成 challenge，再由 `mcp__chrome_devtools__` / `mcp__playwright__` 抓取网络与页面 evidence
  - 证明 forgot -> mail -> reset -> login continuity 在 staging 成立
- smoke artifact 继续落到 repo-local `.tmp/local-smoke/` 与 `.tmp/staging-smoke/`，并回写 workstream `STATE.md`

## Proposed Write Set For Later Execution

- `.planning/workstreams/shared-product-surfaces-acceptance-hardening/phases/phase-i-auth-hardening-and-smoke/CONTEXT.md`
- `.planning/workstreams/shared-product-surfaces-acceptance-hardening/phases/phase-i-auth-hardening-and-smoke/PLAN.md`
- `.planning/workstreams/shared-product-surfaces-acceptance-hardening/STATE.md`
- `.planning/WORKSTREAMS.md`
- `apps/app-api/src/config.ts`
- `apps/app-api/src/modules/auth/auth.ts`
- `apps/app-api/.dev.vars.example`
- `apps/app-api/wrangler.toml`
- `apps/app-api/test/auth-and-db.test.ts`
- `apps/app-api/test/worker.test.ts`
- `apps/app-api/README.md`
- `apps/public-chat-web/src/index.ts`
- `apps/public-chat-web/src/platform/auth/*`
- `apps/public-chat-web/src/login/*`
- `apps/public-chat-web/vite.config.ts`
- `apps/public-chat-web/.dev.vars.example`
- `apps/public-chat-web/wrangler.toml`
- `apps/public-chat-web/test/public-chat-auth-actions.test.ts`
- `apps/public-chat-web/test/public-chat-auth-regressions.test.ts`
- `apps/public-chat-web/test/worker.test.ts`
- `apps/public-chat-web/README.md`
- `docs/environment/provider-and-secret-inventory.md`
- `docs/runbooks/staging-worker-deploy-runbook.md`

## Verification Loop

- doc truth:
  - provider / env / runbook truth 已包含 Turnstile
  - public auth surface README / inventory 不再停留在 recovery placeholder 叙事
- code truth:
  - Better Auth captcha plugin 真正挂在 `apps/app-api`
  - public auth family 真正传递 captcha token
  - same-site auth proxy 只在 `/api/auth/*` 扩 header
- command truth:
  - `pnpm --dir apps/app-api typecheck`
  - `pnpm --dir apps/app-api exec vitest run -c vitest.node.config.mts test/auth-and-db.test.ts`
  - `pnpm --dir apps/app-api exec vitest run -c vitest.worker.config.mts test/worker.test.ts`
  - `pnpm --dir apps/public-chat-web typecheck`
  - `pnpm --dir apps/public-chat-web exec vitest run test/public-chat-auth-actions.test.ts test/public-chat-auth-regressions.test.ts test/worker.test.ts`
  - `pnpm --dir apps/public-chat-web build`
- local smoke truth:
  - fresh artifact 证明 captcha-protected login/register/forgot/reset/post-reset sign-in continuity
- staging truth:
  - fresh artifact 证明真实 domain-bound Turnstile + reset mail + post-reset sign-in continuity
- research truth:
  - Better Auth captcha transport contract、email/password reset callback contract、Turnstile explicit rendering / Siteverify / testing posture 都已由官方文档覆盖

## Exit Rule

Phase I 完成后，repo 应达到：

- public auth family 已接上 Turnstile-backed Better Auth hardening
- same-site auth proxy 明确保留 `Origin` / `Referer` / `x-captcha-response` contract
- forgot/reset/login/register 的 copy 与状态不再明显泄漏账号存在性或 auth material
- local / staging 都有 fresh auth smoke evidence
- `shared-product-surfaces-acceptance-hardening` 这条 workstream 可以以 auth acceptance/hardening truth 完整关闭
