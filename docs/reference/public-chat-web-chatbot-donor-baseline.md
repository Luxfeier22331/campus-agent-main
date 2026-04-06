---
doc_type: reference
status: active
created: 2026-04-06
updated: 2026-04-06
---

# Public Chat Web Chatbot Donor Baseline

## 文档边界

本文只冻结 `apps/public-chat-web` 的 Chatbot donor baseline。

它回答的是：

- 这轮 replatform 的上游 donor 是谁
- 这轮 donor pin 到哪个 commit
- 哪些上游内容允许继承，哪些必须排除
- donor code 应以什么 patch policy 落入 repo

它不负责：

- 改写 `public-chat-web -> app-api -> supervisor-api` 拓扑
- 把 upstream backend、auth、storage 或部署方式带进本 repo
- 冻结未来所有 UI 细节

## Donor Record

- upstream repo URL: `https://github.com/vercel/chatbot`
- GitHub current canonical page: `https://github.com/vercel/ai-chatbot`
- pinned baseline commit: `146b3cb8cf2ffbb5b985819f06f6b8357bd464e7`
- baseline recorded at: `2026-04-06`
- license posture: `Apache-2.0`

说明：

- GitHub 当前把该项目展示为 `vercel/ai-chatbot`
- 但本 repo 的 donor 讨论、历史上下文和引用入口继续统一记为 `vercel/chatbot`
- 这次 pin 的目的不是“永远跟随 upstream 最新 UI”，而是给当前 replatform 提供一个明确的 donor snapshot

## Donor Role

本次 donor 只承担两类角色：

- `interaction/layout/style-system donor`
- `frontend component and shell donor`

它不是：

- 产品架构 donor
- auth/session truth donor
- conversation/request truth donor
- backend/runtime/deployment donor

## Allowed Inheritance

这轮允许系统性继承的内容：

- chat-first shell 布局
- sidebar / history / composer / message list 的结构模式
- empty / loading / error / history states 的视觉组织
- donor 使用的前端原语方向，例如 `Tailwind + shadcn-style primitives + Radix Slot`
- 纯前端组件的命名、拆分和样式组织思路

允许参考但必须本地化改写的内容：

- UI component API
- chat thread layout
- sidebar item structure
- composer affordance
- shell-level utility functions

## Forbidden Inheritance

以下内容不得作为 donor 直接继承：

- Next.js App Router
- React Server Components
- Server Actions
- upstream `app/api/*` backend routes
- Auth.js / upstream auth ownership
- upstream DB / Blob / provider persistence layer
- Vercel AI Gateway / model provider assumptions
- attachments / artifacts pane / tool approval UI / model selector
- 任何要求 browser 直连 backend provider 的默认实现

## Repo Landing Rule

donor code 落地时必须遵守以下规则：

- 进入 `apps/public-chat-web` 后即视为 repo-owned code，不保留 vendor mirror 目录
- 不做整目录生搬硬套；只按 shell / component / primitive 粒度吸收
- 所有 data access 必须经过 repo-owned adapter seam
- 所有 auth/session/conversation/request assumptions 必须重新对齐 `app-api` contract
- 所有 routes 必须服从现有 Worker shell 和 same-site `/api/*` seam

## Target Landing Zones

当前固定的 repo 落点：

- shell/components/primitives: `apps/public-chat-web/src/chatbot-shell/`
- adapters: `apps/public-chat-web/src/chatbot-shell/adapters/`
- donor-style utilities: `apps/public-chat-web/src/chatbot-shell/lib/`

当前 legacy UI 仍保留在：

- `apps/public-chat-web/src/public-chat/`
- `apps/public-chat-web/src/styles.css`

其中只有登录面、session bootstrap、route status card 与 boot fallback 仍由 legacy surface 承担；
默认 `/chat` 与 `/chat/:conversationId` 已切到 donor-derived shell。
Wave 5 staging smoke 收口后，之前的 `/chat/replatform-preview*` 临时 debug seam 已被移除，不再保留额外产品外路由。

## Patch Policy

本 repo 对 donor 采用 `adapt, do not mirror` policy：

1. 先冻结 donor snapshot。
2. 只复制本轮明确需要的 shell / component / primitive 思路。
3. 进入 repo 后立刻改写为：
   - Worker web surface 语义
   - same-site `/api/*` seam
   - `app-api`-owned auth/session/conversation/request truth
4. 不保留 upstream backend contracts 的兼容层。
5. 不为了复用 donor 而反向重塑 `app-api`。

## External References

- upstream repo: <https://github.com/vercel/chatbot>
- canonical GitHub page: <https://github.com/vercel/ai-chatbot>
- pinned commit: <https://github.com/vercel/chatbot/commit/146b3cb8cf2ffbb5b985819f06f6b8357bd464e7>
- license: <https://github.com/vercel/chatbot/blob/main/LICENSE>
