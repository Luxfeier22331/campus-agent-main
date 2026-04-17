---
doc_type: plan
status: completed
created: 2026-04-08
updated: 2026-04-09
---

# Public Chat Web Donor-First Reset

## 文档边界

本文保留 `apps/public-chat-web` donor-first reset 的历史 closeout 记录。

它回答的是：

- 为什么早期 `src/chatbot-shell/` 路线被判定为错误方向
- donor-first reset 实际完成了哪些纠偏
- 为什么这份 reset 完成记录不能被误读成 strict donor parity 已关闭

它不负责：

- 继续承担当前 strict parity 的执行计划
- 改写 `public-chat-web -> app-api -> supervisor-api` 主链路
- 直接充当当前 runtime truth

## 当前定位

本文描述的 donor-first reset 已完成其历史目标，但它完成的是：

- 从 repo 自写壳回到 donor-derived shell
- 退役 `src/chatbot-shell/`、`src/chatbot-donor/`、`src/public-chat/` 这些错误主路径
- 把 chat runtime 收口到 `vendor/vercel-ai-chatbot/` + `src/platform/` + `src/routes/` + `src/login/`

它没有完成的是：

- strict donor parity
- donor-visible 组件行为与样式的 1:1 对齐

当前后续工作应以：

- [public-chat-web-vendor-runtime-full-transplant.md](/home/reptilian/code/campus-agent/.planning/archive-docs/docs/plans/public-chat-web-vendor-runtime-full-transplant.md)
- [public-chat-web-strict-donor-parity-gap-inventory.md](/home/reptilian/code/campus-agent/docs/reference/public-chat-web-strict-donor-parity-gap-inventory.md)

为准。

## 为什么要做这轮 Reset

这轮 reset 的出发点是把方向从：

- `adapt shell, then keep rewriting it`

纠偏回：

- `vendor full donor frontend, then adapt edges`

也就是说，它首先解决的是“不要继续在 repo 里维护一套 donor-like clone shell”，而不是“所有 donor-visible behavior 都已经完全对齐”。

## Reset 实际完成的内容

### 1. 主路径切回 donor-derived shell

- `/chat` 与 `/chat/:conversationId` 已切到 vendor-owned chat runtime
- donor tree 已落到 `apps/public-chat-web/vendor/vercel-ai-chatbot/`
- repo-owned runtime seam 已迁到 `apps/public-chat-web/src/platform/`

### 2. 旧壳与过渡目录退役

- `src/chatbot-shell/` 已退役，不再承担当前主路径
- `src/chatbot-donor/` 已退役，不再继续承载 donor-like clone UI
- `src/public-chat/` 的非登录职责已退出当前 runtime path

### 3. 运行边界收口

- `/login` 继续 repo-owned
- same-site `/api/*` 继续保持
- `app-api` 继续拥有 auth/session/conversation/request truth
- browser 不得绕过 `public-chat-web` 直打 `supervisor-api`

## 当前不能再从本文推出的结论

以下结论现在都不能再从本文推出：

- donor parity gate 已通过
- 当前只差 typed `error` 证据
- `public-chat-web` replatform 已完成最后 seam 收口
- route status / composer / sidebar / message / artifact 行为已经与 donor 对齐

这些判断现在都应改为查看：

- [public-chat-web-donor-parity-review-checklist.md](/home/reptilian/code/campus-agent/docs/reference/public-chat-web-donor-parity-review-checklist.md)
- [public-chat-web-route-state-parity-inventory.md](/home/reptilian/code/campus-agent/docs/reference/public-chat-web-route-state-parity-inventory.md)
- [public-chat-web-strict-donor-parity-gap-inventory.md](/home/reptilian/code/campus-agent/docs/reference/public-chat-web-strict-donor-parity-gap-inventory.md)

## Historical Acceptance

把这份 reset 视为完成，成立的条件只有：

- repo 不再以 hand-written transitional shell 作为当前 chat 主壳
- vendor tree 成为当前 chat UI 的唯一前向来源
- route cutover、same-site seam、旧 preview prefix 清理都已落证

它不是 strict donor parity 的完成条件。

## 相关文档

- [public-chat-web-vendor-runtime-full-transplant.md](/home/reptilian/code/campus-agent/.planning/archive-docs/docs/plans/public-chat-web-vendor-runtime-full-transplant.md)
- [public-chat-web-chatbot-donor-baseline.md](/home/reptilian/code/campus-agent/docs/reference/public-chat-web-chatbot-donor-baseline.md)
- [public-chat-web-strict-donor-parity-gap-inventory.md](/home/reptilian/code/campus-agent/docs/reference/public-chat-web-strict-donor-parity-gap-inventory.md)
