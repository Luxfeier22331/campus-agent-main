---
doc_type: reference
status: historical
created: 2026-04-09
updated: 2026-04-12
---

# Public Chat Web Strict Donor Parity Closeout Snapshot

## 文档边界

本文记录 `apps/public-chat-web` 在 `2026-04-09` Wave 6 收口时的 strict donor parity 关闭快照。

本文回答的是：

- 当时关闭了哪些 strict parity blocker
- 当时哪些源码 diff 被归类为已接受 seam
- 2026-04-09 staging closeout 与 2026-04-11 local follow-up 分别留下了哪些证据

本文不负责：

- 充当当前 repo-head 的 donor parity 状态板
- 替代持续维护的 checklist、whitelist 与 route inventory
- 改写 `public-chat-web -> app-api -> supervisor-api` accepted topology

当前应优先阅读：

- [public-chat-web-donor-parity-review-checklist.md](/home/reptilian/code/campus-agent/docs/reference/public-chat-web-donor-parity-review-checklist.md)
- [public-chat-web-donor-diff-whitelist.md](/home/reptilian/code/campus-agent/docs/reference/public-chat-web-donor-diff-whitelist.md)
- [public-chat-web-route-state-parity-inventory.md](/home/reptilian/code/campus-agent/docs/reference/public-chat-web-route-state-parity-inventory.md)

## Historical Verdict

- `2026-04-09` staging strict donor parity gate：`PASS`
- `2026-04-11` local post-closeout follow-up：`PASS`
- 当时已经不存在剩余 strict donor parity blocker

对应证据：

- repo-tracked closeout口径保留在 [public-chat-web-donor-parity-review-checklist.md](/home/reptilian/code/campus-agent/docs/reference/public-chat-web-donor-parity-review-checklist.md) 与 [public-chat-web-donor-diff-whitelist.md](/home/reptilian/code/campus-agent/docs/reference/public-chat-web-donor-diff-whitelist.md)。
- 原始 staging/local smoke pack 属于一次性产物，不再作为默认入口引用。

## Areas Closed In The Historical Closeout

| Area | 收口结论 | 主要证据 |
|---|---|---|
| parity evidence pack | desktop/mobile 浏览器证据、same-site network evidence 与本地 gate 在 `2026-04-09` 已同时闭合 | [public-chat-web-donor-parity-review-checklist.md](/home/reptilian/code/campus-agent/docs/reference/public-chat-web-donor-parity-review-checklist.md) [public-chat-web-donor-diff-whitelist.md](/home/reptilian/code/campus-agent/docs/reference/public-chat-web-donor-diff-whitelist.md) |
| share / visibility launch-path drift | `chat-header` 与 history item 不再暴露 share/public affordance，`campus` mode 固定 `private-only` | [chat-header.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/vendor/vercel-ai-chatbot/components/chat/chat-header.tsx) [sidebar-history-item.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/vendor/vercel-ai-chatbot/components/chat/sidebar-history-item.tsx) [use-active-chat.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/src/platform/chat/use-active-chat.tsx) [public-chat-donor-diff-whitelist.test.ts](/home/reptilian/code/campus-agent/apps/public-chat-web/test/public-chat-donor-diff-whitelist.test.ts) |
| staging runtime seam | `GET /api/models` 语义已回到 donor 预期；早先 `/api/history 401` 被归因为过期非 cookie browser state，而不是路由缺陷 | [index.ts](/home/reptilian/code/campus-agent/apps/public-chat-web/src/index.ts) [worker.test.ts](/home/reptilian/code/campus-agent/apps/public-chat-web/test/worker.test.ts) [public-chat-web-donor-parity-review-checklist.md](/home/reptilian/code/campus-agent/docs/reference/public-chat-web-donor-parity-review-checklist.md) |

## Earlier Code-Level Corrections Preserved In The Snapshot

| Area | 收口后的代码结论 | 主要文件 |
|---|---|---|
| route entry states | `/chat` 主路径的 entry gating 已前移到 route ownership；`app-shell` 不再持有 redirect/fallback | [app-router.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/src/routes/app-router.tsx) [app-shell.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/src/platform/chat/app-shell.tsx) |
| composer navigation semantics | composer 与 suggested actions 会在发送前切到 `/chat/:conversationId`，不再等待服务端 canonical redirect | [multimodal-input.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/vendor/vercel-ai-chatbot/components/chat/multimodal-input.tsx) [suggested-actions.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/vendor/vercel-ai-chatbot/components/chat/suggested-actions.tsx) [use-active-chat.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/src/platform/chat/use-active-chat.tsx) |
| sidebar/history/user-nav actions | rail actions 已回到 donor-equivalent 路径；退出登录后的 `/login` 跳转 ownership 收回 `@platform/auth/client` | [app-sidebar.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/vendor/vercel-ai-chatbot/components/chat/app-sidebar.tsx) [sidebar-history.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/vendor/vercel-ai-chatbot/components/chat/sidebar-history.tsx) [sidebar-history-item.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/vendor/vercel-ai-chatbot/components/chat/sidebar-history-item.tsx) [sidebar-user-nav.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/vendor/vercel-ai-chatbot/components/chat/sidebar-user-nav.tsx) |
| message/tool rendering | tool output 已回到 donor-equivalent thread path，不再保留 repo-owned visible fallback card | [message.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/vendor/vercel-ai-chatbot/components/chat/message.tsx) [public-chat-message-parity.test.ts](/home/reptilian/code/campus-agent/apps/public-chat-web/test/public-chat-message-parity.test.ts) |
| artifact/document runtime | artifact pane、document preview、editor runtime 与 data-stream handler 已回到 donor-equivalent 路径 | [shell.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/vendor/vercel-ai-chatbot/components/chat/shell.tsx) [data-stream-handler.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/vendor/vercel-ai-chatbot/components/chat/data-stream-handler.tsx) [public-chat-artifact-runtime-parity.test.ts](/home/reptilian/code/campus-agent/apps/public-chat-web/test/public-chat-artifact-runtime-parity.test.ts) |

## Accepted Non-Blocking Diffs In The Closeout Snapshot

以下差异在本次 closeout 中被接受为 seam，不计入 blocker；路径级 inventory 固定看 [public-chat-web-donor-diff-classification.md](/home/reptilian/code/campus-agent/docs/reference/public-chat-web-donor-diff-classification.md)：

| Area | Closeout 口径 | 主要文件 |
|---|---|---|
| header seam | vendor header 保留 donor `next/link` import，经 exact router compat seam 映射到 repo runtime | [chat-header.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/vendor/vercel-ai-chatbot/components/chat/chat-header.tsx) [link.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/src/platform/vendor-compat/next/link.tsx) [public-chat-web-donor-diff-whitelist.md](/home/reptilian/code/campus-agent/docs/reference/public-chat-web-donor-diff-whitelist.md) |
| attachment preview/image seam | vendor attachment preview 保留 donor `next/image` import，经 exact image compat seam 映射到 Worker-compatible image runtime | [preview-attachment.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/vendor/vercel-ai-chatbot/components/chat/preview-attachment.tsx) [image.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/src/platform/vendor-compat/next/image.tsx) [app-image.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/src/platform/ui/app-image.tsx) |
| artifact query compat seam | donor `artifacts/actions.ts` 继续通过 exact compat resolver 映射到 same-site `/api/suggestions` seam | [vite.config.ts](/home/reptilian/code/campus-agent/apps/public-chat-web/vite.config.ts) [queries.ts](/home/reptilian/code/campus-agent/apps/public-chat-web/src/platform/vendor-compat/lib/db/queries.ts) [actions.ts](/home/reptilian/code/campus-agent/apps/public-chat-web/vendor/vercel-ai-chatbot/artifacts/actions.ts) |
| shiki compat seam | donor `code-block.tsx` 继续通过 exact compat resolver 映射到 Worker-compatible `shiki` runtime | [vite.config.ts](/home/reptilian/code/campus-agent/apps/public-chat-web/vite.config.ts) [shiki.ts](/home/reptilian/code/campus-agent/apps/public-chat-web/src/platform/vendor-compat/shiki.ts) [code-block.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/vendor/vercel-ai-chatbot/components/ai-elements/code-block.tsx) |
| vendor lib compat seam | donor `vendor/vercel-ai-chatbot/lib/*` 保留 donor source，`@/lib/*` 由 repo-owned exact seam 承担 runtime truth | [vite.config.ts](/home/reptilian/code/campus-agent/apps/public-chat-web/vite.config.ts) [models.ts](/home/reptilian/code/campus-agent/apps/public-chat-web/src/platform/vendor-compat/lib/ai/models.ts) [constants.ts](/home/reptilian/code/campus-agent/apps/public-chat-web/src/platform/vendor-compat/lib/constants.ts) [schema.ts](/home/reptilian/code/campus-agent/apps/public-chat-web/src/platform/vendor-compat/lib/db/schema.ts) [diff.ts](/home/reptilian/code/campus-agent/apps/public-chat-web/src/platform/vendor-compat/lib/editor/diff.ts) [types.ts](/home/reptilian/code/campus-agent/apps/public-chat-web/src/platform/vendor-compat/lib/types.ts) [utils.ts](/home/reptilian/code/campus-agent/apps/public-chat-web/src/platform/vendor-compat/lib/utils.ts) |
| message edit seam | donor message edit 改由 same-site conversation API 承载 | [message-edits.ts](/home/reptilian/code/campus-agent/apps/public-chat-web/src/platform/chat/message-edits.ts) [message-editor.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/vendor/vercel-ai-chatbot/components/chat/message-editor.tsx) |
| historical debt inventory | donor-visible historical debt 在该次 closeout 中已清零；剩余 diff 只允许落在 accepted product diff 或 runtime compatibility diff | [public-chat-web-donor-diff-classification.md](/home/reptilian/code/campus-agent/docs/reference/public-chat-web-donor-diff-classification.md) [public-chat-donor-diff-classification.test.ts](/home/reptilian/code/campus-agent/apps/public-chat-web/test/public-chat-donor-diff-classification.test.ts) |

## Out-Of-Scope For This Historical Gate

- `/login` 与 `/register` 当时虽已切回 donor auth shell，但不进入 strict donor parity release gate
- same-site `/api/*` seam 是 accepted boundary，不视为 donor drift
- `app-api` 继续拥有 auth/session/conversation/request truth，不因 strict parity 回退
- artifact/document open behavior 只在 launch path 仍暴露该 affordance 时才进入该次 gate

## 相关文件

- [public-chat-web-donor-diff-whitelist.md](/home/reptilian/code/campus-agent/docs/reference/public-chat-web-donor-diff-whitelist.md)
- [public-chat-web-donor-parity-review-checklist.md](/home/reptilian/code/campus-agent/docs/reference/public-chat-web-donor-parity-review-checklist.md)
- [public-chat-web-route-state-parity-inventory.md](/home/reptilian/code/campus-agent/docs/reference/public-chat-web-route-state-parity-inventory.md)
- [public-chat-web-chatbot-donor-baseline.md](/home/reptilian/code/campus-agent/docs/reference/public-chat-web-chatbot-donor-baseline.md)
- [public-chat-web-donor-diff-classification.md](/home/reptilian/code/campus-agent/docs/reference/public-chat-web-donor-diff-classification.md)
