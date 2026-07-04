---
doc_type: runbook
truth_scope: ops
owner_boundary: docs/runbooks
status: active
created: 2026-03-31
updated: 2026-06-09
---
# Worker Observability Smoke Runbook

## 文档边界

这份 runbook 只记录当前 forward Worker surfaces 的 observability preflight 与 smoke 闭环：

- `apps/app-api`
- `apps/campus-web`
- `apps/operator-console-web`

它回答的是：

- 本地如何确认 observability env 已经准备好
- deploy 后如何验证 `Sentry` / `Axiom` 真实收到了事件
- 当前 smoke 需要产出哪些 closeout artifacts

它不替代：

- env ownership：`docs/environment/README.md`
- surface runtime smoke：`docs/runbooks/forward-worker-smoke.md`
- observability
  设计边界：`docs/decisions/adr-0010-observability-and-telemetry-stack.md`

## 闭环模型

这条 runbook 明确分成两个阶段：

1. `Pre-Deploy Readiness`
1. `Post-Deploy Verification`

判定标准不是“代码里已经接了 Sentry/Axiom”，而是：

1. 在未部署前，本地 env/preflight 与 Worker smoke 可以重复通过
1. 在首次真实部署后，真实 Worker surface、真实 release 和真实 sink 都能留下可追溯
   closeout artifact

`Pre-Deploy Readiness` 可以在真实部署前重复执行；`Post-Deploy Verification` 只在真实部署环境存在后执行。

## Pre-Deploy Readiness

### 1. 本地 Preflight

先检查 root `.env` 与 app-local `.dev.vars` 是否已经对齐：

```bash
env UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m \
  scripts.check_worker_observability_env --json
```

通过标准：

- `overall_ready = true`
- `apps/app-api/.dev.vars` 已包含 `SENTRY_DSN`、`SENTRY_ENVIRONMENT`、`SENTRY_RELEASE
  `、`APP_API_OTEL_INGEST_ENDPOINT`、`APP_API_OTEL_INGEST_SHARED_SECRET`
- `apps/campus-web/.dev.vars` 与
  `apps/operator-console-web/.dev.vars` 已包含 `SENTRY_DSN`、`SENTRY_ENVIRONMENT`、
  `SENTRY_RELEASE`
- root `.env` 使用共享 `SENTRY_DSN`，不是 per-surface `SENTRY_DSN_*`

如果未通过，可先执行：

```bash
env UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m \
  scripts.sync_worker_observability_env
```

然后再次运行 preflight。

### 2. 本地 Worker Smoke

先确认 runtime smoke 仍然正常：

```bash
pnpm --dir apps/app-api test:worker -- --reporter=verbose
pnpm --dir apps/campus-web test:worker -- --reporter=verbose
pnpm --dir apps/operator-console-web test:worker -- --reporter=verbose -t \
  "smokes request queries through operator-console-web into app-api with \
  internal caller admission"
```

这一步只证明 Worker shell、proxy seam、internal bridge 和 `no-store` 行为正常；它不证明第三方 sink
已收到事件。

### 3. Pre-Deploy Closeout Inputs

建议在每轮 readiness 复核后保留：

- 执行日期
- 执行 worktree / branch
- `check_worker_observability_env` 输出摘要
- 三个 Worker smoke 的通过摘要

推荐落盘位置：

- `.tmp/observability-smoke/<timestamp>-<environment>-<release>/`

建议同时保留以下 closeout files：

- `SUMMARY.md`
- `chat-trace.md`
- `panel-trace.md`
- `app-api-runtime-event.md`

## Deployment Handoff Inputs

只有在真实部署环境已存在时，才进入下一节。执行 `Post-Deploy Verification` 前，至少应具备：

- 目标环境名，例如 `staging` 或 `prod`
- 真实 `campus-web`、`operator-console-web`、`app-api` hostname
- 当次 Worker release 标识
- deploy secret store 中的 `SENTRY_*` / Collector `OTEL_COLLECTOR_AXIOM_*` 已下发确认
- repo-local `SENTRY_API_TOKEN` 或等价 Sentry UI access，以及可访问 `Axiom` dataset 的操作权限
- 执行 smoke 的身份与凭证来源

说明：

- `wrangler` 远程检查可以作为辅助手段，但不是唯一 gate
- 真正的 closure 以真实请求、真实 trace 和真实 runtime event 是否进入 sink 为准
- release identity 默认由三端 deploy 脚本按 `<app>@staging-<sha>` 自动生成；artifact 目录必须复用同一
  release 标识，不要另起名
- Worker 不再配置 `AXIOM_TOKEN`；Axiom exporter credential 属于 Collector
  deployment secret
- `SENTRY_DSN` 只证明 deploy-side sink 配置存在；真正的 sink-side verification 仍需要 Sentry
  UI 或 repo-local `SENTRY_API_TOKEN`
- `SENTRY_API_TOKEN` 是 repo-local lookup credential，不应 fan out 到任何 Worker
  `.dev.vars` 或 deploy secret store
- 建议先执行：

```bash
env UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m \
  scripts.check_sentry_lookup_access --json
```

确认 token 至少能读取目标 org / project，再进入 trace / event closeout artifact 留存

- 如果 `organizations/.../issues` 这类 issue/event list endpoint 返回 `403 You do not
  have permission to perform this action.`，不要把它误判成 staging observability
  blocker。当前 repo 的默认 closure 路径是直接查询 Sentry Explore `spans`：

```bash
env UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m \
  scripts.query_sentry_spans
  --org-slug <org-slug> \
  --project <surface-project-id-or-slug> \
  --project <app-api-project-id-or-slug> \
  --environment staging \
  --stats-period 30d \
  --query 'trace:<sentry-trace-id> span.op:http.server' \
  --markdown-output .tmp/observability-smoke/<timestamp>/trace-query.md
```

这条脚本复用 repo-local `SENTRY_API_TOKEN`，不需要把更高权限 scope 下发到 Worker secret store

- 建议先填完 handoff 与 closeout artifact 字段，再执行真实环境 smoke

## Post-Deploy Verification

### 1. `campus-web -> app-api`

执行一条最小 chat 请求，保留：

- 请求时间
- `x-trace-id`
- surface 名称
- HTTP 状态码

预期：

- `campus-web` 与 `app-api` 都能在 `Sentry` 中看到同一条 trace 上的相邻事件
- `app-api` 事件标签至少包含 `surface=app_api`
- `campus-web` 事件标签至少包含 `surface=campus-web`
- 四个 Worker 默认共享同一个 Sentry project；通过 `environment` 与 `surface` 过滤事件

### 2. `operator-console-web -> app-api`

执行一条最小 operator 读请求，例如：

- `GET /api/overview`
- 或 `GET /api/requests`
- 或 `GET /api/official-web/sites`

预期：

- `operator-console-web` 与 `app-api` 的 trace 继续贯通
- `operator-console-web` 事件标签至少包含 `surface=operator-console-web`
- `app-api` 不把 panel 请求降级成 telemetry truth source

### 3. `app-api` 受控错误路径（可选）

只在明确需要 exception closeout artifact 时再走这条路径。

注意：

- 当前 `apps/app-api` 只会把非 `AppApiRouteError` 的未处理异常送入
  `telemetry.captureException(...)`
- 缺失必须字段、`validation_failed`、`401/403/404/422` 这类 route error 会直接变成
  `routeErrorResponse(...)`，不能作为 `Sentry` exception closeout artifact
- 如果当前没有显式的 non-`AppApiRouteError` probe，优先使用前两节的 trace-linked `spans`
  closeout artifact 完成 closure

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

## Closeout Artifact Requirements

每次 smoke 至少保留：

- 执行日期
- 目标环境
- Worker release 标识
- 使用的 dataset 名称
- `campus-web -> app-api` trace 说明
- `operator-console-web -> app-api` trace 说明
- `app-api` runtime event 说明
- 失败时的 `x-trace-id`

建议存放位置：

- `.tmp/observability-smoke/<timestamp>-<environment>-<release>/`

最小文件集合：

- `SUMMARY.md`
- `chat-trace.md`
- `panel-trace.md`
- `app-api-runtime-event.md`

### `SUMMARY.md` 骨架

```md
# Worker Observability Smoke Summary

- Timestamp:
- Scope: `pre-deploy-readiness` | `post-deploy-verification`
- Status: `ready` | `pending` | `failed`
- Branch / commit:
- Operator:
- Environment:
- Worker release:
- Sentry access confirmed:
- Axiom access confirmed:
- Pre-deploy readiness:
- Post-deploy verification:
- Trace IDs:
- Next unblocker:
```

### Trace 骨架

`chat-trace.md` 记录 request path、HTTP status、`x-trace-id`，以及
`campus-web` / `app-api` 是否在同一 trace 被观察到。

`panel-trace.md` 记录 request path、HTTP status、`x-trace-id`、operator identity
summary、Access envelope state，以及 `operator-console-web` / `app-api` 是否在同一
trace 被观察到。

`app-api-runtime-event.md` 记录 event type、trigger、Axiom query/filter、dataset、
Worker release、processed / failed count，并显式确认 raw prompt、raw answer、auth
header 与 transcript 均未出现。

## 判定规则

- `Pre-Deploy Readiness` 关闭条件： root `.env` 与 app-local `.dev.vars` 对齐，且三个 Worker
  surface 的本地 smoke 全部通过
- `Post-Deploy Verification` 触发条件： 已存在至少一个真实部署环境，并具备本 runbook 的 deployment
  handoff inputs
- `Post-Deploy Verification` 关闭条件：
  `campus-web`、`operator-console-web`、`app-api` 三端至少各完成一轮真实 smoke，`Axiom` 收到
  `projection.drain` 或等价 runtime event，并且 `Sentry` 至少保留一条 trace-linked 或
  controlled-error event closeout artifact
- 在没有真实部署环境时，这条 follow-up 的正确状态是 `post-deploy verification pending`，不是“本地工程阻塞”
