---
doc_type: plan
status: active
created: 2026-04-09
updated: 2026-04-09
---

# Public Chat Web Vendor Runtime Full Transplant

## 文档边界

本文固定 `apps/public-chat-web` 下一轮前向实施的详细方案。

本文回答的是：

- `public-chat-web` 的 chat frontend 最终应如何落地
- 哪些目录和文件继续保留，哪些必须退役
- 为什么当前 `vendor + overlay` 不是终态
- 下一轮具体按什么阶段、按什么文件边界执行
- `unsupported feature` 在当前轮应如何处理

本文不负责：

- 改写 `public-chat-web -> app-api -> supervisor-api` 主链路
- 把 upstream backend、Next.js server runtime、NextAuth、Vercel deployment truth 带进 repo
- 直接宣称当前 worktree 已满足本文目标

## 直接结论

当前 `public-chat-web` 的 forward target 固定为：

`vendor-owned chat runtime + repo-owned platform seams`

不是：

- `vendor shell + repo-owned visible overlays`
- `继续在 src/chatbot-donor 里维护 donor-like clone`
- `继续把 unsupported feature 交给本地 stub/fail-close UI 接管`

一句话：

`chat 可见 UI 全部回到 vendor tree；repo 只保留平台接缝、登录页、Worker 壳和路由接线。`

## 2026-04-09 当前进展

当前 worktree 已完成以下收口：

- `@/*` 已固定指向 `vendor/vercel-ai-chatbot/*`
- `src/routes/app-router.tsx` 已切为 TanStack Router 入口，`src/main.tsx` 不再挂 `src/public-chat/app.tsx`
- `/login` 已迁到 `src/login/page.tsx`
- chat runtime 已迁到 `src/platform/chat/app-shell.tsx` + `src/platform/chat/runtime.tsx`
- active runtime import graph 已移除 `react-router-dom`、`next/link`、`next/navigation`、`next-auth/react`
- `src/chatbot-donor/` 已退役并从当前 runtime 路径删除
- `src/chatbot-shell/` 与重复的 `src/public-chat/auth.ts` 已从 app source tree 退役
- 剩余 `src/public-chat/api.ts` 与 `src/public-chat/types.ts` 已并入 `src/platform/chat/*`，`src/public-chat/` 目录已退役

当前剩余 follow-up：

- 更新剩余 reference 文档与 parity inventory，避免继续指向已退役文件
- 补 staging donor parity smoke，验证实际页面与 vendor 期望一致

## 起始问题诊断

本文最初记录的起始问题如下；其中大部分已在本轮 worktree 内完成收口：

- `@/*` 主要仍指向 `src/chatbot-donor/*`，而不是 `vendor/vercel-ai-chatbot/*`
- 运行路径里仍有 repo-owned chat 可见组件：
  - [chat-header.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/src/chatbot-donor/components/chat/chat-header.tsx)
  - [greeting.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/src/chatbot-donor/components/chat/greeting.tsx)
  - [multimodal-input.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/src/chatbot-donor/components/chat/multimodal-input.tsx)
  - [messages.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/src/chatbot-donor/components/chat/messages.tsx)
  - [message.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/src/chatbot-donor/components/chat/message.tsx)
  - [suggested-actions.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/src/chatbot-donor/components/chat/suggested-actions.tsx)
  - [constants.ts](/home/reptilian/code/campus-agent/apps/public-chat-web/src/chatbot-donor/lib/constants.ts)
- 运行时仍依赖 `next/*`、`next-auth/*` 和 `react-router-dom` shim / bridge
- `src/chatbot-shell/` 与 `src/chatbot-donor/` 仍同时承载运行时语义，目录边界没有收口

因此当前状态只能算：

`overlay cutover in progress`

不能算：

`complete frontend transplant`

## 目标结构

重构完成后，`apps/public-chat-web` 应收敛为以下结构：

```text
apps/public-chat-web/
  vendor/vercel-ai-chatbot/        # 唯一 chat UI 源码
  src/platform/                    # app-api / session / history / router integration
  src/routes/                      # TanStack Router route tree
  src/login/                       # repo-owned /login
  src/index.ts                     # Worker shell + same-site /api/*
  src/styles.css                   # 只服务 login / route-status / boot
```

## Ownership Matrix

| 范围 | 最终 owner | 允许存在的目录 | 禁止继续承担的目录 |
|---|---|---|---|
| chat 可见 UI | `vendor/vercel-ai-chatbot/` | `vendor/vercel-ai-chatbot/components/chat/*` | `src/chatbot-donor/components/chat/*` |
| chat runtime hook / lib | `vendor/vercel-ai-chatbot/` + `src/platform/*` | `vendor/vercel-ai-chatbot/hooks/*`, `vendor/vercel-ai-chatbot/lib/*`, `src/platform/*` | `src/chatbot-donor/hooks/*`, `src/chatbot-donor/lib/*` |
| platform seam | repo-owned | `src/platform/*` | `src/chatbot-shell/*` |
| login | repo-owned | `src/login/*` | vendor auth UI |
| route integration | repo-owned | `src/routes/*`, `src/platform/router/*` | `src/public-chat/app.tsx`、`src/chatbot-donor/*`、`react-router-dom` route shell |
| Worker shell | repo-owned | `src/index.ts` | vendor runtime / Next server files |

## Unsupported Feature Policy

这里固定一个新的产品策略：

- `unsupported feature` 当前不做永久切除
- 这些能力未来可能重新上线，因此不要求本轮删除其源码资产
- 当前轮不以“把这些 feature 重新接通”为目标
- 当前轮也不允许为了这些 feature 继续保留 repo-owned clone UI

本轮的处理原则只有三条：

1. 这些能力不进入当前上线验收范围。
2. 这些能力的源码优先保留在 vendor tree，不在 repo 侧长出第二套实现。
3. 如果其中某个能力阻塞主壳迁移，只允许把它从当前 launch route / launch affordance 中脱线，不允许把它改造成 repo-owned fallback UI。

这意味着：

- `artifact`
- `document preview`
- `attachment upload`
- `message edit`
- `model selector`
- `tool approval UI`
- 其他 donor 中的非首发能力

都应被视为：

`parked capability`

而不是：

- `必须现在删光`
- `必须现在重新做完`
- `允许继续靠本地兼容层长期顶着`

未来若要重新上线，必须另开独立 phase，按产品契约逐项恢复。

## 执行阶段

### Phase 1：文档与 import ownership 重置

目标：

- 从结构上阻止 repo-owned chat UI 继续伪装成 donor runtime

涉及文件：

- [vite.config.ts](/home/reptilian/code/campus-agent/apps/public-chat-web/vite.config.ts)
- [tsconfig.json](/home/reptilian/code/campus-agent/apps/public-chat-web/tsconfig.json)
- [package.json](/home/reptilian/code/campus-agent/apps/public-chat-web/package.json)
- [chatbot-vendor-runtime-parity.test.ts](/home/reptilian/code/campus-agent/apps/public-chat-web/test/chatbot-vendor-runtime-parity.test.ts)
- 本文档及相关计划 / README 文档

实施内容：

- 把 `@/*` 从 `src/chatbot-donor/*` 改为 `vendor/vercel-ai-chatbot/*`
- 新增明确的 repo-owned namespace：
  - `@platform/*`
  - `@login/*`
  - 如有需要，`@routes/*`
- 新增 import-graph gate，禁止 chat runtime 从 `src/chatbot-donor/*` 和 `src/chatbot-shell/*` 引可见 UI
- 明确记录 vendor patch ledger 和当前 phase 目标

验收：

- `@/components/chat/*`、`@/hooks/*`、`@/lib/*` 默认都解析到 vendor tree
- 新增测试能阻止 repo-owned chat UI 回流主路径

### Phase 2：platform seam 抽离

目标：

- 把 repo-owned runtime 语义集中到 `src/platform/*`

涉及文件：

- [chat-transport.ts](/home/reptilian/code/campus-agent/apps/public-chat-web/src/chatbot-shell/adapters/chat-transport.ts)
- [conversations.ts](/home/reptilian/code/campus-agent/apps/public-chat-web/src/chatbot-shell/adapters/conversations.ts)
- [session.ts](/home/reptilian/code/campus-agent/apps/public-chat-web/src/chatbot-shell/adapters/session.ts)
- [runtime.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/src/chatbot-shell/runtime.tsx)
- [api.ts](/home/reptilian/code/campus-agent/apps/public-chat-web/src/public-chat/api.ts)
- [auth.ts](/home/reptilian/code/campus-agent/apps/public-chat-web/src/public-chat/auth.ts)

实施内容：

- 新建：
  - `src/platform/chat/*`
  - `src/platform/session/*`
  - `src/platform/auth/*`
  - `src/platform/router/*`
- 把 session bootstrap、history、conversation detail、send message、sign out 收敛到 platform 层
- 停止让 `src/public-chat/` 和 `src/chatbot-shell/` 继续同时拥有这些职责

验收：

- `src/chatbot-shell/adapters/*` 不再是 forward runtime 入口
- `src/public-chat/*` 只剩登录页和极少量 route status ownership

### Phase 3：路由彻底改成 TanStack Router

目标：

- 不再长期依赖 `react-router-dom`
- 不再长期依赖 `next/link` / `next/navigation` shim

涉及文件：

- [app.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/src/public-chat/app.tsx)
- [next-link.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/src/chatbot-donor/shims/next-link.tsx)
- [next-navigation.ts](/home/reptilian/code/campus-agent/apps/public-chat-web/src/chatbot-donor/shims/next-navigation.ts)
- [use-active-chat.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/src/chatbot-donor/hooks/use-active-chat.tsx)
- vendor 内所有直接依赖 `next/link` / `next/navigation` 的 chat runtime 文件

实施内容：

- 引入 TanStack Router route tree
- 用 repo-owned router integration 取代 BrowserRouter
- `/login` 继续 repo-owned
- `/chat` 与 `/chat/$conversationId` 直接挂 vendor runtime
- vendor 侧不再通过 `next/*` shim 获取导航能力，而是直接消费 `@platform/router`

验收：

- 运行时 import graph 中不再出现 `react-router-dom`
- 运行时 import graph 中不再出现 `next/link` / `next/navigation` shim

### Phase 4：vendor runtime 收敛

目标：

- 把 chat 可见 UI 全部收回到 vendor tree

涉及的当前 repo-owned 文件：

- [chat-header.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/src/chatbot-donor/components/chat/chat-header.tsx)
- [greeting.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/src/chatbot-donor/components/chat/greeting.tsx)
- [multimodal-input.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/src/chatbot-donor/components/chat/multimodal-input.tsx)
- [messages.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/src/chatbot-donor/components/chat/messages.tsx)
- [message.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/src/chatbot-donor/components/chat/message.tsx)
- [suggested-actions.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/src/chatbot-donor/components/chat/suggested-actions.tsx)
- [constants.ts](/home/reptilian/code/campus-agent/apps/public-chat-web/src/chatbot-donor/lib/constants.ts)

对应应回归的 vendor 文件：

- [chat-header.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/vendor/vercel-ai-chatbot/components/chat/chat-header.tsx)
- [greeting.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/vendor/vercel-ai-chatbot/components/chat/greeting.tsx)
- [multimodal-input.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/vendor/vercel-ai-chatbot/components/chat/multimodal-input.tsx)
- [messages.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/vendor/vercel-ai-chatbot/components/chat/messages.tsx)
- [message.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/vendor/vercel-ai-chatbot/components/chat/message.tsx)
- [suggested-actions.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/vendor/vercel-ai-chatbot/components/chat/suggested-actions.tsx)
- [constants.ts](/home/reptilian/code/campus-agent/apps/public-chat-web/vendor/vercel-ai-chatbot/lib/constants.ts)

实施内容：

- 停止运行时使用本地 clone 组件
- 校园域 greeting / placeholder / suggestions / branding 直接改在 vendor tree
- header、sidebar、history、message list、message card、composer 的 DOM 结构与样式回到 vendor

验收：

- staging 上不再出现本地 clone 痕迹
- `Campus chat`、`新对话`、当前自写 greeting、当前自写 placeholder、当前本地 suggestion 集不再从本地 overlay 提供

### Phase 5：parked capability 归位

目标：

- 明确 unsupported feature 的当前状态，但不做永久切除

涉及文件：

- [artifact.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/vendor/vercel-ai-chatbot/components/chat/artifact.tsx)
- [document-preview.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/vendor/vercel-ai-chatbot/components/chat/document-preview.tsx)
- [message-editor.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/vendor/vercel-ai-chatbot/components/chat/message-editor.tsx)
- [multimodal-input.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/vendor/vercel-ai-chatbot/components/chat/multimodal-input.tsx)
- [visibility-selector.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/vendor/vercel-ai-chatbot/components/chat/visibility-selector.tsx)
- 以及其依赖的 vendor hook / lib

实施内容：

- 为这些能力建立明确 inventory
- 标注哪些保留源码、哪些未进入首发验收
- 如某能力阻塞主壳迁移，只从 launch path 脱线，不删除源码
- 不再为这些能力维护 repo-owned stub UI

验收：

- 这些能力的状态在文档和代码入口上可枚举
- 当前首发 UI 的验收范围不再被它们污染
- 未来要恢复时有明确 patch ledger 和重新接线入口

### Phase 6：旧目录退役与 staging 收口

目标：

- 收掉错误目录边界，完成真实 parity smoke

涉及目录：

- `src/chatbot-donor/`
- `src/chatbot-shell/`
- `src/public-chat/` 的非登录部分

实施内容：

- 删除或彻底清空已退役的 chat UI 目录
- `src/public-chat/` 只保留 `/login` 与必要 route status
- 重跑 desktop / mobile parity smoke
- 用 [`.tmp/vercel-ai-chatbot`](/home/reptilian/code/campus-agent/.tmp/vercel-ai-chatbot) 作为 donor baseline 对照

验收：

- `/chat` 主路径上不再存在 repo-owned chat UI 目录
- 真实浏览器 smoke 在 desktop `1440x900` 和 mobile `390x844` 下都通过

## Definition Of Done

只有同时满足以下条件，本文目标才算完成：

- chat 可见 UI 的唯一源码来自 `vendor/vercel-ai-chatbot`
- repo 不再拥有任何 `chat` 可见 clone 组件
- repo-owned 运行时只剩：
  - Worker shell
  - same-site `/api/*`
  - `/login`
  - platform seam
  - route integration
- `src/chatbot-donor/` 与 `src/chatbot-shell/` 不再作为长期真相目录存在
- `unsupported feature` 没有被永久切除，但也没有继续强迫当前首发 UI 围着它们转
- local gate 通过：
  - `pnpm --dir apps/public-chat-web typecheck`
  - `pnpm --dir apps/public-chat-web test:worker`
  - `pnpm --dir apps/public-chat-web build`
- staging smoke 和 donor parity smoke 给出正向证据

## 相关文档

- [public-chat-web-donor-first-reset.md](/home/reptilian/code/campus-agent/docs/plans/public-chat-web-donor-first-reset.md)
- [public-chat-web-chatbot-donor-baseline.md](/home/reptilian/code/campus-agent/docs/reference/public-chat-web-chatbot-donor-baseline.md)
- [README.md](/home/reptilian/code/campus-agent/apps/public-chat-web/README.md)
