---
doc_type: reference
status: completed
created: 2026-04-08
updated: 2026-04-09
---

# Public Chat Web Historical Donor Drift Inventory

## 文档边界

本文保留 `Phase 1/2` 时期识别出的 donor drift inventory，作为已退役 `src/chatbot-shell/` 的历史记录。

本文回答的是：

- `src/chatbot-shell/` 历史过渡壳曾经哪些地方明显偏离 donor-first shell
- 这些偏移分别落在哪些文件
- 当时预计应该在哪个阶段修正

本文不负责：

- 直接写出 Phase 2 的最终 UI 代码
- 替代 route/state inventory
- 判断 adapter contract 是否正确

当前说明：

- 2026-04-09 当前 runtime 已切到 `vendor/vercel-ai-chatbot/` + `src/platform/` + `src/routes/`
- 本文保留的 drift 主要用于解释为什么 `src/chatbot-shell/` 被降级为 deprecated reference
- 不应再把本文里的 `src/chatbot-shell/` 问题当作当前上线主路径的 owner truth
- 当前 `public-chat-web` 的 active blocker inventory 已转到 `public-chat-web-strict-donor-parity-gap-inventory.md`

## 判定原则

这里的 `drift` 指的是：

- 明显让页面第一眼看起来像 repo 自写 UI，而不是 donor shell
- 让工程语义、架构语义、解释式 copy 泄漏到终端用户主界面
- 让 adapter 或本地边界反向决定视觉结构

## Drift Inventory

| Area | 当前证据 | 当前文件 | 问题判断 | 修正阶段 |
|---|---|---|---|---|
| app shell overall layout | 当前主壳是 `20rem / main / 18rem` 三栏结构，且右侧额外信息栏常驻 | [shell-page.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/src/chatbot-shell/shell-page.tsx) | 偏离 donor 的 chat-first shell，信息密度过重 | `Phase 2` |
| right explainer rail | `Current coverage` / `How this chat behaves` 占据整块产品界面 | [shell-page.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/src/chatbot-shell/shell-page.tsx) | 工程解释内容进入主界面，应移除或降到非主路径 | `Phase 2` |
| engineering copy in header | `Same-site Worker shell`、`Replies stay attached...` 这类 copy 出现在主聊天区 header | [shell-page.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/src/chatbot-shell/shell-page.tsx) | 架构语义泄漏进产品 UI | `Phase 2` |
| sidebar brand block | `Public chat`、`Campus Agent`、解释型副标题组成自定义 sidebar hero | [chatbot-sidebar.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/src/chatbot-shell/components/chatbot-sidebar.tsx) | 更像 repo 自写 app rail，不像 donor sidebar | `Phase 2` |
| signed-in session panel | sidebar 底部整块 `Signed-in session` 卡片过重 | [chatbot-sidebar.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/src/chatbot-shell/components/chatbot-sidebar.tsx) | 会话信息展示方式偏离 donor，视觉噪音过大 | `Phase 2` |
| empty state copy | `Questions sent here go through the shared app-api command path` 之类文案直讲后端 seam | [chatbot-empty-state.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/src/chatbot-shell/components/chatbot-empty-state.tsx) | 解释式 copy 泄漏 | `Phase 2` |
| composer support text | `Keep requests specific for better grounding...` 这类全局说明常驻 | [chatbot-composer.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/src/chatbot-shell/components/chatbot-composer.tsx) | 交互区信息密度偏高，偏离 donor 的简洁 composer | `Phase 2` |
| composer CTA language | `Start with real request`、`Send reply` 明显是本地命名体系 | [chatbot-composer.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/src/chatbot-shell/components/chatbot-composer.tsx) | 组件文案不够 donor-first | `Phase 2` |
| thread card chrome | `Student prompt` / `Campus Agent` / `Answer` / `Clarification needed` 等 badge 样式与 copy 都高度本地化 | [chatbot-thread.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/src/chatbot-shell/components/chatbot-thread.tsx) | outcome 语义正确，但消息卡视觉偏离 donor | `Phase 2` and `Phase 3` |
| custom color and typography system | 当前 palette、fonts、tone 全部是 repo 自定 | [styles.css](/home/reptilian/code/campus-agent/apps/public-chat-web/src/chatbot-shell/styles.css) | donor 没有成为真正的样式基底 | `Phase 2` |
| route fallback copy | `Loading chat` / `Preparing chat` / `Chat unavailable` 等 route status copy 仍是 repo-owned 文案 | [app-router.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/src/routes/app-router.tsx) | 允许保留状态卡，但需要收敛文案 | `Phase 3` |
| login visual separation | `/login` 仍然是 repo-owned 自定义页面 | [page.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/src/login/page.tsx) | 允许保留，不视为 donor drift blocker | `out-of-scope` |

## 当时的 P0 Drift Items

以下是必须先修的 `P0`：

- 右侧 explainer rail
- header 中的工程说明 copy
- sidebar hero 和 session card 的自定义产品 chrome
- 自定义 color/typography system
- empty state 与 composer 中的工程说明文字

如果这些不先修，后续即使 adapter 继续优化，页面第一眼仍然会像 repo 自写 UI。

## 当时的 P1 Drift Items

以下是第二层需要修的 `P1`：

- thread card 的 badge / label / icon 语义表达方式
- route fallback copy 的工程化表述
- composer CTA 与 placeholder 的 donor-first 收敛

## Explicit Non-Drift Items

以下项目当前不被视为 donor drift 本身：

- `same-site /api/*` seam
- `app-api` 作为 auth/session/conversation/request truth owner
- first-turn request 不带 `conversationId`
- `/login` 是 repo-owned 登录页
- adapter 对 `answer / clarification / no_answer / error` 的 typed mapping

这些属于架构与数据接缝，不是视觉问题。

## Historical Closeout Rule

Phase 1 完成的判断标准不是“drift 已修完”，而是：

- drift 已被明确、可枚举、不可再争论
- 后续开发可以逐项对照修正
- 当前过渡壳不再被误判为长期基线

## 相关文件

- [public-chat-web-donor-first-reset.md](/home/reptilian/code/campus-agent/docs/plans/public-chat-web-donor-first-reset.md)
- [public-chat-web-strict-donor-parity-gap-inventory.md](/home/reptilian/code/campus-agent/docs/reference/public-chat-web-strict-donor-parity-gap-inventory.md)
- [public-chat-web-route-state-parity-inventory.md](/home/reptilian/code/campus-agent/docs/reference/public-chat-web-route-state-parity-inventory.md)
- [README.md](/home/reptilian/code/campus-agent/apps/public-chat-web/README.md)
