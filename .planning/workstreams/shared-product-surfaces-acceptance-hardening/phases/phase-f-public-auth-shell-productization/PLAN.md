---
doc_type: phase_plan
phase: "F"
phase_name: "Public Auth Shell Productization"
status: planned
created: 2026-04-19
updated: 2026-04-19
---

# Phase F Plan

## Objective

把 `public-chat-web` 的 `/login` `/register` 从历史上“repo-owned but out-of-scope donor wrapper”的定位收口成正式 public auth surface，并冻结后续 forgot/reset password 必须依附的可见壳与路由契约。

## Why This Phase Exists

当前 repo 真正的问题不是“没有 donor auth shell”，而是：

- `Phase F` kickoff 时，`/login` `/register` 已在 runtime 上可用，但 route-state inventory 仍把它们标成 `out-of-scope`
- 可见 auth shell 没有进入正式产品面治理，因此后续加入 forgot-password 容易重新长出 repo 自写页面
- `protected-panel-web` 的 Access reentry 页面容易与 public end-user auth 问题混淆

所以必须先冻结 visible auth surface 的 owner 与边界，再进入 reset backend。

## External References

- Vercel AI Chatbot repository:
  - https://github.com/vercel/chatbot
- donor auth layout:
  - https://github.com/vercel/chatbot/blob/main/app/%28auth%29/layout.tsx
- donor auth form:
  - https://github.com/vercel/chatbot/blob/main/components/chat/auth-form.tsx
- Better Auth email/password docs:
  - https://www.better-auth.com/docs/authentication/email-password
- Better Auth captcha plugin docs:
  - https://www.better-auth.com/docs/plugins/captcha

## Decisions To Freeze

1. 这条 reopen slice 仍属于 `shared product surfaces acceptance / hardening`，不拆成独立 auth workstream。
2. 这次只覆盖 `public-chat-web + app-api` 的 end-user auth surface，不覆盖 panel。
3. visible auth shell 的 owner 继续是 donor `AuthLayout` / `AuthForm` 语言，不回退成 repo 自写登录页。
4. repo-owned 差异只允许停留在 route bootstrap、same-site Better Auth action adapter、institution copy 与 recovery CTA。
5. `/login`、`/register`、future `/forgot-password`、future `/reset-password` 属于同一 public auth family，必须共享一套可见壳。
6. `protected-panel-web` 的 `/login` 固定继续只是 Cloudflare Access reentry，不引入本地密码或 reset affordance。

## Execution Slices

### Slice 1: Freeze Visible Auth Surface Contract

- 明确 `/login` `/register` 是正式 `public auth surface`，但不进入 strict chat parity score
- 更新 public auth inventory / parity wording：
  - `docs/reference/public-chat-web-route-state-parity-inventory.md`
  - `docs/reference/public-chat-web-donor-parity-review-checklist.md`
- 明确 `/login` `/register` 的 required states：
  - idle
  - pending
  - submission error
  - authenticated redirect
- 明确 future recovery surfaces 将挂在同一 auth family，而不是新建独立视觉语言

### Slice 2: Freeze Shell Ownership And Allowed Diffs

- donor layout / form 继续是 visible owner
- repo 允许收口的差异固定为：
  - campus product copy
  - same-site action adapter
  - vendor compat seam
  - recovery CTA
  - route bootstrap / redirect semantics
- 明确当前 Phase F 的 repo-owned write boundary，不把 donor auth runtime 带回 repo 主路径：
  - `apps/public-chat-web/src/login/*`
  - `apps/public-chat-web/src/routes/app-router.tsx`
  - `apps/public-chat-web/src/platform/auth/client.ts`
  - `apps/public-chat-web/src/platform/vendor-compat/next-auth/*`
- donor vendor tree 默认只读；只有在 repo-owned wrapper 无法承载既定 copy / CTA placement 时，才允许最小化触碰具体 donor auth file

### Slice 3: Freeze Route And Redirect Contract

- `/login`、`/register` 继续在已登录后跳 `/chat`
- `/login` 必须为 future forgot-password 提供 recovery CTA placement
- `/register` 继续只承担 sign-up，不承担 recovery start
- `/forgot-password` 与 `/reset-password` 的加入不得改变 `/chat` protected route gating
- reset flow 完成后默认回到 `/login` 或显式成功页，不直接旁路到 panel 或其他 surface

### Slice 4: Freeze Acceptance Matrix

- desktop / mobile 都进入 auth-shell acceptance
- Phase F 的验证必须收口为可执行命令与 evidence artifact，而不是抽象 smoke 描述：
  - repo guardrails:
    - `pnpm --dir apps/public-chat-web typecheck`
    - `pnpm --dir apps/public-chat-web test:worker`
    - `pnpm --dir apps/public-chat-web exec vitest run test/public-chat-auth-regressions.test.ts test/public-chat-auth-actions.test.ts test/worker.test.ts`
  - local browser smoke entry:
    - `pnpm --dir apps/public-chat-web dev:live-smoke`
  - required artifact pack:
    - `.tmp/local-smoke/<timestamp>-sps-phase-f-auth-shell/SUMMARY.md`
    - `.tmp/local-smoke/<timestamp>-sps-phase-f-auth-shell/desktop-login.png`
    - `.tmp/local-smoke/<timestamp>-sps-phase-f-auth-shell/mobile-login.png`
    - `.tmp/local-smoke/<timestamp>-sps-phase-f-auth-shell/desktop-register.png`
    - `.tmp/local-smoke/<timestamp>-sps-phase-f-auth-shell/mobile-register.png`
    - `.tmp/local-smoke/<timestamp>-sps-phase-f-auth-shell/network-auth.md`
- local smoke pass criteria 固定为：
  - `/login` 与 `/register` 都显示 donor auth shell，而不是 repo 自写模式切换页
  - fresh register success redirect 到 `/chat`
  - sign-out 后可回到 `/login`
  - same credentials 在 `/login` sign-in success redirect 到 `/chat`
  - auth network 继续保持 same-site `/api/auth/*`
  - runtime 中不出现 panel login/password-reset affordance 混入
- code-level guardrails 继续复用：
  - `apps/public-chat-web/test/public-chat-auth-regressions.test.ts`
  - `apps/public-chat-web/test/public-chat-auth-actions.test.ts`
  - `apps/public-chat-web/test/worker.test.ts`

### Slice 5: Freeze Handoff To Phase G

- 明确 `Phase G` 的 mail/reset backend 只能消费本 phase 已冻结的 route family 与 CTA placement
- 不允许在 `Phase G` 为了后端实现便利反过来重开 auth shell owner 讨论
- `Phase H` 只能在 donor auth shell family 内补 `/forgot-password` `/reset-password`，不另起新壳
- `Phase I` 的 hardening 默认覆盖：
  - enumeration-safe copy
  - rate limiting / anti-abuse baseline
  - same-site origin contract
  - post-reset sign-in smoke
  - optional captcha follow-up if baseline abuse controls 仍不足

## Proposed Write Set For Later Execution

- `.planning/workstreams/shared-product-surfaces-acceptance-hardening/phases/phase-f-public-auth-shell-productization/CONTEXT.md`
- `.planning/workstreams/shared-product-surfaces-acceptance-hardening/phases/phase-f-public-auth-shell-productization/PLAN.md`
- `.planning/workstreams/shared-product-surfaces-acceptance-hardening/STATE.md`
- `apps/public-chat-web/src/login/page.tsx`
- `apps/public-chat-web/src/login/register-page.tsx`
- `apps/public-chat-web/src/routes/app-router.tsx`
- `apps/public-chat-web/src/platform/auth/client.ts`
- `apps/public-chat-web/src/platform/vendor-compat/next-auth/react.tsx`
- `apps/public-chat-web/test/public-chat-auth-regressions.test.ts`
- `apps/public-chat-web/test/public-chat-auth-actions.test.ts`
- `apps/public-chat-web/test/worker.test.ts`
- `apps/public-chat-web/README.md`
- `docs/reference/public-chat-web-route-state-parity-inventory.md`
- `docs/reference/public-chat-web-donor-parity-review-checklist.md`

## Verification Loop

- doc truth:
  - workstream docs、route inventory、parity checklist 不再把 `/login` `/register` 写成长期 `out-of-scope`
  - Phase F write set 不触碰 reset backend、mail provider inventory 或 panel auth scope
- code truth:
  - `/login` `/register` 仍由 donor `AuthLayout` / `AuthForm` 驱动
  - runtime auth owner 仍是 `apps/app-api` Better Auth + same-site `/api/auth/*`
  - `protected-panel-web` README 仍明确排除 self-serve password product
- command truth:
  - `pnpm --dir apps/public-chat-web typecheck` 通过
  - `pnpm --dir apps/public-chat-web test:worker` 通过
  - `pnpm --dir apps/public-chat-web exec vitest run test/public-chat-auth-regressions.test.ts test/public-chat-auth-actions.test.ts test/worker.test.ts` 通过
- smoke truth:
  - local `dev:live-smoke` artifact pack 按既定路径落盘
  - `SUMMARY.md` 明确记录 desktop/mobile shell、register redirect、login redirect 与 same-site auth network 判定
- research truth:
  - donor official repo 仍把可见 auth shell 与自己的 auth runtime 绑在一起
  - Better Auth 官方文档已覆盖 password reset 和后续 captcha hardening 能力

## Exit Rule

Phase F 完成后，repo 应达到：

- `/login` `/register` 不再只是“可用但不治理”的边缘页面
- donor auth shell 的 visible ownership 与 allowed diffs 已冻结
- public auth family 的 route contract 已明确包含后续 recovery surfaces
- local auth-shell evidence pack 已按约定落盘
- Phase F 没有提前落入 `Phase G` 的 reset backend / mail contract 文件
- `Phase G` 可以直接实现 reset backend / mail contract，而不是继续重开视觉与边界讨论
