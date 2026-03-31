---
doc_type: runbook
status: active
created: 2026-03-31
updated: 2026-03-31
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

## 当前目标

当前 closure 标准不是“代码里已经接了 Sentry/Axiom”，而是以下三件事同时成立：

1. root worktree `.env` 与 app-local `.dev.vars` 已经对齐
2. 三个 Worker surface 的请求链路确实把 trace 继续向下游透传
3. `Sentry` 与 `Axiom` 能看到最小 smoke 事件，而不是只停留在 fail-open 配置状态

## 本地 Preflight

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

## 本地 Worker Smoke

先确认 runtime smoke 仍然正常：

```bash
pnpm --dir apps/app-api test:worker -- --reporter=verbose
pnpm --dir apps/public-chat-web test:worker -- --reporter=verbose -t "smokes a chat request through public-chat-web into app-api"
pnpm --dir apps/protected-panel-web test:worker -- --reporter=verbose -t "smokes request queries through protected-panel-web into app-api with internal caller admission"
```

这一步只证明 Worker shell、proxy seam、internal bridge 和 `no-store` 行为正常；它不证明第三方 sink 已收到事件。

## Deploy-Side Smoke

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

## 当前判定规则

- local env 已配齐，不等于 deploy smoke 已关闭
- deploy secret store 已配置，不等于 trace / event 已真正进入 sink
- 只有当 `public-chat-web`、`protected-panel-web`、`app-api` 三端至少各完成一轮真实 smoke，并且 `Axiom` 收到 `projection.drain` 或等价 runtime event，才可把这条 follow-up 视为关闭
