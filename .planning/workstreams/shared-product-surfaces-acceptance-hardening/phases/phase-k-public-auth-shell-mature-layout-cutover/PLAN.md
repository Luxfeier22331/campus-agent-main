---
doc_type: phase_plan
phase: "K"
phase_name: "Public Auth Shell Mature Layout Cutover"
status: completed
created: 2026-04-20
updated: 2026-04-20
---

# Phase K Plan

## Objective

去掉 `public-chat-web` public auth family 的右侧聊天窗口预览，把 `/login` `/register` `/forgot-password` `/reset-password` 统一切到更成熟的单壳设计，并把 outer auth layout owner 从 vendor donor file 收口到 repo-owned compat seam。

## Why This Phase Exists

当前 visible auth shell 虽然来自 donor，但它的 split preview 不是成熟的 end-user auth shell：

- 右侧 `Preview` 是 chat teaser，不是账号入口所需信息
- `Powered by AI Gateway` 文案不属于当前校园 auth shell 的可信入口语言
- outer layout 继续依赖 vendor file，会让 owner boundary 不清晰

因此这不是简单删一个组件，而是一次 auth shell owner cutover。

## Decisions To Freeze

1. public auth family 不再保留右侧聊天窗口预览。
2. auth shell 改为更成熟的单栏 outer shell，而不是 split view。
3. outer auth layout 必须变成 repo-owned compat seam；不要长期直接改 vendor donor file。
4. donor `AuthForm`、submit button、toast、field language 继续尽量保留，除非实现单壳设计必须微调。
5. `/login` `/register` `/forgot-password` `/reset-password` 必须共享同一 shell。
6. 不重开 Better Auth、Turnstile、same-site `/api/auth/*`、route family 或 panel exclusion。

## Execution Slices

### Slice 1: Introduce Repo-Owned Auth Layout Compat Seam

- 新增 repo-owned auth layout file，例如：
  - `apps/public-chat-web/src/platform/vendor-compat/app/auth-layout.tsx`
- 在 `tsconfig.json` 与 `vite.config.ts` 增加精确 alias：
  - `@/app/(auth)/layout`
- 让 auth pages 继续通过 `AuthLayout` 导入，但解析到 repo-owned compat seam，而不是 vendor fallback

### Slice 2: Replace Split Preview With Mature Single-Panel Shell

- 删除以下 donor-visible affordance：
  - 右侧 `Preview`
  - `Powered by AI Gateway`
  - preview 内的 fake prompt suggestions / fake composer
- 新 shell 视觉方向固定为：
  - 单栏、垂直居中、宽度受控
  - 保留返回入口与品牌标识
  - 表单卡片或受控内容区
  - 登录/注册/恢复页面共用同一背景与 spacing language
- 桌面端不再占用右半屏做 demo 面板；移动端保持同一结构自然收缩

### Slice 3: Keep Auth Family Contract Intact

- `/login`：
  - 继续保留 register / forgot-password CTA
- `/register`：
  - 继续只承担 sign-up CTA
- `/forgot-password`：
  - 继续保留 neutral success copy
- `/reset-password`：
  - 继续保留 reset success / invalid / expired states
- 上述四页只切壳，不重写其 action/state machine

### Slice 4: Update Regression And Ownership Tests

- 在 `apps/public-chat-web/test/public-chat-auth-regressions.test.ts` 增加或替换断言：
  - `@/app/(auth)/layout` 已有 repo-owned exact alias
  - donor `Preview` 不再出现在 auth shell owner 文件里
  - auth shell 不再含 `Powered by AI Gateway`
- 如有必要，新增单独的 auth-layout ownership test，避免以后 alias 漂回 vendor fallback

### Slice 5: Run Local Acceptance And Capture Fresh Evidence

- 必跑命令：
  - `pnpm --dir apps/public-chat-web typecheck`
  - `pnpm --dir apps/public-chat-web test:worker`
  - `pnpm --dir apps/public-chat-web exec vitest run test/public-chat-auth-regressions.test.ts test/worker.test.ts`
- local browser smoke 至少覆盖：
  - desktop `/login`
  - desktop `/register`
  - desktop `/forgot-password`
  - desktop `/reset-password`
  - mobile `/login`
  - mobile `/register`
- artifact pack：
  - `.tmp/local-smoke/<timestamp>-sps-phase-k-auth-shell/SUMMARY.md`
  - desktop/mobile screenshots
  - 必要时补 shell DOM snapshot

### Slice 6: Handoff To Staging Follow-up

- 本 phase 完成后，如当前 staging 仍未完成 `Phase J` real-browser closeout：
  - 真实 staging auth smoke 应直接基于新 shell 执行
- 如 `Phase J` 已完成：
  - 本 phase 自身需要补一轮 staging visual + continuity smoke，避免“本地单壳、staging 旧壳”漂移

## Proposed Write Set

- `.planning/workstreams/shared-product-surfaces-acceptance-hardening/ROADMAP.md`
- `.planning/workstreams/shared-product-surfaces-acceptance-hardening/REQUIREMENTS.md`
- `.planning/workstreams/shared-product-surfaces-acceptance-hardening/STATE.md`
- `docs/plans/archive/completed/shared-product-surfaces-acceptance-hardening.md`
- `apps/public-chat-web/src/platform/vendor-compat/app/auth-layout.tsx`
- `apps/public-chat-web/tsconfig.json`
- `apps/public-chat-web/vite.config.ts`
- `apps/public-chat-web/src/login/page.tsx`
- `apps/public-chat-web/src/login/register-page.tsx`
- `apps/public-chat-web/src/login/forgot-password-page.tsx`
- `apps/public-chat-web/src/login/reset-password-page.tsx`
- `apps/public-chat-web/test/public-chat-auth-regressions.test.ts`
- `.tmp/local-smoke/*`

## Verification Loop

- ownership truth:
  - `AuthLayout` 已有 repo-owned exact alias，不再依赖 `@/* -> vendor/*` fallback
- visual truth:
  - auth shell 不再出现右侧聊天预览
  - auth shell 不再出现 `Powered by AI Gateway`
  - desktop/mobile 都是单壳设计
- contract truth:
  - four-route auth family 继续共壳
  - Better Auth、Turnstile、same-site `/api/auth/*` 没有回归
- command truth:
  - `pnpm --dir apps/public-chat-web typecheck`
  - `pnpm --dir apps/public-chat-web test:worker`
  - `pnpm --dir apps/public-chat-web exec vitest run test/public-chat-auth-regressions.test.ts test/worker.test.ts`
- smoke truth:
  - fresh local artifact 已落盘
  - 如果进入 staging，则新 shell 的 `/login` `/register` `/forgot-password` `/reset-password` evidence 同步成立

## Exit Rule

Phase K 完成后，repo 应达到：

- public auth family 的 visible shell 已不再是 donor split preview
- outer auth layout owner 已明确回到 repo-owned compat seam
- auth family 四页共享成熟单壳
- local acceptance evidence 已更新
- 后续 staging smoke 不会再基于旧 donor split auth shell
