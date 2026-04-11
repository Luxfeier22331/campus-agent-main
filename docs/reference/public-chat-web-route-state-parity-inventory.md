---
doc_type: reference
status: active
created: 2026-04-08
updated: 2026-04-11
---

# Public Chat Web Route State Parity Inventory

## 文档边界

本文固定当前 `apps/public-chat-web` chat shell 的 strict donor parity route/state inventory。

本文回答的是：

- 当前有哪些用户可见 route 与状态
- 哪些 route/state 属于 strict donor parity gate
- 哪些状态虽然 repo-owned，但只要出现在 `/chat` 主路径上就仍然算 parity blocker

本文不负责：

- 直接给出视觉实现方案
- 替代 strict donor gap inventory
- 改写 auth 或 chat transport contract

## Strict Parity 范围

`strict donor parity gate` 只针对 chat 主壳生效，但口径不再是“接近 donor”，而是“样式与组件行为都不得明显偏离 donor”。

必须进入 strict parity gate 的范围：

- desktop `/chat`
- mobile `/chat`
- desktop `/chat/:conversationId`
- mobile `/chat/:conversationId`
- route entry states that appear before the chat shell is ready
- sidebar / history / user-nav actions
- thread / messages / tool outputs
- composer submit / navigate / edit flows
- empty / loading / error states inside or directly in front of the chat shell

不进入 donor parity gate，但必须保持边界正确的范围：

- `/login`
- `/register`
- Worker shell redirects
- same-site `/api/*`
- auth/session bootstrap truth as a data boundary

## Route Inventory

| Route / State | 当前 owner | 当前运行职责 | donor parity 级别 | 必须保留的本地边界 |
|---|---|---|---|---|
| `/` | `src/routes/app-router.tsx` | redirect 到 `/chat` | `none` | Worker/browser route bootstrap |
| `/login` | `src/routes/app-router.tsx` + `src/login/page.tsx` + donor auth shell | donor sign-in shell、same-site Better Auth action adapter、成功后跳 `/chat` | `out-of-scope` | app-api auth/session truth、repo-owned route bootstrap |
| `/register` | `src/routes/app-router.tsx` + `src/login/register-page.tsx` + donor auth shell | donor register shell、same-site Better Auth action adapter、成功后跳 `/chat` | `out-of-scope` | app-api auth/session truth、repo-owned route bootstrap |
| `/chat` | `src/routes/app-router.tsx` -> `src/platform/chat/app-shell.tsx` | 默认 chat 主壳、empty thread、首轮发送 | `critical` | same-site `/api/*`、platform seam |
| `/chat/:conversationId` | `src/routes/app-router.tsx` -> `src/platform/chat/app-shell.tsx` | 已有会话、thread detail、继续追问 | `critical` | same-site `/api/*`、platform seam |
| wildcard `*` | `src/routes/app-router.tsx` | redirect 到 `/chat` | `none` | route canonicalization |

## State Inventory

### `/login`

当前状态：

- `sign-in`
- `pending`
- `toast error`
- `authenticated redirect to /chat`

当前 owner：

- [app-router.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/src/routes/app-router.tsx)
- [page.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/src/login/page.tsx)
- [layout.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/vendor/vercel-ai-chatbot/app/(auth)/layout.tsx)
- [auth-form.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/vendor/vercel-ai-chatbot/components/chat/auth-form.tsx)
- [actions.ts](/home/reptilian/code/campus-agent/apps/public-chat-web/src/login/actions.ts)

Parity 规则：

- 不进入 strict donor parity gate
- 但当前可见 auth shell 已切回 donor 结构；repo-owned 部分只允许停留在 action adapter、route bootstrap 与 compat seam

### `/register`

当前状态：

- `sign-up`
- `pending`
- `toast error`
- `authenticated redirect to /chat`

当前 owner：

- [app-router.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/src/routes/app-router.tsx)
- [register-page.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/src/login/register-page.tsx)
- [layout.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/vendor/vercel-ai-chatbot/app/(auth)/layout.tsx)
- [auth-form.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/vendor/vercel-ai-chatbot/components/chat/auth-form.tsx)
- [actions.ts](/home/reptilian/code/campus-agent/apps/public-chat-web/src/login/actions.ts)

Parity 规则：

- 不进入 strict donor parity gate
- 但当前可见 auth shell 已切回 donor 结构；repo-owned 部分只允许停留在 action adapter、route bootstrap 与 compat seam

### `/chat`

当前状态：

- authenticated empty thread
- create empty draft
- first-turn prompt submit with route-owned `conversationId`
- route bootstrap fallback during session loading
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

- route entry states 仍属于 strict parity gate，但当前 code-level route baseline 已不再使用 repo-owned status card
- empty state、composer、sidebar、submit navigation 都属于 `critical parity`
- composer 与 suggested actions 都必须在首轮发送前先切到 `/chat/:conversationId`
- 当前 `/chat` 主路径只允许保留 route-owned、不可见的 bootstrap logic；不得再把 fallback 放回 chat shell frame

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

- header / thread / composer / history / user-nav actions 全部属于 `critical parity`
- outcome rendering 可以保留 repo data boundary，但不能改变 donor-visible shell behavior
- tool outputs、error fallback、artifact/document runtime 只要影响消息区实际交互，就仍属于 strict parity gate

### Cross-Route Status States

当前状态：

- route lazy fallback: `flex h-dvh bg-sidebar`
- redirect to `/login` for unauthenticated state
- redirect to `/login` for session error / access blocked state
- redirect to `/login` for authenticated-but-no-chat state
- `Navigate` redirects for unauthenticated and fallback routes

当前 owner：

- [app-router.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/src/routes/app-router.tsx)

Parity 规则：

- `/login` 之外的 route entry states 不再默认豁免 strict parity
- repo-owned status card 与 app-shell redirect/fallback 已退出 runtime path；后续不得重新把它们带回 `/chat` 主路径
- 只有 Worker/browser bootstrap redirect 仍不进入 donor parity 本身

## Desktop / Mobile Coverage Contract

当前 strict parity 验收至少必须覆盖：

- desktop: `1440x900`
- mobile: `390x844`

并且必须覆盖以下状态：

- `/chat` route entry states
- `/chat` empty state
- `/chat/:conversationId` existing thread
- sidebar / history / user-nav actions
- composer idle
- composer submitting
- composer navigation after first send
- assistant answer
- clarification / no_answer / error
- artifact/document open behavior if launch path仍可见

## Route Ownership Notes

- `src/routes/` 与 `src/login/` 当前拥有：
  - auth route entry
  - Better Auth action adapter
  - session bootstrap
  - route gating
  - non-visible route bootstrap
- `src/platform/` 当前拥有：
  - main chat shell runtime path
  - platform session/history/router integration
  - runtime adapters
- `vendor/vercel-ai-chatbot/` 当前拥有：
  - sidebar / thread / composer / empty-state presentation
  - auth layout / auth form presentation
  - the visible donor shell contract that launch path must converge to

默认判断固定为：

- `src/routes/` 不是 chat 可见 UI owner；如果 route entry states 挡在 `/chat` 前面，它们也要按 parity blocker 处理
- `2026-04-09` 当前 code-level route entry correction 已完成：entry gating 已前移到 route ownership，`app-shell` 不再持有 redirect/fallback
- `src/platform/` 是 runtime seam owner，不是 donor-visible behavior 的长期 owner
- `vendor/vercel-ai-chatbot/` 是当前唯一 chat UI 主壳

## 相关文件

- [public-chat-web-strict-donor-parity-gap-inventory.md](/home/reptilian/code/campus-agent/docs/reference/public-chat-web-strict-donor-parity-gap-inventory.md)
- [public-chat-web-chatbot-donor-baseline.md](/home/reptilian/code/campus-agent/docs/reference/public-chat-web-chatbot-donor-baseline.md)
- [app-router.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/src/routes/app-router.tsx)
- [app-shell.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/src/platform/chat/app-shell.tsx)
