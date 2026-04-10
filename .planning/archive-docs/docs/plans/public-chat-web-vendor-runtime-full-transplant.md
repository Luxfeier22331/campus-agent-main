---
doc_type: plan
status: completed
created: 2026-04-09
updated: 2026-04-09
---

# Public Chat Web Vendor Runtime Full Transplant

## 文档边界

本文固定 `apps/public-chat-web` 当前 strict donor parity 的前向实施方案。

本文回答的是：

- `public-chat-web` 的 chat frontend 最终应如何落地
- 当前 strict parity 还差哪些工作
- repo-owned seam 的允许边界是什么
- `unsupported feature` 当前应如何处理，才不会再次污染 donor shell

本文不负责：

- 改写 `public-chat-web -> app-api -> supervisor-api` accepted topology
- 把 upstream backend、Next.js server runtime、NextAuth、Vercel deployment truth 带进 repo
- 把 `/login` 纳入 donor parity 本身

## 直接结论

当前 `public-chat-web` 的 forward target 固定为：

`vendor-owned chat runtime + repo-owned platform seams`

当前问题已经不再是“有没有 donor shell”，而是把已关闭的 donor parity 结果固定成回归基线。

`2026-04-09` 当前结论：

`Wave 6 已完成，strict donor parity release gate 已关闭。`

## 当前已确认真相

以下事实已经成立，并继续保留：

- `@/*` 已固定指向 `vendor/vercel-ai-chatbot/*`
- `src/routes/app-router.tsx` 已切为 TanStack Router 入口
- `/login` 已迁到 `src/login/page.tsx`
- chat runtime 已迁到 `src/platform/chat/app-shell.tsx` + `src/platform/chat/runtime.tsx`
- `src/chatbot-donor/`、`src/chatbot-shell/`、`src/public-chat/` 已退出当前 runtime path
- same-site `/api/*` seam 继续成立
- staging 上默认 `/chat` donor-derived shell、preview seam 清理、single-route cutover 都已落证
- Wave 6 donor diff whitelist 已落盘到 [public-chat-web-donor-diff-whitelist.md](/home/reptilian/code/campus-agent/docs/reference/public-chat-web-donor-diff-whitelist.md)
- fresh local gate 已通过：`pnpm --dir apps/public-chat-web test:worker`、`pnpm --dir apps/public-chat-web typecheck`、`pnpm --dir apps/public-chat-web build`
- 当前 authoritative staging evidence 已落盘到 [SUMMARY.md](/home/reptilian/code/campus-agent/.tmp/staging-smoke/20260409T232000+0800-public-chat-wave6-closeout-2/SUMMARY.md)
- 这轮 closeout 基于真实登录会话采集；Chrome DevTools MCP 在本轮持续 `Transport closed`，因此浏览器证据改由 `Playwright MCP` 收集
- Wave 6 过程中额外发现的 `share / visibility on launch path` blocker 已关闭；当前 campus mode 固定为 `private-only`

以下事实当前不再成立：

- 把 `public-chat-web` 继续表述为 active strict parity blocker
- `share / visibility` 可以继续留在 launch path 只靠 repo toast 降级
- `public-chat-web` 还需要继续做 donor-visible patch continuation

## 当前 blocker 分组

### 1. Route Entry States

当前状态：

- `2026-04-09` 当前 worktree 已完成 code-level 收口：`/chat` 主路径上的 repo-owned `RouteStatusCard` 已退出 runtime path
- route entry gating 已前移到 route ownership：仅保留 route-level `loading` bootstrap，`session error / access blocked` 与 `authenticated but cannot chat` 全部直接回到 repo-owned `/login` ownership，`app-shell` 不再持有 redirect/fallback
- 这一项当前已完成 closeout，不再是当前 blocker

责任文件：

- [app-router.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/src/routes/app-router.tsx)
- [app-shell.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/src/platform/chat/app-shell.tsx)

### 2. Composer Navigation Semantics

当前状态：

- `2026-04-09` 当前 worktree 已恢复 donor-equivalent first-turn route ownership：composer 与 suggested actions 都会在发送前预占 `/chat/:conversationId`
- `use-active-chat` 不再等待服务端 canonical redirect；`app-api` 同时接受 caller-provided `conversationId` 作为首轮会话主键
- 这一项当前已完成 closeout，不再是当前 blocker

责任文件：

- [multimodal-input.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/vendor/vercel-ai-chatbot/components/chat/multimodal-input.tsx)
- [suggested-actions.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/vendor/vercel-ai-chatbot/components/chat/suggested-actions.tsx)
- [message-editor.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/vendor/vercel-ai-chatbot/components/chat/message-editor.tsx)
- [use-active-chat.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/src/platform/chat/use-active-chat.tsx)
- [service.ts](/home/reptilian/code/campus-agent/apps/app-api/src/modules/runtime-command/service.ts)

### 3. Sidebar / History / User-Nav Actions

当前状态：

- `2026-04-09` 当前 worktree 已完成 code-level 收口：logo、新建会话、切会话、删除当前会话、退出登录现在都只保留 route/auth seam 映射，不再附带 repo-local fallback flow
- 退出登录链上的 repo-local error toast 已移除；这组动作当前不再是已确认 blocker
- 这一项当前已完成 closeout，不再是当前 blocker

责任文件：

- [app-sidebar.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/vendor/vercel-ai-chatbot/components/chat/app-sidebar.tsx)
- [sidebar-history.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/vendor/vercel-ai-chatbot/components/chat/sidebar-history.tsx)
- [sidebar-history-item.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/vendor/vercel-ai-chatbot/components/chat/sidebar-history-item.tsx)
- [sidebar-user-nav.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/vendor/vercel-ai-chatbot/components/chat/sidebar-user-nav.tsx)

### 4. Message / Tool Rendering

当前状态：

- `2026-04-09` 当前 worktree 已完成 code-level 收口：weather/document/suggestion/tool output 已移除 repo-local guards、fallback card 与 repo-owned `output-error` path，thread 内已回到 donor-equivalent direct-output behavior
- 这一项当前已完成 closeout，不再是当前 blocker

责任文件：

- [message.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/vendor/vercel-ai-chatbot/components/chat/message.tsx)
- [messages.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/vendor/vercel-ai-chatbot/components/chat/messages.tsx)

### 5. Artifact / Document Runtime

当前状态：

- `2026-04-09` 当前 worktree 已完成 code-level 收口：artifact pane 已回到 donor direct import path，artifact stream ownership 已收回 `artifactDefinitions`，`document-preview` 与 `text-editor` 也已回到 donor-equivalent static editor/runtime 路径
- 这一项当前已完成 closeout，不再是当前 blocker

责任文件：

- [shell.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/vendor/vercel-ai-chatbot/components/chat/shell.tsx)
- [data-stream-handler.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/vendor/vercel-ai-chatbot/components/chat/data-stream-handler.tsx)
- [document-preview.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/vendor/vercel-ai-chatbot/components/chat/document-preview.tsx)
- [text-editor.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/vendor/vercel-ai-chatbot/components/chat/text-editor.tsx)

### 6. Strict Parity Gates

当前状态：

- donor diff whitelist 已落盘
- fresh local gate 与 fresh staging smoke 都已补齐
- strict parity checklist 当前已为 `PASS`

责任文件：

- [public-chat-web-donor-diff-whitelist.md](/home/reptilian/code/campus-agent/docs/reference/public-chat-web-donor-diff-whitelist.md)
- [public-chat-web-donor-parity-review-checklist.md](/home/reptilian/code/campus-agent/docs/reference/public-chat-web-donor-parity-review-checklist.md)
- [public-chat-web-route-state-parity-inventory.md](/home/reptilian/code/campus-agent/docs/reference/public-chat-web-route-state-parity-inventory.md)
- [public-chat-web-strict-donor-parity-gap-inventory.md](/home/reptilian/code/campus-agent/docs/reference/public-chat-web-strict-donor-parity-gap-inventory.md)

## Ownership Matrix

| 范围 | 最终 owner | 允许存在的目录 | 禁止继续承担的目录 |
|---|---|---|---|
| chat 可见 UI | `vendor/vercel-ai-chatbot/` | `vendor/vercel-ai-chatbot/components/chat/*` | repo-owned chat clone、route-owned visible fallback |
| chat runtime hook / lib | `vendor/vercel-ai-chatbot/` + `src/platform/*` | `vendor/vercel-ai-chatbot/hooks/*`, `vendor/vercel-ai-chatbot/lib/*`, `src/platform/*` | visible-behavior patch layer |
| platform seam | repo-owned | `src/platform/*` | vendor-visible behavior owner |
| login | repo-owned | `src/login/*` | vendor auth UI |
| route integration | repo-owned | `src/routes/*`, `src/platform/router/*` | product-visible `/chat` shell owner |
| Worker shell | repo-owned | `src/index.ts` | vendor runtime / Next server files |

## Unsupported Feature Policy

这里固定新的执行规则：

- `unsupported feature` 当前不做永久切除
- 这些能力未来可能重新上线，因此源码可以继续保留在 vendor tree
- 但这不再授权任何 donor-visible patch continuation

本轮固定三条规则：

1. 如果某个能力仍出现在 launch path，它的样式与组件行为不能因为 repo patch 而偏离 donor。
2. 如果某个能力当前确实无法以 donor behavior 上线，只能把 launch affordance 从当前路径脱线，不能改造成 repo-owned fallback UI。
3. 源码保留、能力后置、未来重开，和“当前允许 donor-visible drift”是两件不同的事。

## 执行波次

### Wave 1：Route Entry States 收口

- 目标：去掉 `/chat` 主路径上的 repo-owned route status baseline
- 交付物：route entry behavior 对齐 donor，或明确只保留不进入可见产品主路径的 bootstrap logic

### Wave 2：Composer Navigation 还原

- 目标：恢复 donor 的 submit / push / delete / edit 路由语义
- 交付物：composer 与 message edit 的 donor-equivalent navigation behavior
- `2026-04-09` 当前 worktree 已完成 code-level 收口，且同日 Wave 6 evidence 也已补齐

### Wave 3：Sidebar / History / User-Nav 还原

- 目标：恢复 donor 的 rail action semantics
- 交付物：新建、切换、删除、退出登录的 donor-equivalent 行为
- `2026-04-09` 当前 worktree 已完成 code-level 收口；退出登录后的 `/login` 跳转 ownership 已收回 `@platform/auth/client`，`sidebar-user-nav` 不再手动维护本地 session/reset/replace 链，同日 Wave 6 evidence 也已补齐

### Wave 4：Message / Tool Rendering 还原

- 目标：把 thread 内 repo-local fallback 清出 donor-visible path
- 交付物：message/tool rendering 重新回到 donor behavior
- `2026-04-09` 当前 worktree 已完成 code-level 收口；前端可见 tool contract 已在 `lib/types.ts` 收口，`message.tsx` 即使保留 TypeScript 所需的 type-only narrowing，也不再依赖 repo-owned runtime fallback branch 维持 donor visible path，同日 Wave 6 evidence 也已补齐

### Wave 5：Artifact / Document Runtime 还原

- 目标：把 artifact/document runtime 从 patched donor 改回 donor-equivalent behavior
- 交付物：artifact panel、document preview、editor runtime、stream handler 收口
- `2026-04-09` 当前 worktree 已完成 code-level 收口，同日 Wave 6 evidence 也已补齐

### Wave 6：Strict Parity Gate 与 Smoke 收口

- 目标：建立 donor diff whitelist 与真实浏览器 parity evidence
- 交付物：
  - donor diff whitelist / targeted tests
  - desktop `1440x900` 与 mobile `390x844` smoke
  - strict parity checklist 更新为 `PASS`
- `2026-04-09` 当前结果：
  - whitelist 已落盘到 [public-chat-web-donor-diff-whitelist.md](/home/reptilian/code/campus-agent/docs/reference/public-chat-web-donor-diff-whitelist.md)
  - authoritative staging evidence 已落盘到 [SUMMARY.md](/home/reptilian/code/campus-agent/.tmp/staging-smoke/20260409T232000+0800-public-chat-wave6-closeout-2/SUMMARY.md)
  - `share / visibility on launch path` blocker 已关闭并进入 whitelist regression gate
  - `/api/models` 已由 repo-owned Worker route 稳定返回 `200`，之前浏览器看到的 `/api/history 401` 已确认只是 stale non-cookie Playwright state，不再构成 blocker
  - strict parity checklist 当前已为 `PASS`

## Definition Of Done

只有同时满足以下条件，本文目标才算完成：

- `/chat` 与 `/chat/:conversationId` 的样式和组件行为都与 `.tmp/vercel-ai-chatbot` 严格对齐
- `vendor/vercel-ai-chatbot` 是唯一 chat UI owner
- repo-owned 路由、platform、Worker seam 不再改写 donor-visible behavior
- `/login` 之外不再存在 repo-owned visible fallback baseline
- local gate 通过：
  - `pnpm --dir apps/public-chat-web typecheck`
  - `pnpm --dir apps/public-chat-web test:worker`
  - `pnpm --dir apps/public-chat-web build`
- strict donor parity checklist 关闭
- staging smoke 与 donor parity smoke 给出正向证据

`2026-04-09` 当前结果：以上条件已满足。

## 相关文档

- [public-chat-web-donor-first-reset.md](/home/reptilian/code/campus-agent/.planning/archive-docs/docs/plans/public-chat-web-donor-first-reset.md)
- [public-chat-web-chatbot-donor-baseline.md](/home/reptilian/code/campus-agent/docs/reference/public-chat-web-chatbot-donor-baseline.md)
- [public-chat-web-donor-diff-whitelist.md](/home/reptilian/code/campus-agent/docs/reference/public-chat-web-donor-diff-whitelist.md)
- [public-chat-web-route-state-parity-inventory.md](/home/reptilian/code/campus-agent/docs/reference/public-chat-web-route-state-parity-inventory.md)
- [public-chat-web-strict-donor-parity-gap-inventory.md](/home/reptilian/code/campus-agent/docs/reference/public-chat-web-strict-donor-parity-gap-inventory.md)
