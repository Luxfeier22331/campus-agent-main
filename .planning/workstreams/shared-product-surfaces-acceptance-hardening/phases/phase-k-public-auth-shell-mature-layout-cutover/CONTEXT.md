---
phase: "K"
name: "Public Auth Shell Mature Layout Cutover"
created: 2026-04-20
updated: 2026-04-20
status: completed
---

# Phase K Context

## Goal

把 `public-chat-web` 的 public auth family 从当前 donor split auth shell 收口为更成熟的单壳设计：去掉右侧聊天窗口预览，保留 donor form language 与 repo 已冻结的 auth/runtime contract，并把 outer auth layout owner 提升为 repo-owned compat seam。

## Current Truth

- `Phase F` 已把 `/login` `/register` 正式收口为 public auth surface，并冻结了 future `/forgot-password` `/reset-password` 必须挂在同一 auth family。
- 当前四个页面：
  - `/login`
  - `/register`
  - `/forgot-password`
  - `/reset-password`
  都共享 `AuthLayout`。
- 这个 `AuthLayout` 当前不是 repo-owned compat seam，而是直接落在 vendor donor tree：
  - `apps/public-chat-web/vendor/vercel-ai-chatbot/app/(auth)/layout.tsx`
- donor layout 当前包含两栏 split shell：
  - 左侧为 auth content
  - 右侧为 `Preview` 聊天窗口预览与 `Powered by AI Gateway` 文案
- 当前 repo 已经对 donor auth form 做了精确 compat ownership：
  - `@/components/chat/auth-form` -> `src/platform/vendor-compat/components/chat/auth-form.tsx`
- 但 `@/app/(auth)/layout` 还没有同等级的精确 compat seam；它当前仍通过 `@/* -> vendor/vercel-ai-chatbot/*` 兜底进 donor file。

## Why This Phase Exists

当前 auth shell 的问题不是“没有 donor auth shell”，而是 donor 原版 layout 的右侧 `Preview` 更偏 demo / marketing 语言，不适合作为正式校园 end-user auth entry：

- 它会分散登录、注册、找回密码的注意力
- 会把“正式账号入口”做成类似产品落地页或 playground
- 会让 repo 继续把 auth outer shell 的 visible owner 留在 vendor file，而不是自己明确接管

这与当前 workstream 已经把 public auth family 提升为正式产品面的事实不一致。

## Locked Decisions

### Visible Product Decision

- public auth family 不再保留右侧聊天窗口预览。
- auth shell 应表现为成熟的账号入口，而不是 chat product teaser。

### Ownership Decision

- outer auth layout 的 owner 应提升为 repo-owned compat seam。
- donor tree 继续只读；不要再直接改 vendor `app/(auth)/layout.tsx` 作为长期方案。

### Scope Decision

- 本 phase 只改 visible shell、layout ownership 与相应 smoke evidence。
- 不重开以下已冻结事实：
  - Better Auth backend owner
  - Turnstile transport 与 runtime seam
  - same-site `/api/auth/*`
  - login/register/recovery route family
  - panel exclusion

### Visual Decision

- 桌面端改为更克制的单栏 auth shell，而不是 split view。
- 移动端继续保持单栏，但要与桌面共享同一视觉语言。
- 页面允许保留品牌标识、返回入口、辅助说明与底部 CTA，但不再保留 chat preview / prompt suggestions / fake composer。

## Existing Code Insights

### Relevant Files

- donor outer layout:
  - `apps/public-chat-web/vendor/vercel-ai-chatbot/app/(auth)/layout.tsx`
- repo-owned auth pages:
  - `apps/public-chat-web/src/login/page.tsx`
  - `apps/public-chat-web/src/login/register-page.tsx`
  - `apps/public-chat-web/src/login/forgot-password-page.tsx`
  - `apps/public-chat-web/src/login/reset-password-page.tsx`
- repo-owned auth form compat seam:
  - `apps/public-chat-web/src/platform/vendor-compat/components/chat/auth-form.tsx`
- alias configuration:
  - `apps/public-chat-web/tsconfig.json`
  - `apps/public-chat-web/vite.config.ts`
- regression coverage:
  - `apps/public-chat-web/test/public-chat-auth-regressions.test.ts`

### Current Technical Gap

- `AuthLayout` 没有精确 alias。
- 如果继续直接改 vendor file，会让后续 donor upgrade、owner boundary 与测试断言继续模糊。
- 正确方向是新增类似 `AuthForm` 的 repo-owned compat seam，再让四个 auth page 继续通过 `AuthLayout` 使用它。

## Non-goals

- 不改 Better Auth action logic
- 不改 Turnstile widget/runtime contract
- 不改 same-site `/api/auth/*` proxy contract
- 不重开 `Phase J` 的 adaptive posture 逻辑
- 不引入第二套 auth shell
- 不把 auth page 再做成 landing page / marketing page

## Canonical References

- `.planning/workstreams/shared-product-surfaces-acceptance-hardening/ROADMAP.md`
- `.planning/workstreams/shared-product-surfaces-acceptance-hardening/REQUIREMENTS.md`
- `.planning/workstreams/shared-product-surfaces-acceptance-hardening/STATE.md`
- `.planning/workstreams/shared-product-surfaces-acceptance-hardening/phases/phase-f-public-auth-shell-productization/PLAN.md`
- `.planning/workstreams/shared-product-surfaces-acceptance-hardening/phases/phase-j-adaptive-turnstile-posture-productization/PLAN.md`
- `docs/plans/archive/completed/shared-product-surfaces-acceptance-hardening.md`
- `apps/public-chat-web/vendor/vercel-ai-chatbot/app/(auth)/layout.tsx`
- `apps/public-chat-web/src/platform/vendor-compat/components/chat/auth-form.tsx`
- `apps/public-chat-web/src/login/page.tsx`
- `apps/public-chat-web/src/login/register-page.tsx`
- `apps/public-chat-web/src/login/forgot-password-page.tsx`
- `apps/public-chat-web/src/login/reset-password-page.tsx`
- `apps/public-chat-web/tsconfig.json`
- `apps/public-chat-web/vite.config.ts`
- `apps/public-chat-web/test/public-chat-auth-regressions.test.ts`
