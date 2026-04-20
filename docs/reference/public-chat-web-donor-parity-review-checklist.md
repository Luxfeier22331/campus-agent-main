---
doc_type: reference
status: active
created: 2026-04-09
updated: 2026-04-20
---

# Public Chat Web Donor Parity Review Checklist

## 文档边界

本文提供 `apps/public-chat-web` 的 strict donor parity 复核清单。

本文回答的是：

- staging 或本地 smoke 时，哪些界面必须进入 strict parity review
- 当前 canonical route/state inventory 是什么
- 每个 gate 应该验证什么
- 哪些证据足以支持一次 donor parity 判定

本文不负责：

- 维护某一轮 closeout 的实时判定结果
- 替代单轮 staging smoke 目录中的原始截图与网络证据
- 改写 `public-chat-web -> app-api -> supervisor-api` 运行边界

## Gate 说明

- `PASS`：样式与组件行为都已经满足当前 gate
- `FAIL`：当前明确存在 strict parity blocker
- `OUT-OF-SCOPE`：必须 smoke，但不进入 donor parity 本身
- `AUTH-SURFACE`：正式 public auth surface；不计入 strict chat parity 结论，但必须单独记录 auth shell 验收

## Canonical Route / State Inventory

当前 strict donor parity gate 的 canonical route/state inventory 已并入本文。

| Route / State | 当前 owner | parity 级别 | 约束 |
|---|---|---|---|
| `/` | `src/routes/app-router.tsx` | `none` | 只承担 redirect 到 `/chat` 的 route bootstrap |
| `/login` | route layer + donor auth shell | `auth-surface` | 正式 public auth surface，不计入 strict chat parity，但必须单独 smoke |
| `/register` | route layer + donor auth shell | `auth-surface` | 与 `/login` 同一 auth family，不得另起 repo-owned 新壳 |
| `/chat` | route layer -> `src/platform/chat/app-shell.tsx` | `critical` | empty thread、首轮发送、entry bootstrap 都属于 parity gate |
| `/chat/:conversationId` | route layer -> `src/platform/chat/app-shell.tsx` | `critical` | existing thread、follow-up submit、request outcome mapping 都属于 parity gate |

跨 route 状态固定包括：

- route entry states that appear before the chat shell is ready
- sidebar / history / user-nav actions
- thread / messages / tool outputs
- composer submit / navigate / edit flows
- empty / loading / error states inside or directly in front of the chat shell

## Review Checklist

| Gate | 通过标准 | 建议证据来源 |
|---|---|---|
| desktop `/chat` first impression | 第一眼接近 `vercel/chatbot` 的 chat-first shell | desktop 浏览器截图，必要时附 donor baseline 对照 |
| mobile `/chat` first impression | mobile 保持 donor shell，而不是退化成 repo 自写长页面 | mobile 浏览器截图 |
| route entry states | `/chat` 进入过程不得由 repo-owned status card 或 app-shell fallback/redirect 定义主路径行为 | [app-router.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/src/routes/app-router.tsx) [app-shell.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/src/platform/chat/app-shell.tsx) |
| composer navigation semantics | 首轮发送前 route 切换、新建/删除会话后的落点、编辑消息回链都必须与 donor 等价 | [multimodal-input.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/vendor/vercel-ai-chatbot/components/chat/multimodal-input.tsx) [suggested-actions.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/vendor/vercel-ai-chatbot/components/chat/suggested-actions.tsx) [use-active-chat.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/src/platform/chat/use-active-chat.tsx) |
| sidebar / history / user-nav actions | 左 rail 的新建、切会话、删会话、退出登录必须与 donor 动作语义一致 | [app-sidebar.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/vendor/vercel-ai-chatbot/components/chat/app-sidebar.tsx) [sidebar-history.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/vendor/vercel-ai-chatbot/components/chat/sidebar-history.tsx) [sidebar-user-nav.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/vendor/vercel-ai-chatbot/components/chat/sidebar-user-nav.tsx) [public-chat-sidebar-parity.test.ts](/home/reptilian/code/campus-agent/apps/public-chat-web/test/public-chat-sidebar-parity.test.ts) |
| existing thread visual shell | 已有会话能在 donor 风格 thread 内显示 | 线程态截图 |
| message / tool rendering behavior | tool output、fallback、error state 不能明显偏离 donor thread 行为 | 结果态截图 [message.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/vendor/vercel-ai-chatbot/components/chat/message.tsx) [public-chat-message-parity.test.ts](/home/reptilian/code/campus-agent/apps/public-chat-web/test/public-chat-message-parity.test.ts) |
| artifact / document runtime | artifact panel、document preview、editor runtime 的打开与流式行为必须与 donor 等价；仅在 launch path 实际可见时纳入该轮 gate | [shell.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/vendor/vercel-ai-chatbot/components/chat/shell.tsx) [data-stream-handler.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/vendor/vercel-ai-chatbot/components/chat/data-stream-handler.tsx) [public-chat-artifact-runtime-parity.test.ts](/home/reptilian/code/campus-agent/apps/public-chat-web/test/public-chat-artifact-runtime-parity.test.ts) |
| sharing / visibility off-path | `private-only` 模式下，launch path 不得继续暴露 share / public affordance | [public-chat-web-donor-diff-classification.md](/home/reptilian/code/campus-agent/docs/reference/public-chat-web-donor-diff-classification.md) [public-chat-donor-diff-whitelist.test.ts](/home/reptilian/code/campus-agent/apps/public-chat-web/test/public-chat-donor-diff-whitelist.test.ts) |
| strict parity smoke / evidence pack | donor diff classification、desktop/mobile smoke、same-site network evidence 与本地 gate 必须同时闭合 | 浏览器 smoke 产物、[public-chat-web-donor-diff-classification.md](/home/reptilian/code/campus-agent/docs/reference/public-chat-web-donor-diff-classification.md) |
| same-site `/api/*` seam | `/api/me`、`/api/history`、`/api/models`、`/api/chat/conversations`、`/api/chat/requests` 都仍走 same-site 且未退化 | network summary、worker smoke |
| `/login` `/register` | `/login` 与 `/register` 可用，退出登录后可回到登录页；`/login` 保留 future recovery CTA slot；`/register` 不脱离 donor auth family | `AUTH-SURFACE`；单独记录 auth shell 验收，不混入 strict chat parity 结论 |

## Recommended Review Order

1. 先用 [public-chat-web-donor-diff-classification.md](/home/reptilian/code/campus-agent/docs/reference/public-chat-web-donor-diff-classification.md) 确认 donor baseline、允许继承边界与 accepted seam。
2. 再用本文确认该轮需要覆盖的 route/state 和 gate。
3. 用 [public-chat-web-donor-diff-classification.md](/home/reptilian/code/campus-agent/docs/reference/public-chat-web-donor-diff-classification.md) 判定当前 diff 是否仍落在 accepted classes 内。
4. 最后把浏览器截图、same-site network summary 与本地 gate 产物收成一轮 smoke evidence。

## 相关文件

- [public-chat-web-donor-diff-classification.md](/home/reptilian/code/campus-agent/docs/reference/public-chat-web-donor-diff-classification.md)
