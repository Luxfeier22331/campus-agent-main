---
doc_type: runbook
status: active
created: 2026-04-24
updated: 2026-04-24
---
# Go-Shell Staging Smoke Runbook

## 文档边界

这份 runbook 只覆盖当前 canonical staging smoke：

- `public-chat-web`
- `app-api`
- `supervisor-api` 由 repo-owned `go-shell` staging runtime 承接

它回答的是：

- 如何把 `chat-staging -> app-api-staging -> go-shell execution origin` 跑通
- 每轮 smoke 最少要验证哪些链路
- 什么时候需要重新 deploy `app-api-staging`

它不把 legacy dev-backed upstream 写成当前 staging 真相；rollback / fallback 统一看
`dev-backed-supervisor-staging-smoke-runbook.md`。

## 当前补充真相

- `apps/supervisor-api` 的前向 deploy substrate 已冻结为 Docker-first internal execution
  service
- 当前 repo-owned staging execution runtime 是
  `go-shell + supervisor-orchestrator + named tunnel`
- 如果继续复用 `<https://exec-staging.ayafeed.com`> 作为 execution origin，就不需要为了
  runtime hard cut 重新 deploy `app-api-staging`
- 只有当 execution upstream URL 本身变化时，才需要重新设置
  `STAGING_SUPERVISOR_API_BASE_URL` 并 redeploy `app-api`

## 判定标准

这条 smoke 通过，表示：

- `chat-staging -> app-api-staging -> current go-shell upstream` 真实可用
- browser 真实请求不再卡在 transport failure
- typed execution outcome 可以成功回到 chat surface

它不表示：

- 当前 chat answer 质量已经达到 release 标准
- production execution substrate 已经启用

## Step 1. 启动 canonical go-shell staging runtime

使用 repo-owned lifecycle 脚本：

```bash
infra/local/staging/start-go-shell-staging.sh
infra/local/staging/status-go-shell-staging.sh --check
```

最小通过标准：

- `infra/local/staging/status-go-shell-staging.sh --check` 返回 `0`

如果当前 host 是 WSL 且需要长期常驻，安装 Windows 计划任务：

```bash
infra/local/staging/install-go-shell-staging-task.sh
```

后续安装校验、冷启动恢复、日志轮转与故障分流统一进入
`go-shell-staging-operations.md`。

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

## Step 4. Browser chat smoke

在真实 `campus-chat-staging` 页面执行：

1. 打开 `/login`
1. 使用固定 smoke identity 登录；如果密码漂移或历史数据需要重置，先在 shell 执行：

```bash
APP_API_SMOKE_IDENTITY_PASSWORD='<secret>' \
STAGING_APP_API_OPERATOR_DATABASE_URL=postgresql://<staging-operator-url> \
pnpm --dir apps/app-api smoke-identity:provision:staging -- --email \
  help_bot@outlook.com --name "Help Bot"
```

1. 不要在浏览器现场创建临时 end-user 账号；repo-tracked staging identity 仍以
   `help_bot@outlook.com` 为准
1. 进入 `/chat`
1. 发起一条首轮问题
1. 确认首轮成功后 sidebar/history 无需手动 reload 就能看到新会话

推荐问题：

- `中央民族大学本科学生国家奖学金评审办法`
- `民族学本科人才培养方案总学分要求是多少？`

通过标准：

- 页面请求 `POST /api/chat/requests` 返回 `200`
- 页面得到 typed outcome，并以显式结果态渲染 `answer` / `clarification` / `no_answer` /
  `error`
- outcome 可以是 `answer` / `clarification` / `no_answer`
- 不能是 transport error、Worker proxy error、upstream unreachable
- 首轮成功后不允许依赖手动刷新才能在左侧 history 看到新会话

## Step 5. 记录链路证据

至少记录：

- `infra/local/staging/status-go-shell-staging.sh --check`
- `https://exec-staging.ayafeed.com/readyz`
- `https://campus-api-staging.ayafeed.com/readyz`
- 一条 chat request 的成功截图或 typed result 摘要
- 当前 execution origin 是否复用了既有 `exec-staging.ayafeed.com`

## Rollback

如果 smoke 失败且无法快速恢复：

1. 停掉 canonical runtime：

```bash
infra/local/staging/stop-go-shell-staging.sh
```

1. 按 fallback runbook 恢复 legacy dev-backed runtime
1. 如果 execution upstream URL 曾经改动，再把 `STAGING_SUPERVISOR_API_BASE_URL` 改回旧值并重新 deploy
   `app-api-staging`
