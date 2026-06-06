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
- 改写 `public-chat-web -> app-api -> execution-gateway` 运行边界

## Gate 说明

- `PASS`：样式与组件行为都已经满足当前 gate
- `FAIL`：当前明确存在 strict parity blocker
- `OUT-OF-SCOPE`：必须 smoke，但不进入 donor parity 本身
- `AUTH-SURFACE`：正式 public auth surface；不计入 strict chat parity 结论，但必须单独记录 auth
  shell 验收

## Canonical Route / State Inventory

当前 strict donor parity gate 的 canonical route/state inventory 已并入本文。

- Route / State: `/`
  当前 owner: `src/routes/app-router.tsx`
  parity 级别: `none`
  约束: 只承担 redirect 到 `/chat` 的 route bootstrap

- Route / State: `/login`
  当前 owner: route layer + donor auth shell
  parity 级别: `auth-surface`
  约束: 正式 public auth surface，不计入 strict chat parity，但必须单独 smoke

- Route / State: `/register`
  当前 owner: route layer + donor auth shell
  parity 级别: `auth-surface`
  约束: 与 `/login` 同一 auth family，不得另起 repo-owned 新壳

- Route / State: `/chat`
  当前 owner: route layer -> `src/platform/chat/app-shell.tsx`
  parity 级别: `critical`
  约束: empty thread、首轮发送、entry bootstrap 都属于 parity gate

- Route / State: `/chat/:conversationId`
  当前 owner: route layer -> `src/platform/chat/app-shell.tsx`
  parity 级别: `critical`
  约束: existing thread、follow-up submit、request outcome mapping 都属于 parity gate

跨 route 状态固定包括：

- route entry states that appear before the chat shell is ready
- sidebar / history / user-nav actions
- thread / messages / tool outputs
- composer submit / navigate / edit flows
- empty / loading / error states inside or directly in front of the chat shell

## Review Checklist

- Gate: desktop `/chat` first impression
  通过标准: 第一眼接近 `vercel/chatbot` 的 chat-first shell
  建议证据来源: desktop 浏览器截图，必要时附 donor baseline 对照

- Gate: mobile `/chat` first impression
  通过标准: mobile 保持 donor shell，而不是退化成 repo 自写长页面
  建议证据来源: mobile 浏览器截图

- Gate: route entry states
  通过标准: `/chat` 进入过程不得由 repo-owned status card 或 app-shell fallback/redirect
  定义主路径行为
  建议证据来源: [app-router.tsx](/home/reptilian/code/campus-agent/apps/public-chat-we
  b/src/routes/app-router.tsx) [app-shell.tsx](/home/reptilian/code/campus-agent
  /apps/public-chat-web/src/platform/chat/app-shell.tsx)

- Gate: composer navigation semantics
  通过标准: 首轮发送前 route 切换、新建/删除会话后的落点、编辑消息回链都必须与 donor 等价
  建议证据来源: [multimodal-input.tsx](/home/reptilian/code/campus-agent/apps/public-c
  hat-web/vendor/vercel-ai-chatbot/components/chat/multimodal-input.tsx) [sugges
  ted-actions.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/vendor
  /vercel-ai-chatbot/components/chat/suggested-actions.tsx) [use-active-chat.tsx
  ](/home/reptilian/code/campus-agent/apps/public-chat-web/src/platform/chat/use
  -active-chat.tsx)

- Gate: sidebar / history / user-nav actions
  通过标准: 左 rail 的新建、切会话、删会话、退出登录必须与 donor 动作语义一致
  建议证据来源: [app-sidebar.tsx](/home/reptilian/code/campus-agent/apps/public-chat-w
  eb/vendor/vercel-ai-chatbot/components/chat/app-sidebar.tsx) [sidebar-history.
  tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/vendor/vercel-ai-c
  hatbot/components/chat/sidebar-history.tsx) [sidebar-user-nav.tsx](/home/repti
  lian/code/campus-agent/apps/public-chat-web/vendor/vercel-ai-chatbot/component
  s/chat/sidebar-user-nav.tsx) [public-chat-sidebar-parity.test.ts](/home/reptil
  ian/code/campus-agent/apps/public-chat-web/test/public-chat-sidebar-parity.tes
  t.ts)

- Gate: existing thread visual shell
  通过标准: 已有会话能在 donor 风格 thread 内显示
  建议证据来源: 线程态截图

- Gate: message / tool rendering behavior
  通过标准: tool output、fallback、error state 不能明显偏离 donor thread 行为
  建议证据来源: 结果态截图 [message.tsx](/home/reptilian/code/campus-agent/apps/public-chat
  -web/vendor/vercel-ai-chatbot/components/chat/message.tsx) [public-chat-messag
  e-parity.test.ts](/home/reptilian/code/campus-agent/apps/public-chat-web/test/
  public-chat-message-parity.test.ts)

- Gate: artifact / document runtime
  通过标准: artifact panel、document preview、editor runtime 的打开与流式行为必须与 donor 等价；仅在
  launch path 实际可见时纳入该轮 gate
  建议证据来源: [shell.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/ven
  dor/vercel-ai-chatbot/components/chat/shell.tsx) [data-stream-handler.tsx](/ho
  me/reptilian/code/campus-agent/apps/public-chat-web/vendor/vercel-ai-chatbot/c
  omponents/chat/data-stream-handler.tsx) [public-chat-artifact-runtime-parity.t
  est.ts](/home/reptilian/code/campus-agent/apps/public-chat-web/test/public-cha
  t-artifact-runtime-parity.test.ts)

- Gate: sharing / visibility off-path
  通过标准: `private-only` 模式下，launch path 不得继续暴露 share / public affordance
  建议证据来源: [public-chat-web-donor-diff-classification.md](/home/reptilian/code/ca
  mpus-agent/docs/reference/public-chat-web-donor-diff-classification.md) [publi
  c-chat-donor-diff-whitelist.test.ts](/home/reptilian/code/campus-agent/apps/pu
  blic-chat-web/test/public-chat-donor-diff-whitelist.test.ts)

- Gate: strict parity smoke / evidence pack
  通过标准: donor diff classification、desktop/mobile smoke、same-site network
  evidence 与本地 gate 必须同时闭合
  建议证据来源: 浏览器 smoke 产物、[public-chat-web-donor-diff-classification.md](/home/rept
  ilian/code/campus-agent/docs/reference/public-chat-web-donor-diff-classificati
  on.md)

- Gate: same-site `/api/*` seam
  通过标准: `/api/me`、`/api/history`、`/api/models`、`/api/chat/conversations`、`/api/c
  hat/requests` 都仍走 same-site 且未退化
  建议证据来源: network summary、worker smoke

- Gate: `/login` `/register`
  通过标准: `/login` 与 `/register` 可用，退出登录后可回到登录页；`/login` 保留 future recovery CTA
  slot；`/register` 不脱离 donor auth family
  建议证据来源: `AUTH-SURFACE`；单独记录 auth shell 验收，不混入 strict chat parity 结论

## Recommended Review Order

1. 先用 [public-chat-web-donor-diff-classification.md](/home/reptilian/code/campus
   - agent/docs/reference/public-chat-web-donor-diff-classification.md) 确认 donor
     baseline、允许继承边界与 accepted seam。
1. 再用本文确认该轮需要覆盖的 route/state 和 gate。
1. 用 [public-chat-web-donor-diff-classification.md](/home/reptilian/code/campus-
   agent/docs/reference/public-chat-web-donor-diff-classification.md) 判定当前 diff
   是否仍落在 accepted classes 内。
1. 最后把浏览器截图、same-site network summary 与本地 gate 产物收成一轮 smoke evidence。

## 相关文件

- [public-chat-web-donor-diff-classification.md](/home/reptilian/code/campus-age
  nt/docs/reference/public-chat-web-donor-diff-classification.md)
