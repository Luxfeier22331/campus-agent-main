---
doc_type: runbook
status: active
created: 2026-03-31
updated: 2026-04-08
---

# Worker Observability Smoke Runbook

## 文档边界

这份 runbook 只记录当前 forward Worker surfaces 的 observability preflight 与 smoke 闭环：

- `apps/app-api`
- `apps/public-chat-web`
- `apps/protected-panel-web`

它回答的是：

- 本地如何确认 observability env 已经准备好
- deploy 后如何验证 `Sentry` / `Axiom` 真实收到了事件
- 当前 smoke 需要保留哪些证据

它不替代：

- env ownership：`docs/environment/README.md`
- surface runtime smoke：`docs/runbooks/forward-worker-surface-smoke-runbook.md`
- observability 设计边界：`docs/decisions/adr-0010-observability-and-telemetry-stack.md`

## 闭环模型

这条 runbook 现在明确分成两个阶段：

1. `Pre-Deploy Readiness`
2. `Post-Deploy Verification`

判定标准不是“代码里已经接了 Sentry/Axiom”，而是：

1. 在未部署前，本地 env/preflight 与 Worker smoke 可以重复通过
2. 在首次真实部署后，真实 Worker surface、真实 release 和真实 sink 都能留下可追溯证据

截至 2026-04-02，当前 root worktree 已再次完成 `Pre-Deploy Readiness` 复核，并新增 repo-tracked artifact template：`docs/runbooks/worker-observability-smoke-artifact-template.md`；`Post-Deploy Verification` 仍只在真实部署环境存在后执行。

## Pre-Deploy Readiness

### 1. 本地 Preflight

先检查 root `.env` 与 app-local `.dev.vars` 是否已经对齐：

```bash
env UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m scripts.check_worker_observability_env --json
```

通过标准：

- `overall_ready = true`
- `apps/app-api/.dev.vars` 已包含 `SENTRY_DSN`、`SENTRY_ENVIRONMENT`、`SENTRY_RELEASE`、`AXIOM_ENDPOINT`、`AXIOM_DATASET`、`AXIOM_TOKEN`
- `apps/public-chat-web/.dev.vars` 与 `apps/protected-panel-web/.dev.vars` 已包含各自 `SENTRY_*`

如果未通过，可先执行：

```bash
env UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m scripts.sync_worker_observability_env
```

然后再次运行 preflight。

### 2. 本地 Worker Smoke

先确认 runtime smoke 仍然正常：

```bash
pnpm --dir apps/app-api test:worker -- --reporter=verbose
pnpm --dir apps/public-chat-web test:worker -- --reporter=verbose -t "smokes a chat request through public-chat-web into app-api"
pnpm --dir apps/protected-panel-web test:worker -- --reporter=verbose -t "smokes request queries through protected-panel-web into app-api with internal caller admission"
```

这一步只证明 Worker shell、proxy seam、internal bridge 和 `no-store` 行为正常；它不证明第三方 sink 已收到事件。

### 3. Pre-Deploy 证据

建议在每轮 readiness 复核后保留：

- 执行日期
- 当前 worktree / branch
- `check_worker_observability_env` 输出摘要
- 三个 Worker smoke 的通过摘要

当前推荐落盘位置：

- `.tmp/observability-smoke/<timestamp>/`

建议直接从模板起手：

- `docs/runbooks/worker-observability-smoke-artifact-template.md`

## Deployment Handoff Inputs

只有在真实部署环境已存在时，才进入下一节。执行 `Post-Deploy Verification` 前，至少应具备：

- 目标环境名，例如 `staging` 或 `prod`
- 真实 `public-chat-web`、`protected-panel-web`、`app-api` hostname
- 当次 Worker release 标识
- deploy secret store 中的 `SENTRY_*` / `AXIOM_*` 已下发确认
- repo-local `SENTRY_API_TOKEN` 或等价 Sentry UI access，以及可访问 `Axiom` dataset 的操作权限
- 执行 smoke 的身份与凭证来源

说明：

- `wrangler` 远程检查可以作为辅助手段，但不是唯一 gate
- 真正的 closure 以真实请求、真实 trace 和真实 runtime event 是否进入 sink 为准
- `AXIOM_TOKEN` 可以只是 deploy-side ingest token；如果 query API 返回 `403 token does not have required permissions`，应改用独立的 read/query token。当前 repo root worktree 用 `AXIOM_SMOKE` 完成 query closure
- `SENTRY_DSN` 只证明 deploy-side sink 配置存在；真正的 sink-side verification 仍需要 Sentry UI 或 repo-local `SENTRY_API_TOKEN`
- `SENTRY_API_TOKEN` 是 repo-local lookup credential，不应 fan out 到任何 Worker `.dev.vars` 或 deploy secret store
- 建议先执行：

```bash
env UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m scripts.check_sentry_lookup_access --json
```

  确认 token 至少能读取目标 org / project，再进入 trace / event 证据留存
- 建议先用 `docs/runbooks/worker-observability-smoke-artifact-template.md` 填完 handoff 与 evidence 字段，再执行真实环境 smoke

## Post-Deploy Verification

### 1. `public-chat-web -> app-api`

执行一条最小 chat 请求，保留：

- 请求时间
- `x-trace-id`
- surface 名称
- HTTP 状态码

预期：

- `public-chat-web` 与 `app-api` 都能在 `Sentry` 中看到同一条 trace 上的相邻事件
- `app-api` 事件标签至少包含 `surface=app_api`
- `public-chat-web` 事件标签至少包含 `surface=public-chat-web`

### 2. `protected-panel-web -> app-api`

执行一条最小 operator 读请求，例如：

- `GET /api/overview`
- 或 `GET /api/requests`
- 或 `GET /api/official-web/sites`

预期：

- `protected-panel-web` 与 `app-api` 的 trace 继续贯通
- `protected-panel-web` 事件标签至少包含 `surface=protected-panel-web`
- `app-api` 不把 panel 请求降级成 telemetry truth source

### 3. `app-api` 受控错误路径

触发一个可控错误，例如：

- 缺失必须字段的 `POST /api/chat/requests`
- 或一条明确的 route validation failure

预期：

- `app-api` 在 `Sentry` 中记录异常或错误事件
- 事件里不应出现 raw `cookie`、`authorization`、`prompt`、`answer`

### 4. `app-api` scheduled / projection drain

触发一次 `scheduled` drain 或等待下一次调度，确认 `Axiom` 中出现最小 runtime event。

预期事件：

- `event_type=projection.drain`
- `surface=app_api` 或 `surface=official_web`
- `processed_count`
- `failed_count`

不应出现：

- raw prompt
- raw answer
- raw auth header
- raw transcript

## 证据要求

每次 smoke 至少保留：

- 执行日期
- 目标环境
- Worker release 标识
- 使用的 dataset 名称
- 至少一个 `Sentry` trace 链路截图或事件链接
- 至少一个 `Axiom` 查询结果截图或事件字段摘要
- 失败时的 `x-trace-id`

建议存放位置：

- `.tmp/observability-smoke/<timestamp>/`

建议文件：

- `SUMMARY.md`
- `sentry-trace-notes.md`
- `axiom-runtime-events.md`

建议直接复制的骨架：

- `docs/runbooks/worker-observability-smoke-artifact-template.md`

## 当前判定规则

- `Pre-Deploy Readiness` 关闭条件：
  root `.env` 与 app-local `.dev.vars` 对齐，且三个 Worker surface 的本地 smoke 全部通过
- `Post-Deploy Verification` 触发条件：
  已存在至少一个真实部署环境，并具备本 runbook 的 deployment handoff inputs
- `Post-Deploy Verification` 关闭条件：
  `public-chat-web`、`protected-panel-web`、`app-api` 三端至少各完成一轮真实 smoke，`Axiom` 收到 `projection.drain` 或等价 runtime event，并且 `Sentry` 至少保留一条 trace-linked 或 controlled-error event evidence
- 在没有真实部署环境时，这条 follow-up 的正确状态是 `post-deploy verification pending`，不是“本地工程阻塞”

## 2026-04-06 Staging Checkpoint

当前 staging 的真实 checkpoint 已经前进到：

- `public-chat-web -> app-api`: closed。真实请求 `req_3f493161ae6c4c669304c4ca439dfe4a` / `trace_f3d3792b021f4118ac90a06041f9b03f` 已返回 `answer`
- `app-api` scheduled / projection drain: closed。`Axiom` 已查到最新 `event_type=projection.drain`、`projector_name=request_projection`、`surface=app_api`、`processed_count=2`、`failed_count=0`
- `protected-panel-web -> app-api`: closed。`.tmp/staging-smoke/20260406T115658-panel-requests-fix/SUMMARY.md` 已确认 `help_bot@outlook.com` 完成 Cloudflare Access 登录，`GET /api/overview`、`GET /api/requests?limit=20`、`GET /api/requests/:id`、`GET /api/requests/:id/observability` 全部返回 `200`
- `Sentry` sink-side verification: lookup ready, event evidence pending。repo-local `SENTRY_API_TOKEN` 已可读取 org `linear27` 及 `campus-agent-api` / `campus-agent-chat` / `campus-agent-panel` 三个项目，但这轮 artifact 仍未追加 event-level trace / controlled-error 证据

当前 checkpoint artifact：

- `.tmp/staging-smoke/20260406T032941-wave-b-closure/`
- `.tmp/staging-smoke/20260406T115658-panel-requests-fix/`
- `.tmp/observability-smoke/20260406T032941-staging-wave-b/`
