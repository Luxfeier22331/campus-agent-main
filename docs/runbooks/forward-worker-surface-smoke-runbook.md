---
doc_type: runbook
status: active
created: 2026-03-29
updated: 2026-05-07
---
# Forward Worker Surface Smoke Runbook

## 文档边界

这份 runbook 只记录当前 forward product topology 的最小 smoke 入口：

- `apps/app-api`
- `apps/public-docs`
- `apps/public-chat-web`
- `apps/protected-panel-web`

它回答的是：

- 当前仓库里哪组命令可以稳定验证 forward Worker surfaces
- 这些 smoke 证明了什么
- 这些 smoke 还没有证明什么

它不替代：

- 长期拓扑边界：`docs/architecture/system/product-runtime-architecture.md`
- `app-api` 内部边界：`docs/architecture/system/product-runtime-architecture.md`
- protected panel operator
  access：`docs/architecture/system/product-runtime-architecture.md`
- 当前 phase 状态：`.planning/PROJECT.md`、`.planning/WORKSTREAMS.md` 与对应 workstream
  `STATE.md`

## 当前 smoke 形态

当前 repo 还没有把 `public-docs`、`public-chat-web`、`protected-panel-web` 与 shared
`app-api` 收敛成一个统一的 repo-level `pnpm smoke` 脚本。

因此，当前 canonical gate 仍然是基于 Worker runtime 的 targeted vitest 用例；其中
`public-chat-web` 与 `public-docs` 的本地 browser/live smoke 入口都已经固定为单命令 shared
Worker 拓扑，而不是分开启动两个 `pnpm dev` 会话。

## 前置条件

- 已完成依赖安装
- 本地可执行 `pnpm`
- 运行 Worker 测试时允许本地监听端口
- 为避免 `wrangler` 写入默认家目录日志，命令使用 repo-local `XDG_CONFIG_HOME=./.wrangler-home`
- 做 `public-docs` 或 `public-chat-web` local browser smoke 前，如果本地 Postgres 可能落后于
  `apps/app-api/db/shared-product-migrations/*`，先执行 `pnpm --dir apps/app-api
  db:bootstrap`

## 标准命令

先验证 shared `app-api` Worker runtime：

```bash
pnpm --dir apps/app-api test:worker -- --reporter=verbose
```

再验证 docs surface Worker shell 与 same-site control-plane bridge：

```bash
pnpm --dir apps/public-docs test:worker -- --reporter=verbose
```

再验证 public chat 主链路 smoke：

```bash
pnpm --dir apps/public-chat-web test:worker -- --reporter=verbose -t \
  "smokes a chat request through public-chat-web into app-api"
```

再验证 public auth proxy 仍保留 Better Auth 所需请求头：

```bash
pnpm --dir apps/public-chat-web test:worker -- --reporter=verbose -t \
  "forwards origin and referer for same-site auth requests"
```

并验证 public chat shell 在 `app-api` bridge 缺失时保持 fail-closed：

```bash
pnpm --dir apps/public-chat-web test:worker -- --reporter=verbose -t \
  "fails closed when app-api binding is not configured for the public shell"
```

最后验证 protected panel 请求查询链路 smoke：

```bash
pnpm --dir apps/protected-panel-web test:worker -- --reporter=verbose -t \
  "smokes request queries through protected-panel-web into app-api with \
  internal caller admission"
```

并验证 protected panel 在 admission 缺失时保持 fail-closed：

```bash
pnpm --dir apps/protected-panel-web test:worker -- --reporter=verbose -t \
  "fails closed when protected overview admission is not configured"
```

再验证 protected panel 在 trusted bridge 缺失时也保持 fail-closed：

```bash
pnpm --dir apps/protected-panel-web test:worker -- --reporter=verbose -t \
  "fails closed when the protected shell bridge is not configured|fails \
  closed when protected overview bridge is not configured"
```

## Public Chat Browser Smoke

如果要做 `public-chat-web` 的本地浏览器冒烟，使用下面这条命令：

```bash
pnpm --dir apps/public-chat-web dev:live-smoke
```

约束：

- 这条命令固定监听 `<http://127.0.0.1:27011`>
- 它通过 Cloudflare Vite plugin 的 `auxiliaryWorkers` 带起 shared `apps/app-api`
- `app-api` 使用 [wrangler.local-smoke.toml](/home/reptilian/code/campus-agent/app
  s/app-api/wrangler.local-smoke.toml) 注册为本地 `app-api` Worker，保证
  `public-chat-web` 的 same-site `/api/*` service binding 能命中真实 Worker runtime
- 不要再把 `pnpm --dir apps/public-chat-web dev` 和 `pnpm --dir apps/app-api dev`
  作为本地 browser smoke 的前提；分开会话适合单 app 调试，但不是 canonical browser smoke 拓扑
- 如需真实登录与发问链路，优先使用 `pnpm --dir apps/app-api chat:e2e:dev`
  让 repo-owned wrapper 预置 smoke identity 并执行请求
- `db:reconcile-shared-drift` 不能替代 `db:bootstrap`：前者只覆盖 drizzle shared-db
  adoption truth，不覆盖 `chat.*` 的 shared-product bootstrap migration

## Public Docs Browser Smoke

如果要做 `public-docs` 的本地浏览器冒烟，使用下面这条命令：

```bash
pnpm --dir apps/public-docs dev:live-smoke
```

约束：

- 这条命令固定监听 `http://127.0.0.1:27114`
- 它先执行 `public-docs build`，保证 Worker `ASSETS` 绑定消费的是实际 `doc_build/` 静态目录
- 它通过单个 Wrangler dev session 同时带起 `apps/public-docs` 与 shared `apps/app-api`
- `public-docs` 使用 [wrangler.local-smoke.toml](/home/reptilian/code/campus-agent/apps/public-docs/wrangler.local-smoke.toml)
  注册本地 docs Worker，`app-api` 使用
  [wrangler.local-smoke.toml](/home/reptilian/code/campus-agent/apps/app-api/wrangler.local-smoke.toml)
  注册本地 shared Worker
- `public-docs /readyz` 只探测 `app-api /api/docs/readyz`；它表达的是 document reader
  control-plane readiness，不等于整个 `app-api` 产品 runtime readiness
- 不要再把 `pnpm --dir apps/public-docs dev` 和 `pnpm --dir apps/app-api dev`
  作为 docs browser smoke 的前提；分开会话适合单 app 调试，但不是 canonical docs smoke 拓扑
- `public-docs` 只代理 same-site `/api/docs/*`；`/api/chat/*`、operator APIs 和其他 app-api
  surface 不在 docs browser smoke 范围内

## Public Chat E2E Profiles

public/chat 的 E2E contract 不应由 staging 域名定义。当前 repo-owned 入口是：

```bash
pnpm --dir apps/app-api chat:e2e:dev
pnpm --dir apps/app-api chat:e2e:staging
pnpm --dir apps/app-api chat:e2e:local-real-provider
```

profile 语义：

- `dev`：面向 repo-local dev URLs；wrapper 会启动 local execution runtime，
  预置 smoke identity，启动或复用 `public-chat-web dev:live-smoke`，再通过
  `http://127.0.0.1:27011 -> service binding app-api -> http://127.0.0.1:27051`
  执行真实 public/chat 请求
- `staging`：部署验收 profile，默认使用 `chat-staging` /
  `api-staging`；execution-control 只作为 app-api trusted machine upstream，不作为
  public smoke surface
- `local-real-provider`：复用 `dev` 的 public/chat 产品路径编排，但强制启用
  Temporal execution-control runtime 并默认使用真实
  `PROMPT_RUNTIME_PROVIDER=openai-responses`。它用于验证
  `public-chat-web -> app-api -> execution-control -> Temporal memory + RAG
  graph -> Go activity workers -> Go finalizer`，不是 deployed staging smoke，
  也不是 notice discover 专用 smoke

retired / offline RAG SDK candidate 的定位层 smoke 可以不经过前端直接执行。它只用于
offline / eval / historical bridge behavior 复核，不作为 online RAG serving acceptance：

```bash
uv run --all-packages python -m scripts.supervisor_runtime_process_smoke \
  --profile rag_delegate_sdk_candidate \
  --api-port 27151 \
  --worker-port 27152 \
  --output-dir .tmp/rag-sdk-process-smoke
```

`chat:e2e:dev` 要求 `APP_API_SMOKE_IDENTITY_PASSWORD`；它会读取
`apps/app-api/.env` / `.dev.vars`，执行 `db:bootstrap` 和
`smoke-identity:provision`。底层 `chat:e2e -- --profile dev` 只登录预置身份，
不使用 staging internal smoke session mint，也不要求单独暴露 `apps/app-api`
HTTP 端口；`public-chat-web /readyz` 负责证明 APP_API service binding 已连到真实
Worker runtime。`staging` profile 会在 readyz 失败时输出结构化 `blocked_by`，且不会
重置 smoke identity 或发起 chat request。

## 这组 smoke 证明什么

- `app-api` 的 `GET /healthz` 与 `GET /readyz` 正常
- `app-api` 的 fail-closed readiness 门禁正常工作
- `app-api` 的 `GET /api/docs/readyz` 只表达 docs surface 依赖的控制面 readiness
- `public-docs /readyz` 通过 same-site bridge 命中真实 `app-api /api/docs/readyz`
- `app-api` / `public-chat-web` 的 readiness 会透出
  `preflight.campusServicesProductPath`，用于 campus services product-path
  opening gate 诊断 capability / projection / read-model blocker
- `public-docs -> app-api` 的 same-site docs control-plane 链路可用
- `public-docs` 不会退化成 generic `app-api` proxy
- `public-chat-web -> app-api` 的 same-site chat request 链路可用
- `public-chat-web -> app-api` 的 Better Auth proxy 仍保留 `Origin` / `Referer`
- public chat shell 在 `app-api` bridge 缺失时不会对外暴露一个必坏的 SPA
- `protected-panel-web -> app-api` 的 operator request query 链路可用
- protected panel 到 `app-api` 的 trusted internal bridge admission 正常
- protected panel 在 admission 或 trusted bridge 配置缺失时不会对外暴露 shell 或 overview
- 四个 Worker surface 的动态响应都保持 `Cache-Control: no-store`

## 这组 smoke 不证明什么

- 不证明 protected panel 的浏览器 UI 已完成端到端验收
- 不证明 repo-level 一键多 Worker dev server 拓扑已经全部固化
- 不证明真实数据库、真实 Better Auth session 或真实 supervisor live execution 已接通
- 不证明 retrieval、grounding 或答案质量达标

## 与旧 smoke 的关系

- 已退役 standalone public chat app 的 live smoke 不再是 forward product topology 的
  canonical smoke 入口
- `public-docs` 的本地 browser/live smoke 已固定走 `dev:live-smoke` 单命令 shared Worker
  拓扑
- `public-chat-web` 的本地 browser/live smoke 已固定走 `dev:live-smoke` 单命令 auxiliary
  Worker 拓扑
- 如果未来要增加 repo-level 一键 browser/live smoke，应围绕
  `public-docs`、`public-chat-web`、`protected-panel-web` 和 shared `app-api` 继续收敛
