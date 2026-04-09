---
doc_type: reference
status: active
created: 2026-04-09
updated: 2026-04-09
---

# Public Chat Web Donor Parity Review Checklist

## 文档边界

本文固定 `Phase 5` 的 donor parity release gate。

本文回答的是：

- staging 上哪些界面必须进入 donor parity review
- 每个 gate 的通过标准是什么
- `2026-04-09` 最新一轮真实 staging smoke 的当前结论是什么

本文不负责：

- 替代 `.tmp/staging-smoke/...` 下的原始截图与网络证据
- 改写 `public-chat-web -> app-api -> supervisor-api` 运行边界
- 把 `/login` 误记成 donor shell 的一部分

## Gate 说明

- `PASS`：运行与视觉都满足当前 gate
- `PARTIAL`：运行链路通过，但视觉或证据不完整
- `FAIL`：第一眼明显不是 donor-first shell，或关键 smoke 不通过
- `OUT-OF-SCOPE`：必须 smoke，但不进入 donor parity 本身

## 2026-04-09 当前结论

| Gate | 通过标准 | 当前结论 | 当前证据 |
|---|---|---|---|
| desktop `/chat` first impression | 第一眼接近 `vercel/chatbot` 的 chat-first shell | `PASS` | [desktop-empty-state-with-history.png](/home/reptilian/code/campus-agent/.tmp/staging-smoke/20260409T005148+0800-public-chat-phase5-postfix-retest/desktop-empty-state-with-history.png) |
| mobile `/chat` first impression | mobile 仍保持 donor shell，而不是把 desktop rails 堆成长页面 | `PASS` | [mobile-empty-state.png](/home/reptilian/code/campus-agent/.tmp/staging-smoke/20260409T005148+0800-public-chat-phase5-postfix-retest/mobile-empty-state.png) |
| sidebar / history | sidebar 是 donor-first history rail，而不是 repo 说明式 app rail | `PASS` | [desktop-empty-state-with-history.png](/home/reptilian/code/campus-agent/.tmp/staging-smoke/20260409T005148+0800-public-chat-phase5-postfix-retest/desktop-empty-state-with-history.png) |
| existing thread | 已有会话能在 donor 风格 thread 内显示 | `PASS` | [desktop-answer-state.png](/home/reptilian/code/campus-agent/.tmp/staging-smoke/20260409T005148+0800-public-chat-phase5-postfix-retest/desktop-answer-state.png) |
| empty state | empty state 不再直讲 `app-api` / seam / Worker 语义 | `PASS` | [desktop-empty-state-with-history.png](/home/reptilian/code/campus-agent/.tmp/staging-smoke/20260409T005148+0800-public-chat-phase5-postfix-retest/desktop-empty-state-with-history.png) |
| composer | composer copy、CTA、辅助说明接近 donor | `PASS` | [desktop-submit-in-flight.png](/home/reptilian/code/campus-agent/.tmp/staging-smoke/20260409T005148+0800-public-chat-phase5-postfix-retest/desktop-submit-in-flight.png) |
| submit in flight | submit 过程能在真实 staging 中稳定显示 pending UX | `PASS` | [desktop-submit-in-flight.png](/home/reptilian/code/campus-agent/.tmp/staging-smoke/20260409T005148+0800-public-chat-phase5-postfix-retest/desktop-submit-in-flight.png) |
| typed `answer` | typed `answer` 能映射到 shell message state | `PASS` | [desktop-answer-state.png](/home/reptilian/code/campus-agent/.tmp/staging-smoke/20260409T005148+0800-public-chat-phase5-postfix-retest/desktop-answer-state.png) |
| typed `clarification` | typed `clarification` 能映射到 shell message state | `PASS` | [desktop-clarification-state.png](/home/reptilian/code/campus-agent/.tmp/staging-smoke/20260409T005148+0800-public-chat-phase5-postfix-retest/desktop-clarification-state.png) |
| typed `no_answer` | typed `no_answer` 能映射到 shell message state | `PASS` | [desktop-no-answer-state.png](/home/reptilian/code/campus-agent/.tmp/staging-smoke/20260409T005148+0800-public-chat-phase5-postfix-retest/desktop-no-answer-state.png) |
| typed `error` | 当前轮必须有真实 staging typed `error` 证据 | `PARTIAL` | 当前轮未复现；历史上出现过 `supervisor_unavailable`，但不能替代 current-run gate |
| same-site `/api/*` seam | `/api/me`、`/api/chat/conversations`、`/api/chat/requests`、`/api/auth/sign-out` 仍走 same-site 且未退化 | `PASS` | [network-summary.md](/home/reptilian/code/campus-agent/.tmp/staging-smoke/20260409T005148+0800-public-chat-phase5-postfix-retest/network-summary.md) |
| `/login` | `/login` 可用、退出登录后可回到登录页 | `OUT-OF-SCOPE` | [login-after-signout.png](/home/reptilian/code/campus-agent/.tmp/staging-smoke/20260409T005148+0800-public-chat-phase5-postfix-retest/login-after-signout.png) |

## 当前阻塞项

当前 `Phase 5` 不能判定完成，原因只剩一个：

- 本轮真实 smoke 未复现 typed `error` message card；因此 `clarification / no_answer / error` 三态证据仍不完整

## 当前 release gate 判定

`2026-04-09` 当前判定：`BLOCKED`

理由：

- donor parity gate 已通过
- runtime smoke 已通过
- Phase 5 要求的 current-run typed `error` 证据仍缺

## 相关文件

- [public-chat-web-donor-first-reset.md](/home/reptilian/code/campus-agent/docs/plans/public-chat-web-donor-first-reset.md)
- [public-chat-web-donor-drift-inventory.md](/home/reptilian/code/campus-agent/docs/reference/public-chat-web-donor-drift-inventory.md)
- [SUMMARY.md](/home/reptilian/code/campus-agent/.tmp/staging-smoke/20260409T005148+0800-public-chat-phase5-postfix-retest/SUMMARY.md)
