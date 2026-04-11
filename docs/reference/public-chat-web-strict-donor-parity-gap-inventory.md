---
doc_type: reference
status: active
created: 2026-04-09
updated: 2026-04-11
---

# Public Chat Web Strict Donor Parity Gap Inventory

## 文档边界

本文固定当前 `apps/public-chat-web` chat shell 与本地 donor baseline
`.tmp/vercel-ai-chatbot` 之间的 strict parity 结论。

本文回答的是：

- 当前还有没有 strict parity blocker
- 本轮关闭了哪些 gap
- 哪些源码 diff 属于已接受的 non-blocking seam

本文不负责：

- 替代原始 `diff --no-index` 结果
- 改写 `public-chat-web -> app-api -> supervisor-api` accepted topology
- 把 `/login` 纳入 donor parity 范围

## 结论

`2026-04-09` 当前 strict donor parity release gate 已关闭。

当前 worktree 已同时满足：

- Wave 1-5 code-level correction 全部完成
- Wave 6 donor diff whitelist 已落盘
- fresh local gate 通过：`test:worker`、`typecheck`、`build`
- authoritative staging smoke 通过，并形成新的 authenticated evidence pack：
  - [SUMMARY.md](/home/reptilian/code/campus-agent/.tmp/staging-smoke/20260409T232000+0800-public-chat-wave6-closeout-2/SUMMARY.md)
  - [network-summary.md](/home/reptilian/code/campus-agent/.tmp/staging-smoke/20260409T232000+0800-public-chat-wave6-closeout-2/staging/network-summary.md)

## Blocking Gaps

当前无。

## Closed In Wave 6

| Area | 当前状态 | 当前文件 |
|---|---|---|
| strict parity smoke/evidence | donor diff whitelist、desktop/mobile staging smoke、same-site network evidence 与 fresh local gate 已统一补齐，Wave 6 release gate 已闭合；当前 authoritative pack 已切换到真实登录会话采集的 closeout-2 证据 | [public-chat-web-donor-diff-whitelist.md](/home/reptilian/code/campus-agent/docs/reference/public-chat-web-donor-diff-whitelist.md) [public-chat-web-donor-parity-review-checklist.md](/home/reptilian/code/campus-agent/docs/reference/public-chat-web-donor-parity-review-checklist.md) [SUMMARY.md](/home/reptilian/code/campus-agent/.tmp/staging-smoke/20260409T232000+0800-public-chat-wave6-closeout-2/SUMMARY.md) |
| sharing / visibility on launch path | Wave 6 过程中额外发现的 blocker 已关闭：`chat-header` 与 history item 不再暴露 share/public affordance，`campus` mode 当前固定 private-only | [chat-header.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/vendor/vercel-ai-chatbot/components/chat/chat-header.tsx) [sidebar-history-item.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/vendor/vercel-ai-chatbot/components/chat/sidebar-history-item.tsx) [use-active-chat.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/src/platform/chat/use-active-chat.tsx) [public-chat-donor-diff-whitelist.test.ts](/home/reptilian/code/campus-agent/apps/public-chat-web/test/public-chat-donor-diff-whitelist.test.ts) |
| staging runtime seam | repo-owned `GET /api/models` 已在 Worker shell 内落回 donor 期望语义；之前浏览器里的 `/api/history 401` 已确认不是路由缺陷，而是 stale non-cookie Playwright state | [index.ts](/home/reptilian/code/campus-agent/apps/public-chat-web/src/index.ts) [worker.test.ts](/home/reptilian/code/campus-agent/apps/public-chat-web/test/worker.test.ts) [network-summary.md](/home/reptilian/code/campus-agent/.tmp/staging-smoke/20260409T232000+0800-public-chat-wave6-closeout-2/staging/network-summary.md) |

## Previously Closed In Code

| Area | 当前状态 | 当前文件 |
|---|---|---|
| route entry states | `/chat` 主路径的 entry gating 已全部前移到 route ownership；`app-shell` 不再持有 redirect/fallback | [app-router.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/src/routes/app-router.tsx) [app-shell.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/src/platform/chat/app-shell.tsx) |
| composer navigation semantics | composer 与 suggested actions 会在发送前切到 `/chat/:conversationId`，`use-active-chat` 不再等待服务端 canonical redirect | [multimodal-input.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/vendor/vercel-ai-chatbot/components/chat/multimodal-input.tsx) [suggested-actions.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/vendor/vercel-ai-chatbot/components/chat/suggested-actions.tsx) [use-active-chat.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/src/platform/chat/use-active-chat.tsx) |
| sidebar/history/user-nav actions | rail actions 已回到 donor-equivalent 路径；退出登录后的 `/login` 跳转 ownership 已收回 `@platform/auth/client` | [app-sidebar.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/vendor/vercel-ai-chatbot/components/chat/app-sidebar.tsx) [sidebar-history.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/vendor/vercel-ai-chatbot/components/chat/sidebar-history.tsx) [sidebar-history-item.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/vendor/vercel-ai-chatbot/components/chat/sidebar-history-item.tsx) [sidebar-user-nav.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/vendor/vercel-ai-chatbot/components/chat/sidebar-user-nav.tsx) |
| message/tool rendering | weather/document/suggestion/tool output 已回到 donor-equivalent thread path，不再存在 repo-owned fallback card 或 runtime compatibility branch | [message.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/vendor/vercel-ai-chatbot/components/chat/message.tsx) [public-chat-message-parity.test.ts](/home/reptilian/code/campus-agent/apps/public-chat-web/test/public-chat-message-parity.test.ts) |
| artifact/document runtime | artifact pane、document preview、editor runtime 与 data-stream handler 已回到 donor-equivalent 路径 | [shell.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/vendor/vercel-ai-chatbot/components/chat/shell.tsx) [data-stream-handler.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/vendor/vercel-ai-chatbot/components/chat/data-stream-handler.tsx) [public-chat-artifact-runtime-parity.test.ts](/home/reptilian/code/campus-agent/apps/public-chat-web/test/public-chat-artifact-runtime-parity.test.ts) |

## Accepted Non-Blocking Diffs

以下差异当前属于 whitelist 或已接受 seam，不计入 blocker；path-level inventory 固定看 [public-chat-web-donor-diff-classification.md](/home/reptilian/code/campus-agent/docs/reference/public-chat-web-donor-diff-classification.md)：

| Area | 当前说明 | 当前文件 |
|---|---|---|
| header seam | vendor header 已恢复 donor `next/link` import，当前通过 exact router compat seam 映射到 repo runtime，不视为 donor-visible blocker | [chat-header.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/vendor/vercel-ai-chatbot/components/chat/chat-header.tsx) [link.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/src/platform/vendor-compat/next/link.tsx) [public-chat-web-donor-diff-whitelist.md](/home/reptilian/code/campus-agent/docs/reference/public-chat-web-donor-diff-whitelist.md) |
| attachment preview/image seam | vendor attachment preview 已恢复 donor `next/image` import，当前通过 exact image compat seam 映射到 Worker-compatible image runtime，属于 allowlisted image seam | [preview-attachment.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/vendor/vercel-ai-chatbot/components/chat/preview-attachment.tsx) [image.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/src/platform/vendor-compat/next/image.tsx) [app-image.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/src/platform/ui/app-image.tsx) |
| artifact query compat seam | donor `artifacts/actions.ts` 已恢复 `@/lib/db/queries` import，当前只在该 importer 上经由 exact compat resolver 映射到 same-site `/api/suggestions` fetch seam | [vite.config.ts](/home/reptilian/code/campus-agent/apps/public-chat-web/vite.config.ts) [queries.ts](/home/reptilian/code/campus-agent/apps/public-chat-web/src/platform/vendor-compat/lib/db/queries.ts) [actions.ts](/home/reptilian/code/campus-agent/apps/public-chat-web/vendor/vercel-ai-chatbot/artifacts/actions.ts) |
| shiki compat seam | donor `code-block.tsx` 已恢复 `shiki` import，当前只在该 importer 上经由 exact compat resolver 映射到 Worker-compatible Shiki runtime | [vite.config.ts](/home/reptilian/code/campus-agent/apps/public-chat-web/vite.config.ts) [shiki.ts](/home/reptilian/code/campus-agent/apps/public-chat-web/src/platform/vendor-compat/shiki.ts) [code-block.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/vendor/vercel-ai-chatbot/components/ai-elements/code-block.tsx) |
| vendor lib compat seam | donor `vendor/vercel-ai-chatbot/lib/*` 当前已恢复 donor source；`@/lib/ai/models`、`@/lib/constants`、`@/lib/db/schema`、`@/lib/editor/diff`、`@/lib/types`、`@/lib/utils` 通过 exact compat seam 映射到 repo-owned runtime truth | [vite.config.ts](/home/reptilian/code/campus-agent/apps/public-chat-web/vite.config.ts) [models.ts](/home/reptilian/code/campus-agent/apps/public-chat-web/src/platform/vendor-compat/lib/ai/models.ts) [constants.ts](/home/reptilian/code/campus-agent/apps/public-chat-web/src/platform/vendor-compat/lib/constants.ts) [schema.ts](/home/reptilian/code/campus-agent/apps/public-chat-web/src/platform/vendor-compat/lib/db/schema.ts) [diff.ts](/home/reptilian/code/campus-agent/apps/public-chat-web/src/platform/vendor-compat/lib/editor/diff.ts) [types.ts](/home/reptilian/code/campus-agent/apps/public-chat-web/src/platform/vendor-compat/lib/types.ts) [utils.ts](/home/reptilian/code/campus-agent/apps/public-chat-web/src/platform/vendor-compat/lib/utils.ts) |
| message edit seam | donor message edit 改由 same-site conversation API 承载，属于 allowlisted platform seam | [message-edits.ts](/home/reptilian/code/campus-agent/apps/public-chat-web/src/platform/chat/message-edits.ts) [message-editor.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/vendor/vercel-ai-chatbot/components/chat/message-editor.tsx) |
| historical debt inventory | donor-visible historical debt 当前已清零；剩余 vendor diff 只允许落在 accepted product diff 或 runtime compatibility diff | [public-chat-web-donor-diff-classification.md](/home/reptilian/code/campus-agent/docs/reference/public-chat-web-donor-diff-classification.md) [public-chat-donor-diff-classification.test.ts](/home/reptilian/code/campus-agent/apps/public-chat-web/test/public-chat-donor-diff-classification.test.ts) |

## Non-Blocking Or Out-Of-Scope

- `/login` 仍是 repo-owned surface，不进入 donor parity 本身。
- same-site `/api/*` seam 继续是 accepted boundary，不视为 donor drift。
- `app-api` 继续拥有 auth/session/conversation/request truth，不因 strict parity 回退。
- artifact/document open behavior 只在 launch path 仍暴露该 affordance 时进入本轮 gate；本轮 fresh staging smoke 未观测到该 affordance 打开。

## 相关文件

- [public-chat-web-donor-diff-whitelist.md](/home/reptilian/code/campus-agent/docs/reference/public-chat-web-donor-diff-whitelist.md)
- [public-chat-web-donor-parity-review-checklist.md](/home/reptilian/code/campus-agent/docs/reference/public-chat-web-donor-parity-review-checklist.md)
- [public-chat-web-route-state-parity-inventory.md](/home/reptilian/code/campus-agent/docs/reference/public-chat-web-route-state-parity-inventory.md)
- [public-chat-web-chatbot-donor-baseline.md](/home/reptilian/code/campus-agent/docs/reference/public-chat-web-chatbot-donor-baseline.md)
- [public-chat-web-donor-diff-classification.md](/home/reptilian/code/campus-agent/docs/reference/public-chat-web-donor-diff-classification.md)
