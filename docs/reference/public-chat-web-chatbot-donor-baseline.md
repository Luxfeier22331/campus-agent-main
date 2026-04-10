---
doc_type: reference
status: active
created: 2026-04-06
updated: 2026-04-09
---

# Public Chat Web Chatbot Donor Baseline

## 文档边界

本文冻结当前 `apps/public-chat-web` 的 strict donor comparison baseline。

它回答的是：

- 当前 chat shell 对照的 donor 是谁
- 当前本地严格对照使用哪个 commit
- 哪些内容允许继承，哪些只能通过 repo seam 接入
- strict parity 下 donor code 应如何落地

它不负责：

- 改写 `public-chat-web -> app-api -> supervisor-api` accepted topology
- 把 upstream backend、auth、storage 或部署方式带进本 repo
- 直接替代 current gap inventory 或实施计划

## Donor Record

- upstream repo URL: `https://github.com/vercel/chatbot`
- GitHub current canonical page: `https://github.com/vercel/ai-chatbot`
- current local strict-comparison baseline: `.tmp/vercel-ai-chatbot`
- current local baseline commit: `691c3cb05fddf292e1f52788d383937740c57cb9`
- baseline recorded at: `2026-04-09`
- license posture: `Apache-2.0`

说明：

- GitHub 当前把该项目展示为 `vercel/ai-chatbot`
- 但本 repo 的 donor 讨论、历史上下文和引用入口继续统一记为 `vercel/chatbot`
- 当前 strict parity 讨论默认以本地 `.tmp/vercel-ai-chatbot` 的实际检出为准，而不是较早一轮 donor pin 记录

## Donor Role

本次 donor 承担两类角色：

- `interaction/layout/style-system donor`
- `frontend component and shell behavior donor`

它不是：

- 产品架构 donor
- auth/session truth donor
- conversation/request truth donor
- backend/runtime/deployment donor

## Allowed Inheritance

这轮必须系统性继承的内容：

- chat-first shell 布局
- sidebar / history / composer / message list 的 DOM 结构、样式层次和交互节奏
- empty / loading / error / history states 的可见组织方式
- donor 使用的前端原语方向，例如 `Tailwind + shadcn-style primitives + Radix Slot`
- chat shell 的可见组件行为

允许通过 repo-owned seam 接入，但不得改变 donor-visible behavior 的内容：

- same-site `/api/*` transport seam
- `app-api`-owned auth/session/conversation/request truth
- Worker route integration
- `/login` repo-owned surface

## Forbidden Inheritance

以下内容不得作为 donor 直接继承：

- Next.js App Router
- React Server Components
- Server Actions
- upstream `app/api/*` backend routes
- Auth.js / upstream auth ownership
- upstream DB / Blob / provider persistence layer
- Vercel AI Gateway / model provider assumptions
- 任何要求 browser 直连 backend provider 的默认实现

补充说明：

- `artifact`、`document preview`、`attachment upload`、`message edit`、`model selector`、`tool approval UI` 这些模块的 upstream backend ownership 仍然不能直接继承
- 但这不等于 visible UI 必须从 launch path 永久切掉；如果它们仍在 launch path 出现，就不能因为 repo patch 而偏离 donor shell 行为

## Repo Landing Rule

donor code 落地时必须遵守以下规则：

- donor vendor tree 保留在 `apps/public-chat-web/vendor/vercel-ai-chatbot/`
- 当前 forward target 是 `vendor-owned chat runtime + repo-owned platform seams`
- repo-owned seams 只能接入数据、路由和 Worker 语义，不能反向改写 donor-visible shell behavior
- 所有 auth/session/conversation/request assumptions 必须重新对齐 `app-api` contract
- 所有 routes 必须服从现有 Worker shell 和 same-site `/api/*` seam

## Target Landing Zones

当前 worktree 的 donor 落地区域如下：

- donor vendor tree: `apps/public-chat-web/vendor/vercel-ai-chatbot/`
- repo-owned platform seam: `apps/public-chat-web/src/platform/`
- repo-owned route tree and login surface: `apps/public-chat-web/src/routes/`, `apps/public-chat-web/src/login/`

当前 repo-owned browser shell 仅允许保留在：

- `apps/public-chat-web/src/platform/`
- `apps/public-chat-web/src/routes/`
- `apps/public-chat-web/src/login/`
- `apps/public-chat-web/src/styles.css`

其中 repo-owned surface 只应承担：

- 平台接缝
- 路由接线
- 登录页
- Worker/browser boot

补充说明：

- `2026-04-09` 当前 worktree 已把 `RouteStatusCard` 从 runtime path 中移除；route entry fallback 现只保留在 route layer 的不可见 bootstrap，`app-shell` 不再持有 redirect/fallback
- `src/chatbot-donor/`、`src/chatbot-shell/` 与 `src/public-chat/` 已从 app source tree 退役，不再保留兼容 overlay 或过渡壳

## Patch Policy

本 repo 当前对 donor 采用：

`vendor, then adapt edges`

但这里的 `adapt edges` 只允许发生在不改变 donor-visible behavior 的边界上。

固定规则：

1. 先冻结 donor snapshot，并以 `.tmp/vercel-ai-chatbot` 作为严格对照基线。
2. 保留 vendor tree，避免再次把 donor 退化成“设计参考”。
3. repo-owned seam 只负责：
   - Worker web surface 语义
   - same-site `/api/*` seam
   - `app-api`-owned auth/session/conversation/request truth
4. 不把 upstream backend/runtime truth 带进 repo。
5. 不为了 donor 复用而反向重塑 `app-api`。
6. 不允许因为“先跑通”“先 smoke 通过”就在 donor-visible path 上接受 patchwork。

## External References

- upstream repo: <https://github.com/vercel/chatbot>
- canonical GitHub page: <https://github.com/vercel/ai-chatbot>
- current local baseline commit: <https://github.com/vercel/chatbot/commit/691c3cb05fddf292e1f52788d383937740c57cb9>
- license: <https://github.com/vercel/chatbot/blob/main/LICENSE>
