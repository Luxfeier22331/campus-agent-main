---
created: 2026-04-04T12:29:41.455Z
title: 完成 staging 全链路 live smoke
area: testing
files:
  - docs/runbooks/dev-backed-supervisor-staging-smoke-runbook.md
  - docs/runbooks/staging-worker-deploy-runbook.md
  - docs/runbooks/worker-observability-smoke-runbook.md
  - .tmp/staging-smoke/20260406T032941-wave-b-closure
  - .tmp/staging-smoke/20260406T115658-panel-requests-fix
  - .tmp/observability-smoke/20260406T032941-staging-wave-b
---

## Problem

Wave B 已经不再是“环境不存在 / chat 链路全坏”。当前真实 staging 情况是：

1. `campus-api-staging.ayafeed.com` 的 `/healthz` 与 `/readyz` 都返回 `200`
2. `campus-chat-staging.ayafeed.com` 的 `/healthz` 与 `/readyz` 都返回 `200`
3. `campus-chat-staging` 真实请求已经恢复为 `answer` 路径，`request_id=req_3f493161ae6c4c669304c4ca439dfe4a`
4. `Axiom` 已查到对应的 `request.accepted -> projection.enqueued -> request.finalized` 以及最新 `projection.drain`
5. `campus-panel-staging` 已是 Cloudflare Access 保护面，并且更晚的 live 证据 `.tmp/staging-smoke/20260406T115658-panel-requests-fix/SUMMARY.md` 已确认 `help_bot@outlook.com` 可以完成真实 operator smoke，`Requests` / detail / observability lane 都返回 `200`

当前剩余未闭环项只剩一类：

1. `Sentry` deploy-side `DSN` 已下发，repo 侧也已有可用的 `SENTRY_API_TOKEN` 并能读取 org / project；当前尚未完成真正的 trace / event 级别确认

当前这条 todo 的前向 hostname truth 以项目隔离一级子域为准：`campus-api-staging.ayafeed.com`、`campus-chat-staging.ayafeed.com`、`campus-panel-staging.ayafeed.com`；旧的 `*.rag.ayafeed.com` 与 generic 一级子域仅视为待迁移实现残留。

## Solution

按当前剩余 blocker 收口：

1. 以 `.tmp/staging-smoke/20260406T032941-wave-b-closure/` 与 `.tmp/observability-smoke/20260406T032941-staging-wave-b/` 作为新的 Wave B 基线证据，明确 chat lane 与 Axiom lane 已关闭。
2. 把 `.tmp/staging-smoke/20260406T115658-panel-requests-fix/SUMMARY.md` 升格为当前 panel lane 已关闭的 truth，避免 planning 继续把 panel identity 误写成 blocker。
3. 补一条受控错误路径，并用 repo-local `SENTRY_API_TOKEN` 完成 trace / event lookup。
4. 更新 `SUMMARY.md`，把这轮 staging 的最终状态从 “chat fixed, panel identity blocked, Sentry lookup blocked” 收口到 “chat/panel/Axiom closed, only Sentry event evidence pending” 或真正的 full-lane closed。
