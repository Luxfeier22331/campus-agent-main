---
doc_type: reference
status: active
created: 2026-04-09
updated: 2026-04-11
---

# Public Chat Web Donor Parity Review Checklist

## 文档边界

本文固定当前 `apps/public-chat-web` 的 strict donor parity release gate。

本文回答的是：

- staging 与本地 donor baseline 对照时，哪些界面必须进入 strict parity review
- 每个 gate 的当前判定是什么
- 为什么当前 gate 已可判定完成

本文不负责：

- 替代 `.tmp/staging-smoke/...` 的原始截图与网络证据
- 改写 `public-chat-web -> app-api -> supervisor-api` 运行边界
- 把 `/login` 误记成 donor shell 的一部分

## Gate 说明

- `PASS`：样式与组件行为都已经满足当前 gate
- `FAIL`：当前明确存在 strict parity blocker
- `OUT-OF-SCOPE`：必须 smoke，但不进入 donor parity 本身

## 2026-04-09 当前结论

当前 authoritative browser evidence 来自 `.tmp/staging-smoke/20260409T232000+0800-public-chat-wave6-closeout-2/`。
这轮 evidence 基于真实登录会话采集；Chrome DevTools MCP 在本轮持续 `Transport closed`，因此改由 `Playwright MCP` 收集。

| Gate | 通过标准 | 当前结论 | 当前证据 |
|---|---|---|---|
| desktop `/chat` first impression | 第一眼接近 `vercel/chatbot` 的 chat-first shell | `PASS` | [desktop-empty-state.png](/home/reptilian/code/campus-agent/.tmp/staging-smoke/20260409T232000+0800-public-chat-wave6-closeout-2/staging/desktop-empty-state.png) |
| mobile `/chat` first impression | mobile 保持 donor shell，而不是退化成 repo 自写长页面 | `PASS` | [mobile-chat-state.png](/home/reptilian/code/campus-agent/.tmp/staging-smoke/20260409T232000+0800-public-chat-wave6-closeout-2/staging/mobile-chat-state.png) |
| route entry states | `/chat` 进入过程不得由 repo-owned status card 或 app-shell fallback/redirect 定义产品主路径行为 | `PASS` | [app-router.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/src/routes/app-router.tsx) [app-shell.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/src/platform/chat/app-shell.tsx) |
| composer navigation semantics | 发送前 route 切换、新建/删除会话后的落点、编辑消息回链都必须与 donor 等价 | `PASS` | [multimodal-input.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/vendor/vercel-ai-chatbot/components/chat/multimodal-input.tsx) [suggested-actions.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/vendor/vercel-ai-chatbot/components/chat/suggested-actions.tsx) [use-active-chat.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/src/platform/chat/use-active-chat.tsx) |
| sidebar / history / user-nav actions | 左 rail 的新建、切会话、删会话、退出登录必须与 donor 动作语义一致 | `PASS` | [app-sidebar.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/vendor/vercel-ai-chatbot/components/chat/app-sidebar.tsx) [sidebar-history.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/vendor/vercel-ai-chatbot/components/chat/sidebar-history.tsx) [sidebar-user-nav.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/vendor/vercel-ai-chatbot/components/chat/sidebar-user-nav.tsx) [public-chat-sidebar-parity.test.ts](/home/reptilian/code/campus-agent/apps/public-chat-web/test/public-chat-sidebar-parity.test.ts) |
| existing thread visual shell | 现有会话能在 donor 风格 thread 内显示 | `PASS` | [desktop-thread-state.png](/home/reptilian/code/campus-agent/.tmp/staging-smoke/20260409T232000+0800-public-chat-wave6-closeout-2/staging/desktop-thread-state.png) |
| message / tool rendering behavior | tool output、fallback、error state 不能因为 repo patch 明显偏离 donor thread 行为 | `PASS` | [desktop-answer-state.png](/home/reptilian/code/campus-agent/.tmp/staging-smoke/20260409T232000+0800-public-chat-wave6-closeout-2/staging/desktop-answer-state.png) [message.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/vendor/vercel-ai-chatbot/components/chat/message.tsx) [public-chat-message-parity.test.ts](/home/reptilian/code/campus-agent/apps/public-chat-web/test/public-chat-message-parity.test.ts) |
| artifact / document runtime | artifact panel、document preview、editor runtime 的打开与流式行为必须与 donor 等价 | `PASS` | [shell.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/vendor/vercel-ai-chatbot/components/chat/shell.tsx) [data-stream-handler.tsx](/home/reptilian/code/campus-agent/apps/public-chat-web/vendor/vercel-ai-chatbot/components/chat/data-stream-handler.tsx) [public-chat-artifact-runtime-parity.test.ts](/home/reptilian/code/campus-agent/apps/public-chat-web/test/public-chat-artifact-runtime-parity.test.ts) |
| sharing / visibility off-path | campus mode 为 `private-only` 时，launch path 不得继续暴露 share / public affordance | `PASS` | [public-chat-web-donor-diff-whitelist.md](/home/reptilian/code/campus-agent/docs/reference/public-chat-web-donor-diff-whitelist.md) [public-chat-donor-diff-whitelist.test.ts](/home/reptilian/code/campus-agent/apps/public-chat-web/test/public-chat-donor-diff-whitelist.test.ts) |
| strict parity smoke / evidence pack | donor diff whitelist、desktop/mobile smoke、staging parity evidence 与 local gate 必须一起闭合 | `PASS` | [public-chat-web-donor-diff-whitelist.md](/home/reptilian/code/campus-agent/docs/reference/public-chat-web-donor-diff-whitelist.md) [SUMMARY.md](/home/reptilian/code/campus-agent/.tmp/staging-smoke/20260409T232000+0800-public-chat-wave6-closeout-2/SUMMARY.md) |
| same-site `/api/*` seam | `/api/me`、`/api/history`、`/api/models`、`/api/chat/conversations`、`/api/chat/requests` 仍走 same-site 且未退化 | `PASS` | [network-summary.md](/home/reptilian/code/campus-agent/.tmp/staging-smoke/20260409T232000+0800-public-chat-wave6-closeout-2/staging/network-summary.md) |
| `/login` | `/login` 可用、退出登录后可回到登录页 | `OUT-OF-SCOPE` | [login-after-signout.png](/home/reptilian/code/campus-agent/.tmp/staging-smoke/20260409T005148+0800-public-chat-phase5-postfix-retest/login-after-signout.png) |

## 当前阻塞项

当前没有剩余的 strict donor parity blocker。

## 当前 release gate 判定

`2026-04-09` 当前判定：`PASS`

理由：

- Wave 1-5 的 code-level donor drift 已全部关闭
- Wave 6 新发现的 `share / visibility on launch path` blocker 已关闭，并被 whitelist test 固定为回归门禁
- Wave 4 已把 remaining donor diff inventory 与 exact seam owner inventory 固定成 machine-check gate，当前 historical debt 路径数为 `0`
- fresh local gate 已通过：
  - `pnpm --dir apps/public-chat-web test:worker`
  - `pnpm --dir apps/public-chat-web typecheck`
  - `pnpm --dir apps/public-chat-web build`
- fresh staging smoke 已通过：
  - [SUMMARY.md](/home/reptilian/code/campus-agent/.tmp/staging-smoke/20260409T232000+0800-public-chat-wave6-closeout-2/SUMMARY.md)
  - [network-summary.md](/home/reptilian/code/campus-agent/.tmp/staging-smoke/20260409T232000+0800-public-chat-wave6-closeout-2/staging/network-summary.md)
- 这轮 authenticated smoke 已确认：
  - `GET /api/history?limit=20` 在真实 cookie session 下返回 `200`
  - `GET /api/models` 返回 `200`
  - `POST /api/chat/requests` 返回 `200`
- 本轮 staging 未观测到 artifact pane 在 launch path 打开；根据 [public-chat-web-route-state-parity-inventory.md](/home/reptilian/code/campus-agent/docs/reference/public-chat-web-route-state-parity-inventory.md)，`artifact/document open behavior` 只在 launch path 仍暴露该 affordance 时进入本轮 gate，因此不构成额外 blocker

## 2026-04-11 Post-Closeout Local Evidence

这份 checklist 的 strict parity 判定仍以 `2026-04-09` staging gate 为准；但 donor tech-debt convergence 的 Wave 5 local closeout 已另外补齐一轮 fresh browser evidence：

- [SUMMARY.md](/home/reptilian/code/campus-agent/.tmp/local-smoke/20260411T163903+0800-public-chat-wave5-closeout/SUMMARY.md)
- [network-summary.md](/home/reptilian/code/campus-agent/.tmp/local-smoke/20260411T163903+0800-public-chat-wave5-closeout/network-summary.md)
- [chat-response.png](/home/reptilian/code/campus-agent/.tmp/local-smoke/20260411T163903+0800-public-chat-wave5-closeout/screenshots/chat-response.png)
- [chat-reload.png](/home/reptilian/code/campus-agent/.tmp/local-smoke/20260411T163903+0800-public-chat-wave5-closeout/screenshots/chat-reload.png)

这轮 local evidence 额外确认：

- local `POST /api/chat/requests` 已从 earlier `500` 恢复到 `200`
- real browser session 下 `GET /api/models`、`GET /api/history?limit=20`、`POST /api/chat/requests` 都走 same-site `/api/*`
- sidebar history 在 first send 后无需手动 reload 即出现新会话；reload 后仍保留同一 `conversationId`
- 本轮 typed outcome 为 handled `execution_timeout`，不是 same-site seam 退化或 donor shell blocker
- earlier local `500` 的根因是本地 `chat.messages.structured_parts_json` 漏跑 shared-product bootstrap migration；closeout 采用 `pnpm --dir apps/app-api db:bootstrap` 修复，而不是在 runtime shell 上加兼容补丁

## 相关文件

- [public-chat-web-donor-diff-classification.md](/home/reptilian/code/campus-agent/docs/reference/public-chat-web-donor-diff-classification.md)
- [public-chat-web-donor-diff-whitelist.md](/home/reptilian/code/campus-agent/docs/reference/public-chat-web-donor-diff-whitelist.md)
- [public-chat-web-strict-donor-parity-gap-inventory.md](/home/reptilian/code/campus-agent/docs/reference/public-chat-web-strict-donor-parity-gap-inventory.md)
- [public-chat-web-route-state-parity-inventory.md](/home/reptilian/code/campus-agent/docs/reference/public-chat-web-route-state-parity-inventory.md)
