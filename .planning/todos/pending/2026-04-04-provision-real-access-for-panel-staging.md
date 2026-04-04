---
created: 2026-04-04T12:29:41.455Z
title: 为 panel-staging 接入真实 Access
area: auth
files:
  - apps/protected-panel-web/src/index.ts
  - apps/protected-panel-web/scripts/deploy-staging.mjs
  - docs/runbooks/staging-worker-deploy-runbook.md
  - docs/runbooks/dev-backed-supervisor-staging-smoke-runbook.md
  - .tmp/staging-smoke/20260404T201611-postdeploy
---

## Problem

前向 staging truth 已切换到 `panel-staging.ayafeed.com`。当前待完成的问题仍是：真实入口必须由 Cloudflare Access 浏览器准入接管，不能停留在 worker 直接检查 `CF_Authorization` header 的中间状态；否则 panel 不能视为真实受保护部署，也不能进行完整 smoke。

## Solution

1. 在 Cloudflare Zero Trust 侧为 `panel-staging.ayafeed.com` 建立真实 Access application / policy。
2. 获取并验证真实 `ACCESS_TEAM_DOMAIN` 与 `ACCESS_POLICY_AUD`。
3. 以真实值重新部署 `protected-panel-web-staging`，拒绝任何占位值或 worker-only admission 伪完成。
4. 复验浏览器首次访问必须先进入真实 Access 准入路径，而不是 worker 直接回 `Missing Access JWT.`。
5. 在 Access 生效后，再执行 `panel-staging` 页面与 `api/overview` smoke。
