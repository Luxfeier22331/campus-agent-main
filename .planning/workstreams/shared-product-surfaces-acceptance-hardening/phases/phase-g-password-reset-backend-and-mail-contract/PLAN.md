---
doc_type: phase_plan
phase: "G"
phase_name: "Password Reset Backend And Mail Contract"
status: completed
created: 2026-04-19
updated: 2026-04-19
---

# Phase G Plan

## Objective

在 `apps/app-api` 内补齐 Better Auth password reset backend，并把 end-user auth mail provider / sender / secret / callback / runbook truth 冻结为可执行 contract，避免 `Phase H` 继续在“邮件怎么发、回跳到哪里、谁持有 secret”上空转。

## Why This Phase Exists

当前真正缺的不是 auth shell，而是 canonical reset backend 与 mail contract：

- `Phase F` 已经冻结 `/login` `/register` 与 recovery CTA placement
- `app-api` 仍只有 sign-up / sign-in，没有 reset callback / mailer
- provider inventory 仍缺 end-user auth mail truth
- 如果直接去做 `/forgot-password` `/reset-password` UI，只会把 backend/provider 决策继续拖到更后面

所以 `Phase G` 必须先把 backend + provider + runbook 一次性钉住。

## External References

- Better Auth email/password docs:
  - https://www.better-auth.com/docs/authentication/email-password
- Better Auth captcha plugin docs:
  - https://www.better-auth.com/docs/plugins/captcha
- Resend Cloudflare Workers docs:
  - https://resend.com/docs/send-with-cloudflare-workers

## Decisions To Freeze

1. reset backend 继续属于 `apps/app-api` Better Auth owner，不新建旁路 auth API。
2. transactional mail provider 默认冻结为 `Resend` over HTTPS，不继续维持“provider 待定”状态。
3. deploy/runtime secret truth 至少包含：
   - `RESEND_API_KEY`
   - `AUTH_RESET_EMAIL_FROM`
   - 可选 `AUTH_RESET_EMAIL_REPLY_TO`
4. reset completion 的 public callback 固定回到 `PUBLIC_CHAT_WEB_ORIGIN` 下的 `/reset-password`，不允许 panel 或任意外部 origin。
5. password reset 完成后必须撤销旧 session。
6. `protected-panel-web` 不参与 reset product；operator 手工改库不是产品闭环。
7. `Phase G` 只交 backend + mail contract；visible `/forgot-password` `/reset-password` 仍归 `Phase H`。

## Execution Slices

### Slice 1: Freeze Runtime And Secret Contract

- 扩充 `apps/app-api/src/config.ts` runtime config，收口 reset mail provider 所需 env。
- 更新 `docs/environment/provider-and-secret-inventory.md`：
  - 增加 auth mail provider / sender identity / deploy secret store truth
  - 明确 staging/production 从哪里拿 `RESEND_API_KEY`
- 更新 `apps/app-api/README.md` 与相关 deploy runbook，避免 reset mail contract 继续隐身。

### Slice 2: Implement Better Auth Reset Backend

- 在 `apps/app-api/src/modules/auth/auth.ts` 内接入 Better Auth reset contract：
  - `sendResetPassword`
  - `onPasswordReset`
  - `resetPasswordTokenExpiresIn`
  - `revokeSessionsOnPasswordReset`
- 为 Resend 增加 repo-owned mail sender helper，边界停留在 `apps/app-api`，不把 provider 类型泄漏到 shared contracts。
- 明确 reset email 模板最小正文 contract：
  - 不暴露 raw token
  - 引导用户回到 public auth family
  - 不引入 panel/operator affordance

### Slice 3: Freeze Same-Site Redirect Validation

- 在 auth middleware / config 层显式限制 reset redirect：
  - origin 必须等于 `PUBLIC_CHAT_WEB_ORIGIN`
  - path 固定为 `/reset-password`
- 不接受任意 caller 自带 external redirect。
- 保持 current same-site `/api/auth/*` seam，不新增 repo-owned reset transport path。

### Slice 4: Add Verification And Readiness Gates

- `app-api` tests 至少覆盖：
  - request password reset happy path
  - reset password happy path
  - invalid/expired token failure
  - redirect validation failure
  - old session revoked after reset
  - provider config missing -> readiness/config failure
- 如果 reset mail provider 成为 canonical auth dependency，则 `GET /readyz` / deploy preflight 必须能反映缺失 config。
- 增加 mail sender fake/stub，确保 node/worker lane 都能证明 contract，而不是只在浏览器 smoke 才发现断层。

### Slice 5: Freeze Handoff To Phase H/I

- `Phase H` 只能消费本 phase 已冻结的 same-site reset backend 与 callback contract。
- `Phase I` 默认补：
  - enumeration-safe response/copy
  - captcha on `request-password-reset`
  - local/staging browser evidence
  - post-reset sign-in smoke

## Proposed Write Set For Later Execution

- `.planning/workstreams/shared-product-surfaces-acceptance-hardening/phases/phase-g-password-reset-backend-and-mail-contract/CONTEXT.md`
- `.planning/workstreams/shared-product-surfaces-acceptance-hardening/phases/phase-g-password-reset-backend-and-mail-contract/PLAN.md`
- `.planning/workstreams/shared-product-surfaces-acceptance-hardening/STATE.md`
- `.planning/workstreams/shared-product-surfaces-acceptance-hardening/ROADMAP.md`
- `.planning/WORKSTREAMS.md`
- `apps/app-api/src/config.ts`
- `apps/app-api/src/modules/auth/auth.ts`
- `apps/app-api/src/app.ts`
- `apps/app-api/src/modules/auth/*`
- `apps/app-api/test/auth-and-db.test.ts`
- `apps/app-api/test/worker.test.ts`
- `apps/app-api/README.md`
- `docs/environment/provider-and-secret-inventory.md`
- `docs/contracts/app-api-http.md`
- `docs/runbooks/staging-worker-deploy-runbook.md`

## Verification Loop

- doc truth:
  - provider inventory、app-api README、deploy/runbook truth 已明确 reset mail provider / sender / secret ownership
  - panel docs 仍明确排除 self-serve password product
- code truth:
  - reset backend 继续挂在 Better Auth same-site `/api/auth/*`
  - provider helper 边界停留在 `apps/app-api`
  - reset redirect validation fail-close
- command truth:
  - `pnpm --dir apps/app-api test:node`
  - `pnpm --dir apps/app-api test:worker`
  - 必要时补充 targeted auth Vitest entry
- readiness truth:
  - reset provider config 缺失时，相关 gate 有明确失败信号
  - config 齐备时，auth readiness 不再只代表 sign-in/sign-up 可用
- research truth:
  - Better Auth 官方能力已经覆盖 request/reset/callback contract
  - Better Auth captcha 默认已把 `request-password-reset` 纳入保护端点
  - Resend 官方支持 Cloudflare Workers JS 调用

## Exit Rule

Phase G 完成后，repo 应达到：

- `app-api` 已拥有 canonical password reset backend
- reset mail provider / sender / secret / runbook truth 已落盘
- same-site reset callback contract 已冻结
- `Phase H` 可以直接接 `/forgot-password` `/reset-password` UX，而不必继续追问 backend/provider 决策
