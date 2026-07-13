---
doc_type: runbook
truth_scope: ops
owner_boundary: docs/runbooks
status: active
created: 2026-04-24
updated: 2026-07-11
---
# Execution Control Staging Smoke Runbook

## 文档边界

这份 runbook 只覆盖当前 canonical staging smoke：

- `campus-web`
- `app-api`
- `execution-control` 由 repo-owned staging runtime 承接，但只作为 app-api-only
  trusted machine upstream

它回答的是：

- 如何把 `campus-staging -> app-api-staging -> execution-control private service`
  跑通
- 每轮 smoke 最少要验证哪些链路
- 什么时候需要重新 deploy `app-api-staging`

当前 staging smoke 只以 Go `apps/execution-control` execution origin 为准。

## 当前补充真相

- `apps/execution-control` smoke 只要求真实可达的 Go execution origin；Docker Compose
  只用于 local diagnostics，不作为 forward deploy truth
- 当前 staging execution runtime 在部署环境的 Kubernetes 集群运行：
  - `otel-collector`
  - `execution-control`
  - `workflow-worker`
  - `activity-worker-core`
  - `agent-runtime`
  - `activity-worker-agent`
  - Temporal
- `worker-autoscaler` 和 `temporal-task-queue-sampler` 已删除，不得作为 smoke opt-in。
  Temporal UI 与 self-hosted Langfuse 属于各自平台排障/评测面，不属于默认 smoke runtime。
  模型可见工具由 `tools.v4` 和 execution-control runtime config 控制。
- `execution-control` 不作为 public staging surface；`app-api-staging` 通过
  Cloudflare Worker VPC Service binding 访问 K8s 内的 ClusterIP Service
- `cloudflared-execution-control` connector 在 staging K8s 内运行，使用
  SealedSecret 投递 tunnel token
- `app-api-staging` runtime 必须已经通过 Cloudflare Worker secret store 配置
  `EXECUTION_CONTROL_SHARED_SECRET`；缺失时 fail closed
- GitHub staging deploy 不注入 execution-control public URL。Worker VPC Service
  binding 和 `EXECUTION_CONTROL_PRIVATE_ORIGIN` 由 `apps/app-api/wrangler.toml`
  承载。
- 只有当 private Service binding、private origin 或 app-api Worker runtime secret
  变化时，才需要重新 deploy 或重新配置 `app-api`

## 判定标准

这条 smoke 通过，表示：

- `campus-staging -> app-api-staging -> current execution-control upstream` 真实可用
- browser 真实请求不再卡在 transport failure
- finalized answer 与 sources 可以成功回到 chat surface

它不表示：

- 当前 chat answer 质量已经达到 release 标准
- production execution substrate 已经启用

## Step 1. 确认 canonical execution-control staging runtime

先按私有环境仓的 runbook 采集 GitOps/Kubernetes runtime readiness 证据。本源仓
不记录 Application 名称、namespace 或集群命令。

最小通过标准：

- 环境仓 revision 与 Argo CD reconciled revision 一致
- root 与相关 child Applications 为 Synced/Healthy
- first-party runtime Deployments rollout 成功
- runtime pods 不包含 CrashLoopBackOff、ImagePullBackOff 或 unresolved Pending
- Temporal、Hindsight、Qdrant、OTel、Postgres 由对应 platform/data Application
  提供，不通过 execution-runtime overlay 或 host-bridge 补齐

如果 `cloudflared-execution-control` 或 Cloudflare VPC Service binding 发生变化，先让
GitOps 同步 K8s connector，再重新 deploy `app-api-staging`。

## Step 2. 判断是否需要重新 deploy app-api staging

如果 `EXECUTION_CONTROL_PRIVATE` binding、`EXECUTION_CONTROL_PRIVATE_ORIGIN` 或
`EXECUTION_CONTROL_SHARED_SECRET` 发生变化，必须重新 deploy 或重新配置
`app-api-staging`。

```bash
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
- 不直接把 execution-control internal endpoint 作为 public surface smoke endpoint

## Step 4. Authenticated Chat Smoke

优先使用 repo-owned staging profile automation：

```bash
pnpm smoke:app-api -- chat-staging
```

staging release gate 使用 durable submit + run-event resume contract。通用
`apps/app-api/e2e/chat-e2e.ts --profile staging` 仍可用于显式诊断，但不作为
release gate。

`chat-staging`、`chat-memory-staging` 与 `docs-gated-staging` profile 都通过
`scripts/smoke/app-api.ts` 调用 staging smoke env runner。该 runner 会使用
repo-local `.tmp/staging-smoke.lock` 串行化命令，避免两个 smoke 同时重建同一个
固定 identity 导致 session mint 竞争。不要绕过 runner 并行执行会重置
`help_bot@outlook.com` 的 staging smoke 脚本。

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

- `pnpm smoke:app-api -- chat-staging` 返回 `0`
- 它输出 `passed=true`
- 它输出 `submitStreamAbortedAfterAccepted=true`
- `resume.terminalEvent.event=request.completed`
- `run.status=completed`
- `conversation.hasAssistantMessageForRequest=true`
- 不能出现 transport error、Worker proxy error、upstream unreachable

只有在明确做通用 chat runner 诊断时，才允许显式运行
`pnpm smoke:app-api -- chat -- --profile staging` 或追加同步 transport 参数。
同步 transport 不作为 staging closeout gate；不要用
`--expect-result-kind any` 替代真实通过标准。

profile memory 与 online memory recall 专项 smoke：

```bash
pnpm smoke:app-api -- chat-memory-staging
```

这条命令会通过同一个 fixed smoke identity 写入一条显式 profile memory，
再通过 stream chat 创建 durable run，并读取
`/api/chat/runs/:runId/steps` 的 sanitized trajectory。通过标准是
`passed=true`、`memory.deleted=true`、`recall.stepId=memory.recall`、
`recall.status=completed` 且 `recall.selectedMemoryCount > 0`。它不以自然语言
回答是否提到记忆作为验收依据。

不保留直连 execution-control internal endpoint 的 staging acceptance smoke。
Knowledge handoff 必须通过 app-api chat stream 验证，并在 sanitized trajectory 中
确认单个 Agent Activity、`knowledge_query` handoff、internal `knowledge_search`
结果和 finalized sources。需要内部 endpoint 诊断时按环境仓 runbook 在受控集群
网络内临时执行，不进入 app-api package script 或 release closeout。

## Step 5. 记录链路 closeout artifact

至少记录：

- 环境仓 revision、Argo CD sync/health 与 first-party rollout 摘要
- `https://api-staging.mucwiki-edge.link/readyz`
- `pnpm smoke:app-api -- chat-staging` 的 JSON 摘要
- 当前 app-api Worker 配置包含 `EXECUTION_CONTROL_PRIVATE` VPC Service binding 与
  `EXECUTION_CONTROL_PRIVATE_ORIGIN`

## Failure Handling

如果 smoke 失败且无法快速恢复：

1. 保持 execution upstream 指向 canonical staging runtime，并定位 runtime 或
   `app-api-staging` 配置错误。
2. 集群 desired-state 修复按环境仓 runbook 提交和验证，不从本源仓直接操作 Argo CD。
3. 修复后从 Step 1 重新执行 smoke，并记录失败依赖与新的环境 revision。
