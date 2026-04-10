---
doc_type: runbook
status: active
created: 2026-04-04
updated: 2026-04-06
---

# Dev-Backed Supervisor Staging Smoke Runbook

## 文档边界

这份 runbook 只覆盖当前阶段的 staging smoke：

- `public-chat-web`
- `app-api`
- `supervisor-api` 仍由本地 `dev` / Docker 进程临时承接

它回答的是：

- 当 `supervisor-api` 还没有稳定部署时，如何把 staging chat execution 跑通
- 每轮 smoke 最少要验证哪些链路
- 哪些结果可以算“当前开发态 staging 可用”

它不把当前 `supervisor-api` upstream 写成稳定部署 truth。

## Hostname Constraint

- staging smoke 的 forward hostname truth 已切到 `campus-api-staging.ayafeed.com`、`campus-chat-staging.ayafeed.com`、`campus-panel-staging.ayafeed.com`
- 当前 Cloudflare tier 下，不再依赖 `*.rag.ayafeed.com` 这类深一级 staging custom domain 的 SSL 可用性
- `ayafeed.com` 是共享 zone，generic 一级子域不再视为本 repo 的可依赖部署真相；staging surface 必须带 `campus-` 前缀隔离命名
- 因此本 runbook 中涉及 staging surface 的外部 URL 一律使用 `ayafeed.com` 下一级子域；repo 中残留的 nested hostnames 仅视为待迁移实现残留

## 当前适用场景

适用于以下模式：

- 本地 `uv run --all-packages campus-supervisor-api-dev`
- 本地 Docker `supervisor-api`
- 通过 tunnel 暴露一个临时可达 upstream
- `apps/app-api` deploy 时显式注入 `STAGING_SUPERVISOR_API_BASE_URL`

## 判定标准

当前阶段的 smoke 通过，表示：

- `chat-staging -> app-api-staging -> current supervisor upstream` 真实可用
- browser 真实请求不再卡在 transport failure
- typed execution outcome 可以成功回到 chat surface

它不表示：

- `supervisor-api` 已经稳定部署
- 当前 upstream 可以长期托管 staging
- 当前 chat answer 质量已经达到 release 标准

## Step 1. 启动本地 supervisor-api

使用 `trusted-worker` 模式启动：

```bash
API_AUTH_MODE=trusted-worker \
CAMPUS_AGENT_HTTP_HOST=127.0.0.1 \
CAMPUS_AGENT_HTTP_PORT=8081 \
API_WORKER_SHARED_SECRET=<与 apps/app-api staging secret 相同> \
UV_CACHE_DIR=/tmp/uv-cache \
uv run --all-packages campus-supervisor-api-dev
```

本地预检查：

```bash
curl -sS -i http://127.0.0.1:8081/healthz
curl -sS -i http://127.0.0.1:8081/readyz
```

通过标准：

- `healthz = 200`
- `readyz = 200`

如果当前本地 substrate 没有 `systemd`，优先使用 repo 内的常驻脚本，而不是每次手工开新终端：

```bash
export DEV_BACKED_SUPERVISOR_TUNNEL_NAME=supervisor-api-staging
export DEV_BACKED_SUPERVISOR_PUBLIC_BASE_URL=https://exec-staging.ayafeed.com

infra/local/staging/start-dev-backed-supervisor-staging.sh
infra/local/staging/status-dev-backed-supervisor-staging.sh
```

说明：

- 脚本只读取 `apps/app-api/.dev.vars` 中的 worker bridge secret；shared repo root `.env` 仍由 `campus-supervisor-api-dev` 自身 bootstrap
- `supervisor-api` 以 `trusted-worker` + `127.0.0.1:8081` 方式启动
- `cloudflared` 会运行 `DEV_BACKED_SUPERVISOR_TUNNEL_NAME` 指向的 named tunnel
- pid / log 会写到 `.tmp/dev-backed-supervisor-staging/`
- 如果之前已经手工拉起过同名进程，脚本会优先接管已有 pid，避免重复拉起

停止命令：

```bash
infra/local/staging/stop-dev-backed-supervisor-staging.sh
```

## Step 2. 暴露临时 upstream

任选一种方式：

1. quick tunnel
2. named tunnel
3. 其他当前可控的临时公网入口

如果当前只是为了本轮 smoke，quick tunnel 即可；如果要持续联调，优先换成 named tunnel。

记录本轮使用的 upstream，例如：

```text
https://<current-supervisor-upstream>
```

## Step 3. 重新部署 app-api staging

每次 upstream 变化后，都要重新部署 `app-api-staging`：

```bash
STAGING_SUPERVISOR_API_BASE_URL=https://<current-supervisor-upstream> \
pnpm --dir apps/app-api deploy:staging
```

`deploy:staging` 现在直接使用当前 shell 的 `wrangler` 登录态，不再强绑 repo-local `.wrangler-home`。

当前 Wave B staging baseline 还额外固定了两条运行时事实：

- `app-api-staging` 的 `[env.staging.vars] SUPERVISOR_API_TIMEOUT_MS` 已提升到 `15000`
- telemetry / Sentry 调用必须 fail-open，不能再把 request-path 变成 `500`

如果真实 chat 请求再次出现 `Supervisor execution exceeded 8000ms timeout.`，先检查 staging 变量或 release 是否回退，而不是优先怀疑 `public-chat-web` surface。

然后检查：

```bash
curl --noproxy '*' -sS -i https://campus-api-staging.ayafeed.com/healthz
curl --noproxy '*' -sS -i https://campus-api-staging.ayafeed.com/readyz
```

通过标准：

- `healthz = 200`
- `readyz = 200`

## Step 4. Surface health smoke

确认三个 staging surface 在线：

```bash
curl --noproxy '*' -sS -i https://campus-chat-staging.ayafeed.com/healthz
curl --noproxy '*' -sS -i https://campus-chat-staging.ayafeed.com/readyz
curl --noproxy '*' -sS -i https://campus-panel-staging.ayafeed.com/healthz
curl --noproxy '*' -sS -i https://campus-panel-staging.ayafeed.com/readyz
```

## Step 5. Browser chat smoke

在真实 `campus-chat-staging` 页面执行：

1. 打开 `/login`
2. 使用固定 smoke identity 登录；如果密码漂移或历史数据需要重置，先在 shell 执行：

```bash
APP_API_SMOKE_IDENTITY_PASSWORD='<secret>' \
STAGING_APP_API_MANAGEMENT_DATABASE_URL=postgresql://<staging-management-url> \
pnpm --dir apps/app-api smoke-identity:provision:staging -- --email help_bot@outlook.com --name "Help Bot"
```

3. 不要在浏览器现场创建临时 end-user 账号；当前 repo-tracked staging identity 仍以 `help_bot@outlook.com` 为准
4. 进入 `/chat`（当前默认 donor-derived shell）
5. 发起一条首轮问题
6. 确认首轮成功后 sidebar/history 无需手动 reload 就能看到新会话
7. 直访旧 `/chat/replatform-preview*` 前缀，确认它会 canonicalize 回 `/chat`，而不是被当成 `conversationId`

推荐问题：

- `中央民族大学本科学生国家奖学金评审办法`
- `民族学本科人才培养方案总学分要求是多少？`

通过标准：

- 页面请求 `POST /api/chat/requests` 返回 `200`
- 页面得到 typed outcome，并以显式结果态渲染 `answer` / `clarification` / `no_answer` / `error`
- outcome 可以是 `answer` / `clarification` / `no_answer`
- 不能是 transport error、Worker proxy error、upstream unreachable
- 首轮成功后不允许依赖手动刷新才能在左侧 history 看到新会话

## Step 6. 记录链路证据

至少记录：

- 本轮 `STAGING_SUPERVISOR_API_BASE_URL`
- 本地 `supervisor-api` 启动方式：`dev` 或 `docker`
- 一条真实 `POST /api/chat/requests`
- 当次 `conversationId`
- 当次 `requestId`
- 当次 `traceId`
- 页面显示的最终 typed outcome
- 空态、提交后、结果态、刷新后 history 四张截图

建议落盘：

- `.tmp/staging-smoke/<timestamp>/SUMMARY.md`
- `docs/runbooks/public-chat-staging-smoke-artifact-template.md`

建议摘要字段：

- `supervisor_upstream`
- `supervisor_mode`
- `app_api_version`
- `chat_request_status`
- `typed_outcome`
- `request_id`
- `trace_id`
- `notes`

脱敏约束：

- 不要把 raw `cookie`、`authorization`、密码、session token 写进 `SUMMARY.md`
- 不要把原始 request/response body 粘进产物；只记录状态码、`conversationId`、`requestId`、`traceId`、页面截图和简短说明

## Step 7. panel / observability smoke

如果当轮已经具备可用的 Access smoke 身份，再继续做：

- `panel-staging` 登录 smoke
- `operator.request_projection` list/detail smoke
- `Sentry` trace smoke
- `Axiom` runtime event smoke
- 进入 `Requests` lane 之前，先确认当前 Access operator email 已包含在 `app-api-staging` 的 `APP_API_OPERATOR_EMAIL_ALLOWLIST` 中；当前 staging smoke 身份是 `help_bot@outlook.com`
- panel `Requests` / `official-web` 相关 `/api/operator/*` 如果返回 `401/403`，必须先看 `error.code`
- `session_required`、`session_expired`、`unauthorized` 或 Cloudflare Access plain-text `401` 才能判定为 session / Access 失效
- `operator_identity_not_admitted`、`forbidden`、`internal_auth_required`、`dependency_not_ready` 必须标记为 operator admission / bridge config / runtime issue，不能直接解释成 Access 失效并触发 logout 结论
- 如果直接访问 `https://campus-panel-staging.ayafeed.com/` 返回的是 Cloudflare Access `302` 登录页，则说明真实 Access 已在前面；这时若还无法继续 smoke，正确标签应是 `blocked by smoke identity/credential`
- 只有当 direct access 再次退化成 worker 返回的 `Missing Access JWT.` 时，才应标记为 `blocked by missing Access provisioning`

如果 Access smoke 身份仍未准备好：

- 可以先做 chat execution smoke
- 但不得把 staging smoke 标记为完整关闭
- `campus-panel-staging` / observability lane 应明确记录为 `blocked by smoke identity/credential`
