---
doc_type: runbook
truth_scope: ops
owner_boundary: docs/runbooks
status: active
created: 2026-03-29
updated: 2026-06-10
---

# Forward Worker Surface Smoke Runbook

## 文档边界

这份 runbook 只记录当前 forward product topology 的最小 smoke 入口：

- `apps/app-api`
- `apps/campus-web`
- `apps/operator-console-web`

它回答的是：

- 当前仓库里哪组命令可以稳定验证 forward Worker surfaces
- docs 已经如何并入 campus-web `/docs/*`
- 这些 smoke 证明了什么
- 这些 smoke 还没有证明什么

它不替代：

- 长期拓扑边界：`docs/architecture/system/product-runtime-architecture.md`
- `app-api` 内部边界：`docs/architecture/system/product-runtime-architecture.md`
- Operator Console operator access：
  `docs/architecture/system/product-runtime-architecture.md`
- 当前 phase 状态：`.planning/PROJECT.md`、`.planning/WORKSTREAMS.md`

## 当前 smoke 形态

当前 repo 还没有把 `campus-web`、`operator-console-web` 与 shared `app-api`
收敛成一个统一的 repo-level `pnpm smoke` 脚本。

因此，当前 canonical gate 仍然是基于 Worker runtime 的 targeted vitest 与 app-specific
smoke。docs 不再由独立 `public-docs` Worker 验证；docs browser route 和 same-origin
`/api/docs/*` proxy 由 `campus-web` 验证。

## 前置条件

- 已完成依赖安装
- 本地可执行 `pnpm`
- 运行 Worker 测试时允许本地监听端口
- 为避免 `wrangler` 写入默认家目录日志，命令使用 repo-local
  `XDG_CONFIG_HOME=./.wrangler-home`
- 做 online answer local browser smoke 前，如果本地 Postgres 可能落后于
  `apps/app-api/db/shared-product-migrations/*`，先执行
  `pnpm --dir apps/app-api db:bootstrap`

## 标准命令

先验证 shared `app-api` Worker runtime：

```bash
pnpm --dir apps/app-api test:worker -- --reporter=verbose
```

再验证 campus-web Worker shell、docs route/static reader delivery 与 same-origin API
allowlist：

```bash
pnpm --dir apps/campus-web test:worker -- --reporter=verbose
pnpm --dir apps/campus-web test:node -- test/campus-worker.test.ts
pnpm --dir apps/campus-web docs:build
```

再验证 campus-web online answer 主链路 smoke：

```bash
pnpm --dir apps/campus-web test:worker -- --reporter=verbose -t \
  "smokes a chat request through campus-web into app-api"
```

再验证 public auth proxy 仍保留 Better Auth 所需请求头：

```bash
pnpm --dir apps/campus-web test:worker -- --reporter=verbose -t \
  "forwards origin and referer for same-site auth requests"
```

并验证 online answer shell 在 `app-api` bridge 缺失时保持 fail closed：

```bash
pnpm --dir apps/campus-web test:worker -- --reporter=verbose -t \
  "fails closed when app-api binding is not configured for the public shell"
```

最后验证 Operator Console 请求查询链路 smoke：

```bash
pnpm --dir apps/operator-console-web test:worker -- --reporter=verbose -t \
  "smokes request queries through operator-console-web into app-api with \
  internal caller admission"
```

并验证 Operator Console 在 admission 或 trusted bridge 缺失时保持 fail closed：

```bash
pnpm --dir apps/operator-console-web test:worker -- --reporter=verbose -t \
  "fails closed when protected overview admission is not configured|fails \
  closed when protected overview bridge is not configured"
```

## Campus Docs Browser Smoke

当前 docs browser route 属于 campus-web。做本地 docs smoke 时使用：

```bash
pnpm --dir apps/campus-web docs:build
pnpm --dir apps/campus-web dev
```

约束：

- campus-web dev 固定监听 `http://127.0.0.1:27014`
- `docs:build` 先生成 Rspress reader assets，再由 campus-web 静态 delivery 提供
  `/docs/*` 与 `/static/*`
- `/_docs/*` 是匿名 public reader asset delivery
- `/_gated-docs/*` 必须走 Worker-first admission，并通过 same-origin
  `/api/docs/.../admission` 向 `app-api` 校验后读取静态资产
- campus-web 只代理 allowlisted `/api/docs/*`，unknown `/api/*`、operator APIs 与
  generic proxy 继续 fail closed

## Online Answer E2E Profiles

online answer 的 E2E contract 不应由 staging 域名定义。当前 repo-owned 入口是：

```bash
pnpm --dir apps/app-api chat:e2e:dev
pnpm --dir apps/app-api chat:e2e:staging
pnpm --dir apps/app-api chat:e2e:local-real-provider
```

profile 语义：

- `dev`：面向 repo-local dev URLs；wrapper 会启动 local execution runtime，预置 smoke
  identity，启动或复用 `campus-web dev:live-smoke`，再通过
  `http://127.0.0.1:27014 -> service binding app-api -> http://127.0.0.1:27051`
  执行真实 online answer 请求
- `staging`：部署验收 profile，默认使用 `campus-staging` /
  `api-staging`；execution-control 只作为 app-api trusted machine upstream，不作为
  public smoke surface
- `local-real-provider`：复用 `dev` 的 online answer 产品路径编排，但强制启用
  Temporal execution-control runtime 并默认使用真实
  `PROMPT_RUNTIME_PROVIDER=openai-responses`。它用于验证
  `campus-web -> app-api -> execution-control -> Temporal memory + RAG
  graph -> Go activity workers -> Go finalizer`，不是 deployed staging smoke，
  也不是 notice discover 专用 smoke

retired / offline RAG SDK candidate 的定位层 smoke 可以不经过前端直接执行。它只用于
offline / eval / historical bridge behavior 复核，不作为 online RAG serving acceptance：

```bash
uv run --all-packages python -m scripts.execution_control_process_smoke \
  --profile rag_delegate_sdk_candidate \
  --api-port 27151 \
  --output-dir .tmp/rag-sdk-process-smoke
```

## 这组 smoke 证明什么

- `app-api` 的 `GET /healthz` 与 `GET /readyz` 正常
- `app-api` 的 fail-closed readiness 门禁正常工作
- `app-api` 的 `GET /api/docs/readyz` 只表达 docs surface 依赖的控制面 readiness
- `campus-web` docs route 可以交付 Rspress-built reader pages
- `campus-web -> app-api` 的 same-origin docs control-plane 链路可用
- `campus-web` docs seam 不会退化成 generic `app-api` proxy
- gated reader assets 需要 `app-api` admission 后才能读取
- `campus-web -> app-api` 的 same-site chat request 链路可用
- `campus-web -> app-api` 的 Better Auth proxy 仍保留 `Origin` / `Referer`
- online answer shell 在 `app-api` bridge 缺失时不会对外暴露一个必坏的 SPA
- `operator-console-web -> app-api` 的 operator request query 链路可用
- Operator Console 到 `app-api` 的 trusted internal bridge admission 正常
- Operator Console 在 admission 或 trusted bridge 配置缺失时不会对外暴露 shell 或 overview

## 这组 smoke 不证明什么

- 不证明 Operator Console 的浏览器 UI 已完成端到端验收
- 不证明 repo-level 一键多 Worker dev server 拓扑已经全部固化
- 不证明真实数据库、真实 Better Auth session 或真实 supervisor live execution 已接通
- 不证明 retrieval、grounding 或答案质量达标

## 与旧 smoke 的关系

- `public-docs` 的本地 browser/live smoke 不再是 forward product topology 的 canonical
  smoke 入口；该 app 已删除，历史 Rspress/MDX/anchor/highlight/search 实现只能通过 git
  history 追溯
- `campus-web` 的本地 browser/live smoke 仍固定走 `dev:live-smoke` 单命令 auxiliary
  Worker 拓扑
- 如果未来要增加 repo-level 一键 browser/live smoke，应围绕 `campus-web`、
  `operator-console-web` 和 shared `app-api` 收敛
