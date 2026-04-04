---
created: 2026-04-04T12:29:41.455Z
title: 完成 staging 全链路 live smoke
area: testing
files:
  - docs/runbooks/dev-backed-supervisor-staging-smoke-runbook.md
  - docs/runbooks/staging-worker-deploy-runbook.md
  - .tmp/staging-smoke/20260404T172014
  - .tmp/staging-smoke/20260404T201611-postdeploy
  - .tmp/staging-smoke/20260404T201843-auth-loop
---

## Problem

当前 staging 还没有完成一轮真正闭环的 live smoke。`app-api-staging` auth runtime 仍不稳定，`chat-staging` 因上游未 ready 而失败，`panel-staging` 也还没有真实 Access 入口。因此当前证据只能证明“部署后暴露出了哪些真实问题”，不能证明 staging 已可作为前向联调环境，也没有形成完整的 Sentry / Axiom / request trace 证据闭环。

## Solution

按依赖顺序完成一轮完整 live smoke：

1. 先修掉 `app-api-staging` auth/DB runtime 不稳定。
2. 重新复验 `chat-staging` 注册 / 登录 / chat 请求。
3. 补齐真实 Cloudflare Access 并复验 `panel-staging`。
4. 检查 `readyz`、关键 API、浏览器路径、错误捕获、trace / event 写入是否全部符合 runbook。
5. 把当轮 supervisor upstream、Worker release、请求样本、结果摘要与 observability 证据写入新的 `.tmp/staging-smoke/<timestamp>/SUMMARY.md`。
