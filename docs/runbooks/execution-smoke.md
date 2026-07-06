---
doc_type: runbook
truth_scope: ops
owner_boundary: docs/runbooks
status: active
created: 2026-04-24
updated: 2026-05-01
---
# Execution Control Staging Smoke Runbook

## 文档边界

这份 runbook 只覆盖当前 canonical staging smoke：

- `campus-web`
- `app-api`
- `execution-control` 由 repo-owned staging runtime 承接，但只作为 app-api-only
  trusted machine upstream

它回答的是：

- 如何把 `campus-staging -> app-api-staging -> execution-control trusted machine upstream`
  跑通
- 每轮 smoke 最少要验证哪些链路
- 什么时候需要重新 deploy `app-api-staging`

它不保留 legacy dev-backed upstream；当前 staging smoke 只以 Go `apps/execution-control`
execution origin 为准。

## 当前补充真相

- `apps/execution-control` smoke 只要求真实可达的 Go execution origin；Docker Compose
  是 local / transitional evidence，不再作为冻结的 forward deploy truth
- 当前 repo-owned staging execution runtime 在 `nc-arm-6c` 上运行：
  - `otel-collector`
  - `execution-control`
  - `workflow-worker`
  - `activity-worker-core`
  - `agent-runtime`
  - `activity-worker-agent`
  - `activity-worker-knowledge`
  - Temporal
- `worker-autoscaler`、`temporal-task-queue-sampler`、`temporal-ui` 与
  self-hosted Langfuse stack 不属于默认 smoke runtime。它们只在 ops validation、
  UI 排障或 eval/trace UI 会话中显式 opt-in。模型可见工具由 `tools.v4` 与
  execution-control runtime profile 控制，不再通过额外 worker 进程打开。
- `execution-control` 不作为 public staging surface；machine ingress 固定为
  `https://execution-control-staging.mucwiki-edge.link`
- `app-api-staging` 必须配置 execution-control Access service-token credentials 与
  `x-worker-origin-auth` shared secret；缺任一都 fail closed
- 只有当 trusted machine upstream URL 或 Access service-token credential 变化时，才需要重新
  deploy `app-api`

## 判定标准

这条 smoke 通过，表示：

- `campus-staging -> app-api-staging -> current execution-control upstream` 真实可用
- browser 真实请求不再卡在 transport failure
- typed execution outcome 可以成功回到 chat surface

它不表示：

- 当前 chat answer 质量已经达到 release 标准
- production execution substrate 已经启用

## Step 1. 确认 canonical execution-control staging runtime

在 `nc-arm-6c` 对应 K8s cluster 使用 GitOps/Kubernetes 原生状态作为 runtime
readiness 证据：

```bash
argocd app wait execution-runtime-staging --health --sync
kubectl -n campus-agent-staging rollout status deploy/execution-control
kubectl -n campus-agent-staging rollout status deploy/agent-runtime
kubectl -n campus-agent-staging rollout status deploy/workflow-worker
kubectl -n campus-agent-staging rollout status deploy/activity-worker-core
kubectl -n campus-agent-staging rollout status deploy/activity-worker-agent
kubectl -n campus-agent-staging rollout status deploy/activity-worker-knowledge
kubectl -n campus-agent-staging get pods,svc,ingress
```

最小通过标准：

- `execution-runtime-staging` 为 Synced/Healthy
- first-party runtime Deployments rollout 成功
- `kubectl get pods` 不包含 CrashLoopBackOff、ImagePullBackOff 或 Pending
- Temporal、Hindsight、Qdrant、OTel、Postgres 由对应 platform/data Application
  提供，不通过 execution-runtime overlay 或 host-bridge 补齐

如果需要重装 machine ingress reverse proxy 或 Cloudflare Access policy，按
`execution-ops.md` 的 `配置 machine ingress reverse proxy` 执行。

## Step 2. 判断是否需要重新 deploy app-api staging

如果 `STAGING_EXECUTION_CONTROL_BASE_URL`、Cloudflare Access service-token credential、
`EXECUTION_CONTROL_SHARED_SECRET` 或 app-api Worker secret 发生变化，必须重新 deploy
`app-api-staging`。

```bash
base_url=https://execution-control-staging.mucwiki-edge.link
env \
  STAGING_EXECUTION_CONTROL_BASE_URL="$base_url" \
  STAGING_EXECUTION_CONTROL_ACCESS_CLIENT_ID=<client-id> \
  STAGING_EXECUTION_CONTROL_ACCESS_CLIENT_SECRET=<client-secret> \
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

## Step 3. Product surface health smoke

确认 staging product surfaces 在线：

```bash
curl --noproxy '*' -sS -i https://api-staging.mucwiki-edge.link/healthz
curl --noproxy '*' -sS -i https://api-staging.mucwiki-edge.link/readyz
curl --noproxy '*' -sS -i https://campus-staging.mucwiki-edge.link/healthz
curl --noproxy '*' -sS -i https://campus-staging.mucwiki-edge.link/readyz
curl --noproxy '*' -sS -i https://panel-staging.mucwiki-edge.link/healthz
curl --noproxy '*' -sS -i https://panel-staging.mucwiki-edge.link/readyz
```

通过标准：

- product surface health / ready endpoints 返回预期 `200`
- `api-staging /readyz` 中 `executionControl` 与 `executionRuntime` 为 `ready`
- 不直接把 execution-control machine ingress 作为 public surface smoke endpoint

## Step 4. Authenticated Chat Smoke

优先使用 repo-owned staging profile automation：

```bash
pnpm --dir apps/app-api chat:e2e:staging
```

staging release gate 使用 durable submit + run-event resume contract。通用
`apps/app-api/scripts/chat-e2e.ts --profile staging` 仍可用于显式诊断，但不作为
release gate。

`chat:e2e:staging` 与 `docs:gated:smoke:staging` 都通过
`apps/app-api/scripts/run-with-staging-smoke-env.mjs` 加载 staging smoke env。
该 runner 会使用 repo-local `.tmp/staging-smoke.lock` 串行化命令，避免两个
smoke 同时重建同一个固定 identity 导致 session mint 竞争。不要绕过 runner
并行执行会重置 `help_bot@outlook.com` 的 staging smoke 脚本。

这条命令会：

1. 先检查 `app-api-staging` 与 `campus-staging` 的 `readyz`
1. 若 readyz 阻塞，输出结构化 `blocked_by`，且不重置 smoke identity、不发起
   chat request
1. 用固定 smoke identity `help_bot@outlook.com` 重建 staging 账号并清理旧聊天数据
1. 通过部署态 `app-api-staging`
   `POST /api/internal/staging-smoke/auth/session` 铸造真实 staging session cookie
1. 带着拿到的 session cookie 真实请求
   `https://campus-staging.mucwiki-edge.link/api/chat/requests/stream`，读取
   `request.accepted` 与 durable `runId`
1. 订阅 `/api/chat/runs/:runId/events/stream`，直到 `request.completed`
1. 再检查 run status、steps、Langfuse closeout 身份与 conversation detail，确认
   Temporal workflow、run projection、app-api finalization 和会话落盘完成

它要求当前 shell 有：

- `APP_API_STAGING_SMOKE_AUTH_SECRET` 或 `STAGING_APP_API_SMOKE_AUTH_SECRET`

它不要求：

- 预先提供 `APP_API_SMOKE_IDENTITY_PASSWORD`
- agent 在真实浏览器里通过 Turnstile challenge

如果需要追加人工 UI 验证，可在 automation 通过后再手工打开 `campus-staging` 的
`/chat` 做 donor-shell 浏览器观察，但这不是 agent automation 的前置。

推荐问题：

- `示例大学本科学生国家奖学金评审办法`
- `民族学本科人才培养方案总学分要求是多少？`

通过标准：

- `chat:e2e:staging` 返回 `0`
- 它输出 `passed=true`
- 它输出 `submitStreamAbortedAfterAccepted=true`
- `resume.terminalEvent.event=request.completed`
- `run.status=completed`
- `conversation.hasAssistantMessageForRequest=true`
- 不能出现 transport error、Worker proxy error、upstream unreachable

只有在明确做通用 chat runner 诊断时，才允许显式运行
`pnpm --dir apps/app-api chat:e2e -- --profile staging` 或追加同步 transport 参数。
同步 transport 不作为 staging closeout gate；不要用
`--expect-result-kind any` 替代真实通过标准。

profile memory 与 online memory recall 专项 smoke：

```bash
pnpm --dir apps/app-api chat:memory:e2e:staging
```

这条命令会通过同一个 fixed smoke identity 写入一条显式 profile memory，
再通过 stream chat 创建 durable run，并读取
`/api/chat/runs/:runId/steps` 的 sanitized trajectory。通过标准是
`passed=true`、`memory.deleted=true`、`recall.stepId=memory.recall`、
`recall.status=completed` 且 `recall.selectedMemoryCount > 0`。它不以自然语言
回答是否提到记忆作为验收依据。

Hindsight personal memory runtime gate 通过 staging smoke runner 调用
execution-control internal memory commands，覆盖 append accepted、operation
status/list、recall、reflect based_on facts、profile upsert / disable、owner
disable / RTBF 与 user isolation：

```bash
pnpm --dir apps/app-api hindsight:memory:e2e:staging
```

该 lane 需要当前 shell 提供：

- `EXECUTION_CONTROL_BASE_URL` 或 `STAGING_EXECUTION_CONTROL_BASE_URL`
- `API_WORKER_SHARED_SECRET` 或 `EXECUTION_CONTROL_SHARED_SECRET`

通过标准：

- completed turn append 返回 accepted，并能通过 operation status 或后续 recall /
  reflect 证明 materialization
- cross-thread recall、observation recall type 与 reflect based_on facts 都返回
  sanitized projection
- explicit profile memory upsert / disable、operation list、owner disable /
  RTBF 与 user isolation 都完成
- 只记录 schema、status、hash 与字段级 token
- 不保存 raw transcript、provider raw response、Hindsight raw payload 或 API key
- 不用 `not_collected`、离线 fixture 或退休 Python eval gate 冒充 live smoke

公开官网搜索 typed tool 的 readiness smoke 通过 staging smoke runner 直连
execution-control internal query endpoint：

```bash
(
  cd apps/app-api &&
  node ./scripts/run-with-staging-smoke-env.mjs \
    pnpm exec tsx ./scripts/public-web-search-smoke-staging.ts
)
```

这条命令只证明 `public_web_search` provider profile、machine ingress、
`x-execution-query-auth` 与 sanitized source projection 可用。通过标准是
`passed=true`，每个 sample 都返回 `resultKind=public_web_evidence`，且所有
source URL 都是 HTTPS `muc.edu.cn` 或其公开子域，不包含 `my.muc.edu.cn`、
显式端口、外部域名、raw provider response、raw HTML 或 source body。它不是
RAGAS 评分，也不替代主链路 chat smoke。

公开官网搜索 agent eval 必须走 app-api chat stream，而不是直连 tool endpoint：

```bash
pnpm --dir packages/eval-langfuse langfuse run-public-web-search-agent-eval \
  --app-api-base-url https://campus-staging.mucwiki-edge.link \
  --provider perplexity_compatible \
  --provider-profile-id provider_profile_public_web_search \
  --provider-model sonar-compatible \
  --staging-smoke-auth-secret "$APP_API_STAGING_SMOKE_AUTH_SECRET"
```

provider bakeoff 每次只评估一个已配置的 `public_web_search` active profile；
`--provider` 只能是 `perplexity`、`perplexity_compatible`、`openai`、`gemini`
或 `linux_do`。Linux.do 搜索 profile 必须是
`transport=openai_chat_completions_web_search`，不要复用 prompt
`chat_completions` profile。输出必须记录 provider、transport、model、profile
id、latency、provider error count 与 source-policy scores。没有已接受单价时，
成本字段保持 `cost_projection_status=unavailable`，不得写成 0。

默认是 dry-run，只输出确定性 score artifact。需要写入 Langfuse 时显式加
`--publish-scores`，并确保 `LANGFUSE_BASE_URL`、`LANGFUSE_PUBLIC_KEY`、
`LANGFUSE_SECRET_KEY` 和 `LANGFUSE_ENVIRONMENT` 已配置。

## Step 5. 记录链路 closeout artifact

至少记录：

- `argocd app get execution-runtime-staging`
- `kubectl -n campus-agent-staging get pods,svc,ingress`
- `https://api-staging.mucwiki-edge.link/readyz`
- `pnpm --dir apps/app-api chat:e2e:staging` 的 JSON 摘要
- `pnpm --dir apps/app-api public-web-search:smoke:staging` 的 JSON 摘要（仅当本轮改动触及
  `public_web_search` tool/provider/config）
- `pnpm --dir packages/eval-langfuse langfuse run-public-web-search-agent-eval ...`
  的 JSON 摘要（仅当本轮改动触及 public web search agent/tool routing/source projection）
- 当前 app-api Worker 配置的
  `STAGING_EXECUTION_CONTROL_BASE_URL=https://execution-control-staging.mucwiki-edge.link`
  与 Access service-token secret presence

## Rollback

如果 smoke 失败且无法快速恢复：

1. 保持 execution upstream 指向 canonical staging runtime，并修复 canonical runtime 或
   `app-api-staging` 配置后重新执行 smoke
1. 对 first-party runtime 使用 `argocd app rollback execution-runtime-staging <revision>`
1. 对 platform/data regression 回滚对应 Argo CD Application，并记录依赖名
