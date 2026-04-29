---
created: 2026-04-24T08:57:38+08:00
title: 恢复 chat 容量与取消硬化
area: backend
owner: app-api
priority: app-api-runtime-backlog
files:
  - docs/reference/qa-assistant-and-harness-gap-review.md
  - .planning/workstreams/chat-capacity-and-cancellation-hardening/README.md
  - .planning/workstreams/chat-capacity-and-cancellation-hardening/REQUIREMENTS.md
  - .planning/workstreams/go-shell/STATE.md
  - apps/app-api/src/modules/runtime-command/service.ts
  - apps/go-shell/internal/httpapi/server.go
---

## Problem

2026-04-24 gap review 确认：public chat 的 100 人同时提问、热点削峰、
重复提交去重、用户取消、cooperative cancellation 与多实例容量治理仍在
`chat-capacity-and-cancellation-hardening` backlog 中。

这不是当前回答正确性的缺陷，但会在公开试用或 launch 时先暴露为体验与
运行时稳定性问题。

## Solution

只有当产品范围决定正式收口 public chat 容量 / 取消体验时再恢复：

1. 按现有 backlog workstream 的 reopen rule 恢复，不新开重复 workstream。
2. 先冻结 request lifecycle 中 `cancelled`、timeout、saturation、retryable 的
   canonical semantics。
3. 对齐 `app-api` projection、public chat UI、go-shell / supervisor runtime 的
   cooperative cancellation 口径。
4. 增加 burst / duplicate submit / abort / timeout smoke evidence。
