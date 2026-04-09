---
doc_type: reference
status: active
created: 2026-04-08
updated: 2026-04-08
---

# Public Chat Web Route State Parity Inventory

## 文档边界

本文固定 `Phase 1` 需要的 route/state inventory。

本文回答的是：

- 当前 `public-chat-web` 有哪些用户可见 route 与状态
- 哪些 route/state 需要 donor parity gate
- 哪些 route/state 允许保留 repo-local 差异

本文不负责：

- 直接给出视觉实现方案
- 替代 donor drift inventory
- 重写 auth 或 chat transport contract

## Parity Gate 范围

`donor parity gate` 只针对 chat 主壳相关状态生效。

必须进入 parity gate 的范围：

- desktop `/chat`
- mobile `/chat`
- desktop `/chat/:conversationId`
- mobile `/chat/:conversationId`
- sidebar/history
- thread/messages
- composer
- empty/loading/error states inside the chat shell

不进入 donor parity gate，但必须保持边界正确的范围：

- `/login`
- Worker shell redirects
- same-site `/api/*`
- auth/session bootstrap truth

## Route Inventory

| Route / State | 当前 owner | 当前运行职责 | donor parity 级别 | 必须保留的本地边界 |
|---|---|---|---|---|
| `/` | `src/routes/app-router.tsx` | redirect 到 `/chat` | `none` | Worker/browser route bootstrap |
| `/login` | `src/routes/app-router.tsx` + `src/login/page.tsx` | repo-owned 登录页、sign-in/sign-up、成功后跳 `/chat` | `out-of-scope` | repo-owned auth/session UX |
| `/chat` | `src/routes/app-router.tsx` -> `src/platform/chat/app-shell.tsx` | 默认 chat 主壳、empty thread、首轮发送 | `critical` | same-site `/api/*`、platform seam |
| `/chat/:conversationId` | `src/routes/app-router.tsx` -> `src/platform/chat/app-shell.tsx` | 已有会话、thread detail、继续追问 | `critical` | same-site `/api/*`、platform seam |
| wildcard `*` | `src/routes/app-router.tsx` | redirect 到 `/chat` | `none` | route canonicalization |

## State Inventory

### `/login`

当前状态：

- `sign-in`
- `sign-up`
- `pending`
- `inline-error`
- `authenticated redirect to /chat`

当前 owner：

- [app-router.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/src/routes/app-router.tsx)
- [page.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/src/login/page.tsx)

Parity 规则：

- 不要求对齐 donor
- 只要求不破坏后续 donor-first chat 入口

### `/chat`

当前状态：

- authenticated empty thread
- create empty draft
- first-turn prompt submit without `conversationId`
- shell-level loading fallback
- unauthorized redirect to `/login`
- session loading
- session error
- access blocked

当前 owner：

- [app-router.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/src/routes/app-router.tsx)
- [app-shell.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/src/platform/chat/app-shell.tsx)
- [shell.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/vendor/vercel-ai-chatbot/components/chat/shell.tsx)
- [multimodal-input.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/vendor/vercel-ai-chatbot/components/chat/multimodal-input.tsx)

Parity 规则：

- 必须接近 donor desktop shell
- 必须接近 donor mobile shell
- empty state、composer、sidebar 都属于 `critical parity`

### `/chat/:conversationId`

当前状态：

- conversation loading
- loaded existing thread
- thread error
- follow-up submit
- request outcome mapping
  - `answer`
  - `clarification`
  - `no_answer`
  - `error`
- unauthorized redirect to `/login`

当前 owner：

- [app-router.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/src/routes/app-router.tsx)
- [app-shell.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/src/platform/chat/app-shell.tsx)
- [messages.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/vendor/vercel-ai-chatbot/components/chat/messages.tsx)
- [message.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/vendor/vercel-ai-chatbot/components/chat/message.tsx)
- platform chat files in [src/platform/chat/](/home/reptilian/code/campus-agent/apps/public-chat-web/src/platform/chat)

Parity 规则：

- header/thread/composer/history 全部属于 `critical parity`
- outcome rendering 允许保留 repo-local data semantics
- 但不允许因为 outcome 类型而明显偏离 donor message shell

### Cross-Route Status States

当前状态：

- `RouteStatusCard` loading
- `RouteStatusCard` chat unavailable
- `RouteStatusCard` access blocked
- `Navigate` redirects for unauthenticated and fallback routes

当前 owner：

- [app-router.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/src/routes/app-router.tsx)
- [route-status-card.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/src/routes/route-status-card.tsx)

Parity 规则：

- 这类状态不要求严格对齐 donor
- 但必须避免扩张成新的产品视觉主基线

## Desktop / Mobile Coverage Contract

Phase 1 固定以下设备宽度必须进入后续 parity 验收：

- desktop: `1440x900`
- mobile: `390x844`

后续 Phase 2-5 的视觉验收，至少必须覆盖：

- `/chat` empty state
- `/chat/:conversationId` existing thread
- sidebar/history present
- composer idle
- composer submitting
- assistant answer
- clarification / no_answer / error

## Route Ownership Notes

- `src/routes/` 与 `src/login/` 当前拥有：
  - login
  - session bootstrap
  - route status card
  - route gating
- `src/platform/` 当前拥有：
  - main chat shell runtime path
  - platform session/history/router integration
  - adapter-driven thread rendering
- `vendor/vercel-ai-chatbot/` 当前拥有：
  - sidebar/thread/composer/empty-state presentation

Phase 1 之后，默认判断应固定为：

- `src/routes/` 不是 chat 可见 UI owner，它只负责 route integration
- `src/platform/` 是当前 runtime seam owner
- `vendor/vercel-ai-chatbot/` 是当前唯一 chat UI 主壳

## 相关文件

- [public-chat-web-donor-first-reset.md](/home/reptilian/code/campus-agent/docs/plans/public-chat-web-donor-first-reset.md)
- [public-chat-web-donor-drift-inventory.md](/home/reptilian/code/campus-agent/docs/reference/public-chat-web-donor-drift-inventory.md)
- [app-router.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/src/routes/app-router.tsx)
- [app-shell.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/src/platform/chat/app-shell.tsx)
