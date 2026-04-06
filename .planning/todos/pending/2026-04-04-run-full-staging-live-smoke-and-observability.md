---
created: 2026-04-04T12:29:41.455Z
title: 完成 staging 全链路 live smoke
area: testing
files:
  - docs/runbooks/dev-backed-supervisor-staging-smoke-runbook.md
  - docs/runbooks/staging-worker-deploy-runbook.md
  - docs/runbooks/worker-observability-smoke-runbook.md
  - .tmp/staging-smoke/20260406T032941-wave-b-closure
  - .tmp/observability-smoke/20260406T032941-staging-wave-b
---

## Problem

Wave B 已经不再是“环境不存在 / chat 链路全坏”。当前真实 staging 情况是：

1. `api-staging.ayafeed.com` 的 `/healthz` 与 `/readyz` 都返回 `200`
2. `chat-staging.ayafeed.com` 的 `/healthz` 与 `/readyz` 都返回 `200`
3. `chat-staging` 真实请求已经恢复为 `answer` 路径，`request_id=req_3f493161ae6c4c669304c4ca439dfe4a`
4. `Axiom` 已查到对应的 `request.accepted -> projection.enqueued -> request.finalized` 以及最新 `projection.drain`
5. `panel-staging` 已是 Cloudflare Access 登录页，而不是“缺少 Access 入口”

当前剩余未闭环项只剩两类：

1. `protected-panel-web -> app-api` 缺少可用的 smoke 身份 / 凭证
2. `Sentry` 只有 deploy-side `DSN` 已下发，repo 侧还没有 sink-side lookup token / UI access，无法完成真正的 trace / event 确认

当前这条 todo 的前向 hostname truth 以一级子域为准：`api-staging.ayafeed.com`、`chat-staging.ayafeed.com`、`panel-staging.ayafeed.com`；旧的 `*.rag.ayafeed.com` 仅视为待迁移实现残留。

## Solution

按当前剩余 blocker 收口：

1. 以 `.tmp/staging-smoke/20260406T032941-wave-b-closure/` 与 `.tmp/observability-smoke/20260406T032941-staging-wave-b/` 作为新的 Wave B 基线证据，明确 chat lane 与 Axiom lane 已关闭。
2. 获取 panel staging 的真实 smoke 身份，完成 `protected-panel-web -> app-api` interactive smoke。
3. 补一条受控错误路径，并在拿到 `Sentry` sink-side 权限后完成 trace / event lookup。
4. 更新 `SUMMARY.md`，把这轮 staging 的最终状态从 “chat fixed, panel identity blocked, Sentry lookup blocked” 收口到真正的 full-lane closed。
