---
created: 2026-04-04T12:29:41.455Z
title: 重新部署并复验 chat-staging
area: testing
files:
  - apps/public-chat-web/src/index.ts
  - docs/runbooks/dev-backed-supervisor-staging-smoke-runbook.md
  - .tmp/staging-smoke/20260404T201611-postdeploy
  - .tmp/staging-smoke/20260404T201843-auth-loop
---

## Problem

前向 staging truth 已切换到 `https://chat-staging.ayafeed.com`，但待完成的问题不变：`public-chat-web-staging` 当前仍会把 `app-api-staging` 的未就绪状态暴露出来，`/readyz` 返回 `503`，且 live sign-up / chat 链路会在 `app-api` auth runtime 抖动时返回 `dependency_not_ready`。这个 surface 不能单独修补；必须在 `app-api` auth/DB runtime 稳定后重新部署并做真实 browser/chat smoke，确认 `chat-staging -> app-api-staging -> current supervisor upstream` 已恢复为稳定链路。

## Solution

待第一个阻塞项 `app-api-staging auth/DB runtime` 收口后：

1. 重新部署 `public-chat-web-staging`，确保它绑定当前 `app-api-staging` release。
2. 复核 `https://chat-staging.ayafeed.com/healthz` 与 `/readyz`。
3. 重新执行注册 / 登录 / `POST /api/chat/requests` live smoke，确认不再出现 `App API upstream is unavailable.` 或空 body `500`。
4. 把请求结果与页面 outcome 记录到新的 `.tmp/staging-smoke/<timestamp>/` 证据目录。
