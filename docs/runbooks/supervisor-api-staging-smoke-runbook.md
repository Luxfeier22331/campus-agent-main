---
doc_type: runbook
status: active
created: 2026-04-24
updated: 2026-04-24
---
# Supervisor API Staging Smoke Runbook

## 文档边界

这份 runbook 只覆盖当前 canonical staging smoke：

- `public-chat-web`
- `app-api`
- `supervisor-api` 由 repo-owned `supervisor-api` staging runtime 承接

它回答的是：

- 如何把 `chat-staging -> app-api-staging -> supervisor-api execution origin` 跑通
- 每轮 smoke 最少要验证哪些链路
- 什么时候需要重新 deploy `app-api-staging`

它不保留 legacy dev-backed upstream；当前 staging smoke 只以 Go `apps/supervisor-api`
execution origin 为准。

## 当前补充真相

- `apps/supervisor-api` 的前向 deploy substrate 已冻结为 Docker-first internal execution
  service
- 当前 repo-owned staging execution runtime 是
  `supervisor-api + supervisor-agent-worker + named tunnel`
- 如果继续复用 `<https://exec-staging.ayafeed.com`> 作为 execution origin，就不需要为了
  runtime hard cut 重新 deploy `app-api-staging`
- 只有当 execution upstream URL 本身变化时，才需要重新设置
  `STAGING_SUPERVISOR_API_BASE_URL` 并 redeploy `app-api`

## 判定标准

这条 smoke 通过，表示：

- `chat-staging -> app-api-staging -> current supervisor-api upstream` 真实可用
- browser 真实请求不再卡在 transport failure
- typed execution outcome 可以成功回到 chat surface

它不表示：

- 当前 chat answer 质量已经达到 release 标准
- production execution substrate 已经启用

## Step 1. 启动 canonical supervisor-api staging runtime

使用 repo-owned lifecycle 脚本：

```bash
infra/local/staging/start-supervisor-api-staging.sh
infra/local/staging/status-supervisor-api-staging.sh --check
```

最小通过标准：

- `infra/local/staging/status-supervisor-api-staging.sh --check` 返回 `0`

如果当前 host 是 WSL 且需要长期常驻，安装 Windows 计划任务：

```bash
infra/local/staging/install-supervisor-api-staging-task.sh
```

后续安装校验、冷启动恢复、日志轮转与故障分流统一进入
`supervisor-api-staging-operations.md`。

## Step 2. 判断是否需要重新 deploy app-api staging

分两种情况：

1. execution origin 继续使用 `<https://exec-staging.ayafeed.com`>

   - 不需要为了这次 hard cut 重新 deploy `app-api-staging`
   - 直接进入下一步做 health/smoke

1. execution origin 变成新的 URL

   - 必须重新 deploy `app-api-staging`

```bash
STAGING_SUPERVISOR_API_BASE_URL=https://<current-supervisor-upstream> \
pnpm --dir apps/app-api deploy:staging
```

然后检查：

```bash
curl --noproxy '*' -sS -i https://campus-api-staging.ayafeed.com/healthz
curl --noproxy '*' -sS -i https://campus-api-staging.ayafeed.com/readyz
```

通过标准：

- `healthz = 200`
- `readyz = 200`

## Step 3. Surface health smoke

确认三个 staging surface 在线：

```bash
curl --noproxy '*' -sS -i https://campus-chat-staging.ayafeed.com/healthz
curl --noproxy '*' -sS -i https://campus-chat-staging.ayafeed.com/readyz
curl --noproxy '*' -sS -i https://campus-panel-staging.ayafeed.com/healthz
curl --noproxy '*' -sS -i https://campus-panel-staging.ayafeed.com/readyz
```

同时确认：

```bash
curl --noproxy '*' -sS -i https://exec-staging.ayafeed.com/readyz
```

## Step 4. Authenticated Chat Smoke

优先使用 repo-owned automation：

```bash
pnpm --dir apps/app-api chat:smoke:staging
```

这条命令会：

1. 用固定 smoke identity `help_bot@outlook.com` 重建 staging 账号并清理旧聊天数据
1. 通过部署态 `app-api-staging`
   `POST /api/internal/staging-smoke/auth/session` 铸造真实 staging session cookie
1. 带着拿到的 session cookie 真实请求
   `https://campus-chat-staging.ayafeed.com/api/chat/requests`
1. 再检查 `api/me` 与 `api/chat/conversations`，确认会话有效且新会话进入 history

它要求当前 shell 有：

- `APP_API_STAGING_SMOKE_AUTH_SECRET` 或 `STAGING_APP_API_SMOKE_AUTH_SECRET`

它不要求：

- 预先提供 `APP_API_SMOKE_IDENTITY_PASSWORD`
- agent 在真实浏览器里通过 Turnstile challenge

如果需要追加人工 UI 验证，可在 automation 通过后再手工打开 `campus-chat-staging` 的
`/chat` 做 donor-shell 浏览器观察，但这不是 agent automation 的前置。

推荐问题：

- `中央民族大学本科学生国家奖学金评审办法`
- `民族学本科人才培养方案总学分要求是多少？`

通过标准：

- `chat:smoke:staging` 返回 `0`
- 它输出的 `request.resultKind` 是 typed outcome
- `POST /api/chat/requests` 返回 `200`
- `api/chat/conversations` 在请求后包含新 `conversationId`
- 不能出现 transport error、Worker proxy error、upstream unreachable

## Step 5. 记录链路证据

至少记录：

- `infra/local/staging/status-supervisor-api-staging.sh --check`
- `https://exec-staging.ayafeed.com/readyz`
- `https://campus-api-staging.ayafeed.com/readyz`
- `pnpm --dir apps/app-api chat:smoke:staging` 的 JSON 摘要
- 当前 execution origin 是否复用了既有 `exec-staging.ayafeed.com`

## Rollback

如果 smoke 失败且无法快速恢复：

1. 停掉 canonical runtime：

```bash
infra/local/staging/stop-supervisor-api-staging.sh
```

1. 按 fallback runbook 恢复 legacy dev-backed runtime
1. 如果 execution upstream URL 曾经改动，再把 `STAGING_SUPERVISOR_API_BASE_URL` 改回旧值并重新 deploy
   `app-api-staging`
