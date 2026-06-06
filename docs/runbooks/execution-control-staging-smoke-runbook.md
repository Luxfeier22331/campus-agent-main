---
doc_type: runbook
status: active
created: 2026-04-24
updated: 2026-05-01
---
# Execution Control Staging Smoke Runbook

## 文档边界

这份 runbook 只覆盖当前 canonical staging smoke：

- `public-chat-web`
- `app-api`
- `execution-control` 由 repo-owned `execution-control` staging runtime 承接

它回答的是：

- 如何把 `chat-staging -> app-api-staging -> execution-control execution origin` 跑通
- 每轮 smoke 最少要验证哪些链路
- 什么时候需要重新 deploy `app-api-staging`

它不保留 legacy dev-backed upstream；当前 staging smoke 只以 Go `apps/execution-control`
execution origin 为准。

## 当前补充真相

- `apps/execution-control` 的前向 deploy substrate 已冻结为 Docker-first internal execution
  service
- 当前 repo-owned staging execution runtime 是 `nc-arm-6c` 上的
  `otel-collector + execution-control + supervisor-agent-worker + named tunnel`
- 如果继续复用 `<https://exec-staging.mucwiki-edge.link`> 作为 execution origin，就不需要为了
  runtime hard cut 重新 deploy `app-api-staging`
- 只有当 execution upstream URL 本身变化时，才需要重新设置
  `STAGING_EXECUTION_CONTROL_BASE_URL` 并 redeploy `app-api`

## 判定标准

这条 smoke 通过，表示：

- `chat-staging -> app-api-staging -> current execution-control upstream` 真实可用
- browser 真实请求不再卡在 transport failure
- typed execution outcome 可以成功回到 chat surface

它不表示：

- 当前 chat answer 质量已经达到 release 标准
- production execution substrate 已经启用

## Step 1. 启动 canonical execution-control staging runtime

在 `nc-arm-6c:/srv/apps/campus-agent` 使用 repo-owned lifecycle 脚本：

```bash
infra/local/staging/start-execution-control-staging.sh
infra/local/staging/status-execution-control-staging.sh --check
```

最小通过标准：

- `infra/local/staging/status-execution-control-staging.sh --check` 返回 `0`

如果需要重装 Cloudflare connector systemd service，按
`execution-control-staging-operations.md` 的 `安装与重装` 执行。

## Step 2. 判断是否需要重新 deploy app-api staging

分两种情况：

1. execution origin 继续使用 `<https://exec-staging.mucwiki-edge.link`>

   - 不需要为了这次 hard cut 重新 deploy `app-api-staging`
   - 直接进入下一步做 health/smoke

1. execution origin 变成新的 URL

   - 必须重新 deploy `app-api-staging`

```bash
STAGING_EXECUTION_CONTROL_BASE_URL=https://<current-supervisor-upstream> \
pnpm --dir apps/app-api deploy:staging
```

然后检查：

```bash
curl --noproxy '*' -sS -i https://api-staging.mucwiki-edge.link/healthz
curl --noproxy '*' -sS -i https://api-staging.mucwiki-edge.link/readyz
```

通过标准：

- `healthz = 200`
- `readyz = 200`

## Step 3. Surface health smoke

确认三个 staging surface 在线：

```bash
curl --noproxy '*' -sS -i https://chat-staging.mucwiki-edge.link/healthz
curl --noproxy '*' -sS -i https://chat-staging.mucwiki-edge.link/readyz
curl --noproxy '*' -sS -i https://panel-staging.mucwiki-edge.link/healthz
curl --noproxy '*' -sS -i https://panel-staging.mucwiki-edge.link/readyz
```

同时确认：

```bash
curl --noproxy '*' -sS -i https://exec-staging.mucwiki-edge.link/healthz
```

`exec-staging /readyz` 是 execution-control full runtime probe；staging profile 下它需要
internal worker auth，不作为 public smoke gate。public smoke 通过
`api-staging /readyz` 间接验证 app-api 已经能带内部 shared secret 探测
execution runtime readiness。

## Step 4. Authenticated Chat Smoke

优先使用 repo-owned staging profile automation：

```bash
pnpm --dir apps/app-api chat:e2e:staging
```

新的 public/chat E2E contract 由 `apps/app-api/scripts/chat-e2e.ts` 定义；
staging 只是其中一个 profile，不再定义 E2E 本身。

`chat:e2e:staging` 与 `docs:gated:smoke:staging` 都通过
`apps/app-api/scripts/run-with-staging-smoke-env.mjs` 加载 staging smoke env。
该 runner 会使用 repo-local `.tmp/staging-smoke.lock` 串行化命令，避免两个
smoke 同时重建同一个固定 identity 导致 session mint 竞争。不要绕过 runner
并行执行会重置 `help_bot@outlook.com` 的 staging smoke 脚本。

这条命令会：

1. 先检查 `app-api-staging` 与 `chat-staging` 的 `readyz`
1. 若 readyz 阻塞，输出结构化 `blocked_by`，且不重置 smoke identity、不发起
   chat request
1. 用固定 smoke identity `help_bot@outlook.com` 重建 staging 账号并清理旧聊天数据
1. 通过部署态 `app-api-staging`
   `POST /api/internal/staging-smoke/auth/session` 铸造真实 staging session cookie
1. 带着拿到的 session cookie 真实请求
   `https://chat-staging.mucwiki-edge.link/api/chat/requests`
1. 再检查 `api/me` 与 `api/chat/conversations`，确认会话有效且新会话进入 history
1. 默认要求 `request.resultKind = "answer"`；如果 supervisor 返回 typed
   error outcome，脚本会退出非零并在错误里带上 `requestId` 与 `traceId`

它要求当前 shell 有：

- `APP_API_STAGING_SMOKE_AUTH_SECRET` 或 `STAGING_APP_API_SMOKE_AUTH_SECRET`

它不要求：

- 预先提供 `APP_API_SMOKE_IDENTITY_PASSWORD`
- agent 在真实浏览器里通过 Turnstile challenge

如果需要追加人工 UI 验证，可在 automation 通过后再手工打开 `chat-staging` 的
`/chat` 做 donor-shell 浏览器观察，但这不是 agent automation 的前置。

推荐问题：

- `中央民族大学本科学生国家奖学金评审办法`
- `民族学本科人才培养方案总学分要求是多少？`

通过标准：

- `chat:e2e:staging` 返回 `0`
- 它输出的 `request.resultKind` 是 `answer`
- `POST /api/chat/requests` 返回 `200`
- `api/chat/conversations` 在请求后包含新 `conversationId`
- 不能出现 transport error、Worker proxy error、upstream unreachable

只有在明确做 transport-only 调试时，才允许临时追加
`-- --expect-result-kind any`，该模式不作为 staging closeout gate。

如果需要临时调试 execution tunnel，可以显式追加
`-- --exec-readyz-url https://exec-staging.mucwiki-edge.link/readyz`。该模式只用于
transport debug；默认 staging closeout 不直接探 supervisor full `/readyz`。

## Step 5. 记录链路证据

至少记录：

- `infra/local/staging/status-execution-control-staging.sh --check`
- `https://exec-staging.mucwiki-edge.link/healthz`
- `https://api-staging.mucwiki-edge.link/readyz`
- `pnpm --dir apps/app-api chat:e2e:staging` 的 JSON 摘要
- 当前 execution origin 是否复用了既有 `exec-staging.mucwiki-edge.link`

## Rollback

如果 smoke 失败且无法快速恢复：

1. 停掉 canonical runtime：

```bash
infra/local/staging/stop-execution-control-staging.sh
```

1. 保持 execution upstream 指向 canonical staging runtime，并修复 canonical runtime 或
   `app-api-staging` 配置后重新执行 smoke
1. 不恢复 legacy dev-backed runtime；如果历史 runtime 仍在运行，先停掉再重试 canonical 启动
