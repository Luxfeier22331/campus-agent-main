---
phase: "K"
name: "Public Auth Shell Mature Layout Cutover"
created: 2026-04-20
updated: 2026-04-20
status: completed
---

# Phase K Summary

## What Closed

- 把 `public-chat-web` public auth family 的 outer layout owner 从 vendor fallback 收口到 repo-owned compat seam：`@/app/(auth)/layout` 现在由 `src/platform/vendor-compat/app/auth-layout.tsx` 精确接管。
- 删除 donor auth shell 的右侧 `Preview` 与 `Powered by AI Gateway`，把 `/login` `/register` `/forgot-password` `/reset-password` 统一切到成熟的单栏 auth shell。
- 保持 donor `AuthForm`、submit button、toast 与既有 Better Auth / Turnstile / same-site `/api/auth/*` contract，不在这个 phase 重开 action logic。

## Fresh Evidence

- `.tmp/local-smoke/20260420T003016+0800-sps-phase-k-auth-shell/SUMMARY.md`
- `pnpm --dir apps/public-chat-web typecheck`
- `pnpm --dir apps/public-chat-web test:worker`
- `pnpm --dir apps/public-chat-web exec vitest run test/public-chat-auth-regressions.test.ts test/worker.test.ts`
- `pnpm --dir apps/public-chat-web build`

## Handoff

- workstream 仍保持 `Phase J` 为当前 blocker；后续真实 staging browser smoke 必须直接基于新的 mature auth shell 执行，不再接受 donor split preview 作为 closeout 基线。
- `Phase J` 继续只收口 Turnstile runtime/delivery truth 与真实浏览器 evidence，不回退重开 auth shell owner 问题。
