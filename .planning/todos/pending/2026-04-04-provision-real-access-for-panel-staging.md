---
created: 2026-04-04T12:29:41.455Z
title: 完成 panel-staging 的真实 Access smoke 身份闭环
area: auth
files:
  - apps/protected-panel-web/src/index.ts
  - apps/protected-panel-web/scripts/deploy-staging.mjs
  - docs/runbooks/staging-worker-deploy-runbook.md
  - docs/runbooks/dev-backed-supervisor-staging-smoke-runbook.md
  - .tmp/staging-smoke/20260406T032941-wave-b-closure
---

## Problem

`panel-staging.ayafeed.com` 的真实 Cloudflare Access 已经在前面了，不再是“尚未 provision”。当前 `https://panel-staging.ayafeed.com/healthz` 与 `/readyz` 都会 `302` 到真实 Access 登录页，浏览器快照也已经能看到 GitHub 与 email one-time code 两种登录方式。

因此当前 panel lane 的剩余 blocker 已经收敛成：没有可用于 smoke 的 staging operator 身份 / 凭证来源。只要这个身份没有落地，就无法把 `protected-panel-web -> app-api` 的真实 interactive smoke 标记为关闭。

## Solution

1. 不再重复做 Access provisioning；除非 `panel-staging` 再次退化成 worker 直接回 `Missing Access JWT.`，否则默认 Access app / policy 已生效。
2. 为 staging 准备一条真实的 operator smoke 身份，明确它走 GitHub 还是 email one-time code。
3. 用该身份完成浏览器登录，并至少复验 `GET /api/overview` 或 `GET /api/requests`。
4. 把请求结果、panel 页面 outcome 与 trace 信息追加到 `.tmp/staging-smoke/<timestamp>/` 和 `.tmp/observability-smoke/<timestamp>/`。
