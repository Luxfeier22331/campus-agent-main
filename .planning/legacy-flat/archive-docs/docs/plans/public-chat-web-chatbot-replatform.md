---
doc_type: plan
status: completed
created: 2026-04-06
updated: 2026-04-09
---

# Public Chat Web Chatbot Replatform (Historical Cutover Record)

> 历史说明：本文只保留第一轮 `public-chat-web` runtime cutover 的阶段记录，不能再作为当前 chat frontend 的实施依据。
> 当前 canonical 实施与验收入口已转到 [public-chat-web-vendor-runtime-full-transplant.md](/home/reptilian/code/campus-agent/.planning/archive-docs/docs/plans/public-chat-web-vendor-runtime-full-transplant.md)、[public-chat-web-strict-donor-parity-gap-inventory.md](/home/reptilian/code/campus-agent/docs/reference/public-chat-web-strict-donor-parity-gap-inventory.md)、[public-chat-web-route-state-parity-inventory.md](/home/reptilian/code/campus-agent/docs/reference/public-chat-web-route-state-parity-inventory.md) 与 [public-chat-web-donor-parity-review-checklist.md](/home/reptilian/code/campus-agent/docs/reference/public-chat-web-donor-parity-review-checklist.md)。

> 状态说明：本文记录的是“把 `/chat` 切到 donor runtime、把旧 hand-written chat UI 退出 runtime path”的第一轮切换计划。
> 这部分目标已经完成；但当前前向真相已经升级为 `full donor transplant correction`，因此本文中任何 `chatbot-derived shell`、`adapter first`、`阶段一不要求 donor 全量行为` 一类表述，都只代表当时阶段判断。

## 文档边界

本文只保留 `apps/public-chat-web` 第一轮 donor cutover 的历史背景与阶段计划。

本文回答的是：

- 为什么当前 `public-chat-web` 应被视为过渡实现
- 当时新的 chat web 准备如何以 donor runtime 为基底接入当前 repo
- 哪些架构边界必须保留，哪些实现层可以替换
- 这次第一轮 cutover 当时如何分波次推进、验收和切换

本文不负责：

- 改写当前 accepted merged-truth topology
- 重新定义 `app-api`、`supervisor-api` 或 operator surface 的长期边界
- 定义当前 strict donor parity 的完成条件

## 目标

当时这轮工作把 `apps/public-chat-web` 从“repo 内部重新手写的一套 Worker chat UI”重构为：

- 以 `vercel/chatbot` 为 donor 的 chat-first frontend shell
- 保留我们自己的 `/login` 与 session UX
- 保留 `public-chat-web -> app-api -> supervisor-api` 主链路
- 通过 repo-owned platform seam 对接当前 `app-api` contract

简言之：

`保留当前产品架构，完成第一轮 donor runtime cutover`

## 固定不变的架构边界

这次工作不得改写以下 canonical truth：

- 当前主链路继续是 `browser -> public-chat-web -> app-api -> supervisor-api`
- `apps/public-chat-web` 继续只是 public browser surface
- `apps/app-api` 继续拥有 auth、session、conversation、chat ingress 与 request truth
- browser 不得绕过 `public-chat-web` 直打 `apps/supervisor-api`
- browser 默认继续通过 same-site `/api/*` seam 进入 `app-api`

对应真相文档：

- `docs/architecture/current-architecture.md`
- `docs/architecture/product-runtime-architecture.md`
- `docs/contracts/app-api-http.md`
- `docs/contracts/app-api-request-lifecycle.md`
- `docs/decisions/adr-0012-shared-app-api-and-worker-web-surfaces.md`
- `docs/decisions/adr-0013-app-api-worker-runtime.md`

## 现状判断

以下判断是本文写作时、cutover 完成前的历史背景。

当时的 `apps/public-chat-web` 实现并不是“Chatbot-based frontend shell 的适配版”，而是一套新的 Worker/Vite/React Router 实现。

因此本计划固定以下判断：

- 当时的 [apps/public-chat-web/src/public-chat/app.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/src/public-chat/app.tsx) 及其配套样式属于 `legacy implementation`
- 在当时的新 shell cutover 完成前，它仍是运行实现
- 当前真实前向状态已经进一步演进为：`vendor/vercel-ai-chatbot/` 是唯一 chat UI 主壳；repo 只保留 `src/platform/`、`src/routes/`、`src/login/` 等平台接缝与路由职责

### Legacy 实现的处理规则

- 不再把当前 hand-written chat shell 当作长期视觉和交互基线
- 非阻塞性缺陷可以继续修
- 但新的 chat UX、样式系统和复杂交互不再优先落在这套实现里
- 后续 chat-first 产品增强默认应落在新的 Chatbot-derived shell 上

## 当时的阶段结论

`vercel/chatbot` 在本计划中的角色固定为：

- `frontend donor`
- `interaction/layout/style-system donor`

它不是：

- repo 的新产品架构
- `app-api` 的替代者
- `supervisor-api` 的替代者
- 我们新的 auth/session/conversation truth owner

因此，这一轮阶段目标当时被固定为：

`先把 donor frontend runtime 引入 apps/public-chat-web，再通过 repo-owned seam 接入 app-api`

## Upstream Donor Baseline

当前 donor 固定为：

- upstream repo: `vercel/chatbot`
- role: UI shell / component system / interaction reference
- license posture: Apache-2.0

在正式实施前，必须额外落一份 donor baseline 记录，至少包含：

- upstream repo URL
- pinned commit SHA
- license note
- 允许继承的目录/模块
- 禁止继承的目录/模块
- 我们的 patch policy

后续已新增：

- `docs/reference/public-chat-web-chatbot-donor-baseline.md`

## 允许继承的内容

新的 `public-chat-web` 允许系统性继承以下形态：

- chat shell 总体布局
- sidebar / history / composer / message list 的交互结构
- empty / loading / error / history states 的视觉组织
- shadcn/ui + Tailwind + Radix 这一类稳定前端原语体系
- message card、thread shell、sidebar primitives、header/footer 等前端组件模式

可以直接追求的结果：

- 当前 `public-chat-web` 的视觉与交互不再由 repo 内手写 CSS 从零维护
- 后续 chat surface 的大多数样式变化可以收敛到 donor-derived design system 内完成

## 禁止继承的内容

以下内容必须显式排除：

- Next.js App Router
- React Server Components
- Server Actions
- Auth.js
- Neon / Blob 等默认持久化方案
- Vercel AI Gateway 默认接法
- model selector
- attachments
- artifacts pane
- tool approval UI
- 任何把 open-domain provider / model exposure 直接放进最终产品 UI 的默认结构

补充说明：

- 上面这组“允许/禁止继承”规则属于第一轮 cutover 的阶段边界。
- 当前 donor-visible path 的严格行为对齐，以 `public-chat-web-vendor-runtime-full-transplant.md` 为准，不再由本文定义。

## 目标实现形态

重构完成后的 `apps/public-chat-web` 应拆成四层：

### 1. Worker shell

继续由现有 Worker runtime 壳负责：

- `/healthz`
- `/readyz`
- same-site `/api/* -> app-api`
- frontend assets serving

这层继续保留在：

- `apps/public-chat-web/src/index.ts`

### 2. Login surface

`/login` 继续是我们自己的登录页和 session UX。

要求：

- 不把 Chatbot 自带的 auth 方案迁入 repo
- 登录完成后仍通过当前 same-site auth seam 进入 `app-api`
- Chatbot-derived shell 可以与登录页风格对齐，但不接管登录真相

### 3. Chatbot-derived shell

`/chat` 与 `/chat/:conversationId` 应重建为：

- donor-derived sidebar/history shell
- donor-derived message/composer layout
- donor-derived design-system primitives

但它的数据来源继续是我们的 adapter，不直连 donor 默认 backend

### 4. Adapter seam

必须新增一层前端 adapter，把 UI 内部消息模型映射到当前 `app-api` contract。

建议最少拆成：

- `auth adapter`
- `conversation adapter`
- `message adapter`
- `chat transport adapter`

adapter 的职责是：

- 把 `GET /api/me` 转成前端 session state
- 把 conversation APIs 转成 sidebar/history view model
- 把 `POST /api/chat/requests` 的 typed outcome 转成 Chatbot-style message state
- 屏蔽 `app-api` 具体 contract 对 donor UI 的直接泄漏

## 当时的阶段性 app-api contract 对齐策略（历史记录）

当时这一阶段不要求 `app-api` 改成 Chatbot 默认的 `/api/chat` streaming contract。

第一阶段固定采取：

- backend canonical truth 不动
- 前端通过 adapter 适配当前 contract

当前 adapter 应围绕以下 seam：

- `GET /api/me`
- `GET /api/chat/conversations`
- `POST /api/chat/conversations`
- `GET /api/chat/conversations/:conversationId`
- `POST /api/chat/requests`

### 第一阶段消息语义

adapter 需要把当前结果类型映射为稳定前端消息视图：

- `answer`
- `clarification`
- `no_answer`
- `error`

并支持：

- 首轮请求不带 `conversationId`
- lazy create conversation
- history sidebar 刷新
- request-in-flight UI
- typed safe failure rendering

### 关于 streaming

这次重构默认不把 streaming 作为前置依赖。

顺序固定为：

1. 先完成 UI shell replatform
2. 先保证现有 request/response contract 能稳定接线
3. 如果后续需要更高程度复用 AI SDK transport，再单独评估 streaming facade

## 当时的退役策略

本计划把当前 hand-written chat shell 视为：

- `running implementation`
- `deprecated UI baseline`

切换规则：

### Phase A：并存期

- 新旧实现可以短期并存
- 但只能有一条产品主路由作为默认入口
- 旧实现不再承接新的视觉/交互增长

### Phase B：cutover

- `/chat` 与 `/chat/:conversationId` 切到 Chatbot-derived shell
- 新 shell 完成 staging smoke 与验收

### Phase C：退役

- 删除旧 UI 代码
- README / runbook / tests / smoke artifact 全部切到新实现
- 旧实现只保留在 git history 与必要文档说明中

## 当时的实施波次

## Wave 1：Source Freeze And Scaffold

目标：

- 冻结 donor baseline
- 建立 repo 内实现边界
- 建立新的目录骨架与 design-system 入口

交付物：

- donor baseline reference doc
- `apps/public-chat-web` 新的 shell/adapters 目录结构
- Tailwind / shadcn / Radix 最小接入
- 当前 legacy implementation 的 deprecation note

## Wave 2：Static Shell And Design System

目标：

- 迁移静态 chat shell
- 完成 sidebar/history/composer/message layout
- 建立可复用 design tokens

交付物：

- 新 shell 可在本地无数据渲染
- 样式体系从 hand-written CSS 主导切到 donor-derived design system

## Wave 3：Session / Conversation Adapter

目标：

- 接上 session bootstrap
- 接上 conversation history
- 完成 `/login -> /chat` 的基础体验

交付物：

- `GET /api/me` adapter
- conversation list/detail adapter
- history / empty state / unauthorized state 正常工作

## Wave 4：Chat Request Adapter

目标：

- 接上 `POST /api/chat/requests`
- 渲染 answer / clarification / no_answer / error

交付物：

- submit / loading / failure / retry UX
- typed outcome 到 UI message state 的稳定映射

## Wave 5：Cutover And Cleanup

目标：

- 替换默认 `/chat` 实现
- staging smoke
- 删除 legacy UI

交付物：

- staging smoke 证据
- runbook 更新
- legacy chat shell 删除

当前这份历史计划中的 Wave 5 closeout policy：

- 默认产品入口固定为 `/chat` 与 `/chat/:conversationId`
- `src/public-chat/` 只继续保留 `/login`、session bootstrap、route status card 与 boot fallback
- staging browser smoke 与 repo docs/runbooks 已全部切到 donor shell 后，`/chat/replatform-preview*` 已从 repo runtime path 移除
- legacy 直访旧 preview 前缀时，由 Worker runtime 直接 canonicalize 到 `/chat`，而不是在 SPA 内继续保留 preview branch 或把旧前缀误当成 `conversationId`

## 验证与验收

每个 wave 至少应覆盖：

- `pnpm --dir apps/public-chat-web typecheck`
- 对应 node/unit tests
- 对应 Worker shell tests

最终 cutover gate 至少包括：

- `/login` 正常
- `/chat` 首轮提问正常
- `/chat/:conversationId` 打开已有对话正常
- history sidebar 正常
- logout 正常
- same-site `/api/*` seam 未退化
- staging browser smoke 有真实证据

## 明确不在本计划内的内容

- 重新设计 `app-api` 为 Chatbot backend
- 让 browser 直连 `app-api`
- 让 `app-api` 迁就 Next.js / Auth.js 的默认 contract
- 在这轮同时引入 attachments / artifacts pane / model selector
- 在这轮把 open-domain 能力重新塞回 campus path

## 外部参考

- `vercel/chatbot` README
  - <https://github.com/vercel/chatbot/blob/main/README.md>
- AI SDK UI transport
  - <https://v5.ai-sdk.dev/docs/ai-sdk-ui/transport>
- Chatbot license
  - <https://github.com/vercel/chatbot/blob/main/LICENSE>

## Summary

本计划当时固定的结论是：

- 当前 `public-chat-web` 的 UI 实现应视为过渡实现，并退役为参考实现
- forward canonical surface 仍然是 `apps/public-chat-web`
- `public-chat-web` 的下一版应以 Chatbot-derived shell 为基底，而不是继续扩大 hand-written chat UI
- 主拓扑、auth/session/conversation ownership 与 `app-api` contract 在这次重构中保持不变

当前补充结论：

- 上述内容只解释第一轮 runtime cutover 如何成立，不再定义当前 strict donor parity 的完成标准。
- 当前 `public-chat-web` 的 active blocker 与验收口径，必须回到 `public-chat-web-vendor-runtime-full-transplant.md` 与配套 reference 文档。
