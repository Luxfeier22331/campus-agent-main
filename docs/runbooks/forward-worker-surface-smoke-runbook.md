---
doc_type: runbook
status: active
created: 2026-03-29
updated: 2026-04-11
---

# Forward Worker Surface Smoke Runbook

## 文档边界

这份 runbook 只记录当前 forward product topology 的最小 smoke 入口：

- `apps/app-api`
- `apps/public-chat-web`
- `apps/protected-panel-web`

它回答的是：

- 当前仓库里哪组命令可以稳定验证 forward Worker surfaces
- 这些 smoke 证明了什么
- 这些 smoke 还没有证明什么

它不替代：

- 长期拓扑边界：`docs/architecture/product-runtime-architecture.md`
- `app-api` 内部边界：`docs/architecture/product-runtime-architecture.md`
- protected panel operator access：`docs/architecture/product-runtime-architecture.md`
- 当前 phase 状态：`.planning/PROJECT.md`、`.planning/WORKSTREAMS.md` 与对应 workstream `STATE.md`

## 当前 smoke 形态

当前 repo 还没有把 `public-chat-web`、`protected-panel-web` 与 shared `app-api` 收敛成一个统一的 repo-level `pnpm smoke` 脚本。

因此，当前 canonical gate 仍然是基于 Worker runtime 的 targeted vitest 用例；但 `public-chat-web` 的本地 browser/live smoke 入口已经固定为单命令 auxiliary Worker 拓扑，而不是分开启动两个 `pnpm dev` 会话。

## 前置条件

- 已完成依赖安装
- 本地可执行 `pnpm`
- 运行 Worker 测试时允许本地监听端口
- 为避免 `wrangler` 写入默认家目录日志，命令使用 repo-local `XDG_CONFIG_HOME=./.wrangler-home`
- 做 `public-chat-web` local browser smoke 前，如果本地 Postgres 可能落后于 `apps/app-api/db/shared-product-migrations/*`，先执行 `pnpm --dir apps/app-api db:bootstrap`

## 标准命令

先验证 shared `app-api` Worker runtime：

```bash
pnpm --dir apps/app-api test:worker -- --reporter=verbose
```

再验证 public chat 主链路 smoke：

```bash
pnpm --dir apps/public-chat-web test:worker -- --reporter=verbose -t "smokes a chat request through public-chat-web into app-api"
```

再验证 public auth proxy 仍保留 Better Auth 所需请求头：

```bash
pnpm --dir apps/public-chat-web test:worker -- --reporter=verbose -t "forwards origin and referer for same-site auth requests"
```

并验证 public chat shell 在 `app-api` bridge 缺失时保持 fail-closed：

```bash
pnpm --dir apps/public-chat-web test:worker -- --reporter=verbose -t "fails closed when app-api binding is not configured for the public shell"
```

最后验证 protected panel 请求查询链路 smoke：

```bash
pnpm --dir apps/protected-panel-web test:worker -- --reporter=verbose -t "smokes request queries through protected-panel-web into app-api with internal caller admission"
```

并验证 protected panel 在 admission 缺失时保持 fail-closed：

```bash
pnpm --dir apps/protected-panel-web test:worker -- --reporter=verbose -t "fails closed when protected overview admission is not configured"
```

再验证 protected panel 在 trusted bridge 缺失时也保持 fail-closed：

```bash
pnpm --dir apps/protected-panel-web test:worker -- --reporter=verbose -t "fails closed when the protected shell bridge is not configured|fails closed when protected overview bridge is not configured"
```

## Public Chat Browser Smoke

如果要做 `public-chat-web` 的本地浏览器冒烟，使用下面这条命令：

```bash
pnpm --dir apps/public-chat-web dev:live-smoke
```

约束：

- 这条命令固定监听 `http://127.0.0.1:5173`
- 它通过 Cloudflare Vite plugin 的 `auxiliaryWorkers` 带起 shared `apps/app-api`
- `app-api` 使用 [wrangler.local-smoke.toml](/home/reptilian/code/campus-agent/apps/app-api/wrangler.local-smoke.toml) 注册为本地 `app-api` Worker，保证 `public-chat-web` 的 same-site `/api/*` service binding 能命中真实 Worker runtime
- 不要再把 `pnpm --dir apps/public-chat-web dev` 和 `pnpm --dir apps/app-api dev` 作为本地 browser smoke 的前提；分开会话适合单 app 调试，但不是 canonical browser smoke 拓扑
- 如需真实登录与发问链路，先用 `pnpm --dir apps/app-api smoke-identity:provision` 预置 smoke identity
- `db:reconcile-shared-drift` 不能替代 `db:bootstrap`：前者只覆盖 drizzle shared-db adoption truth，不覆盖 `chat.*` 的 shared-product bootstrap migration

## 这组 smoke 证明什么

- `app-api` 的 `GET /healthz` 与 `GET /readyz` 正常
- `app-api` 的 fail-closed readiness 门禁正常工作
- `public-chat-web -> app-api` 的 same-site chat request 链路可用
- `public-chat-web -> app-api` 的 Better Auth proxy 仍保留 `Origin` / `Referer`
- public chat shell 在 `app-api` bridge 缺失时不会对外暴露一个必坏的 SPA
- `protected-panel-web -> app-api` 的 operator request query 链路可用
- protected panel 到 `app-api` 的 trusted internal bridge admission 正常
- protected panel 在 admission 或 trusted bridge 配置缺失时不会对外暴露 shell 或 overview
- 三个 Worker surface 的动态响应都保持 `Cache-Control: no-store`

## 这组 smoke 不证明什么

- 不证明 protected panel 的浏览器 UI 已完成端到端验收
- 不证明 repo-level 一键多 Worker dev server 拓扑已经全部固化
- 不证明真实数据库、真实 Better Auth session 或真实 supervisor live execution 已接通
- 不证明 retrieval、grounding 或答案质量达标

## 与旧 smoke 的关系

- 已退役 standalone public chat app 的 live smoke 不再是 forward product topology 的 canonical smoke 入口
- `public-chat-web` 的本地 browser/live smoke 已固定走 `dev:live-smoke` 单命令 auxiliary Worker 拓扑
- 如果未来要增加 repo-level 一键 browser/live smoke，应围绕 `public-chat-web`、`protected-panel-web` 和 shared `app-api` 继续收敛
