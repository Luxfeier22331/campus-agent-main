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

`panel-staging.rag.ayafeed.com` 当前虽然已经返回新版 `/readyz` payload，但真实入口仍不是 Cloudflare Access 浏览器准入：访问 `/` 与 `/api/overview` 仍直接得到 worker 返回的 `401 Missing Access JWT.`。这说明 staging panel 还停留在“worker 检查 `CF_Authorization` header”的中间状态，不能视为真实受保护部署，也不能进行完整 panel smoke。

## Solution

1. 在 Cloudflare Zero Trust 侧为 `panel-staging.rag.ayafeed.com` 建立真实 Access application / policy。
2. 获取并验证真实 `ACCESS_TEAM_DOMAIN` 与 `ACCESS_POLICY_AUD`。
3. 以真实值重新部署 `protected-panel-web-staging`，拒绝任何占位值或 worker-only admission 伪完成。
4. 复验浏览器首次访问必须先进入真实 Access 准入路径，而不是 worker 直接回 `Missing Access JWT.`。
5. 在 Access 生效后，再执行 `panel-staging` 页面与 `api/overview` smoke。
