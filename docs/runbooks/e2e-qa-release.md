---
doc_type: runbook
truth_scope: ops
owner_boundary: docs/runbooks
status: active
created: 2026-06-03
updated: 2026-07-10
---
# E2E QA Release Runbook

## 文档边界

本文是上线前 E2E QA 总入口。它串联当前已经存在的 staging、chat、docs、panel 与 observability
runbook，不重复维护每个子流程的全部细节。

本文只用于真实 staging release closeout。它不替代：

- repo unit / typecheck / build gate
- `docs/runbooks/execution-ops.md`
- `docs/runbooks/execution-smoke.md`
- `docs/runbooks/worker-observability-smoke.md`

当前默认目标环境是 `mucwiki-edge.link` staging。`campus.muc.wiki` 是 production
product endpoint；本文当前 gate 使用 `campus-staging.mucwiki-edge.link`。

## Closeout Directory

每轮 E2E QA 必须先创建独立 closeout 目录：

```bash
export E2E_QA_CLOSEOUT_DIR="$PWD/var/staging-closeout/$(date -u +%Y%m%dT%H%M%SZ)-e2e-qa-release"
mkdir -p "$E2E_QA_CLOSEOUT_DIR"
git status --short --branch > "$E2E_QA_CLOSEOUT_DIR/git-status.txt"
git rev-parse HEAD > "$E2E_QA_CLOSEOUT_DIR/git-head.txt"
```

本轮 summary 写入 `$E2E_QA_CLOSEOUT_DIR/SUMMARY.md`，至少记录：

- environment、target domain family、git branch / SHA、release identity、
  operator、started / finished UTC 与 final verdict
- repo preflight、staging runtime readiness、public surface health、chat E2E、
  docs QA、operator console QA、browser QA、observability、data-plane sanity 的
  closeout artifact 与 verdict
- blocker、non-blocking answer-quality badcase、external credential/config
  blocker、documentation drift 的 owner、closeout artifact 与状态

## 1. Repo Preflight

先运行不依赖真实 staging 的仓库验证：

```bash
pnpm repo:static | tee "$E2E_QA_CLOSEOUT_DIR/repo-static.txt"
git diff --check | tee "$E2E_QA_CLOSEOUT_DIR/git-diff-check.txt"
```

如果本轮包含代码改动，还必须按 `docs/reference/testing-and-verification-lanes.md`
选择对应 unit/typecheck/build lane。文档-only release 不用把全量 runtime tests 伪装成必要 gate。

## 2. Staging Runtime Readiness

先确认目标 Kubernetes 集群上的 execution-control staging runtime。本机只允许作为开发与
静态验证环境，不得作为 staging acceptance source of truth：

按私有环境仓的 cluster-readiness runbook 采集 Argo CD revision、Application
sync/health、schema PreSync 与 first-party rollout evidence，并将摘要保存到
`$E2E_QA_CLOSEOUT_DIR/execution-runtime-gitops.txt`。本源仓不复制环境的
Application 名称、namespace 或集群命令。

通过标准：

- 环境仓 revision 与 Argo CD reconciled revision 一致
- root 与相关 child Applications 为 Synced/Healthy
- first-party runtime Deployments rollout 成功
- pods 不处于 CrashLoopBackOff、ImagePullBackOff 或 Pending
- execution-control readiness 由 app-api `/readyz` 的 dependency status 进一步证明

## 3. Public Surface Health

检查当前 staging public surfaces：

```bash
for url in \
  https://api-staging.mucwiki-edge.link/healthz \
  https://api-staging.mucwiki-edge.link/readyz \
  https://campus-staging.mucwiki-edge.link/healthz \
  https://campus-staging.mucwiki-edge.link/readyz
do
  echo "## $url"
  curl --noproxy '*' -sS -i "$url"
done | tee "$E2E_QA_CLOSEOUT_DIR/surface-health.txt"
```

通过标准：

- API、campus、chat health / ready endpoints 返回预期 `200`
- docs 作为 campus 内部支撑面，由 campus ready、`/docs/*` browser check 与
  `pnpm smoke:app-api -- docs-gated-staging` 共同证明
- endpoint list 只包含 user/product surfaces，不包含 execution-control machine ingress
- execution-control readiness 由
  K8s rollout status 与 `api-staging /readyz` 的 `executionControl` /
  `executionRuntime` dependency 证明

## 4. Chat E2E

运行真实 staging chat 链路：

```bash
pnpm smoke:app-api -- chat-staging \
  | tee "$E2E_QA_CLOSEOUT_DIR/chat-default.json"

pnpm smoke:app-api -- chat-staging -- \
  --prompt "民族学本科人才培养方案总学分要求是多少？" \
  | tee "$E2E_QA_CLOSEOUT_DIR/chat-curriculum-plan.json"

pnpm smoke:app-api -- chat-staging -- \
  --prompt "校园网密码怎么改？" \
  | tee "$E2E_QA_CLOSEOUT_DIR/chat-alias-campus-network.json"

pnpm smoke:app-api -- chat-staging -- \
  --prompt "示例大学本科学生国家奖学金评审办法" \
  | tee "$E2E_QA_CLOSEOUT_DIR/chat-student-rule.json"
```

`pnpm smoke:app-api -- chat-staging` 是 release gate 默认入口，验证 durable submit + run-event
resume：先从 `POST /api/chat/requests/stream` 读取 `request.accepted` 与 durable
`runId`，再订阅 `/api/chat/runs/:runId/events/stream` 直到 terminal event，并检查 run
status、steps、Langfuse closeout 身份与 conversation materialization。通用
`pnpm smoke:app-api -- chat -- --profile staging` runner 只允许作为显式诊断，
不作为 release gate。

运行同一 durable reconnect 专项 smoke：

```bash
pnpm smoke:app-api -- chat-staging \
  | tee "$E2E_QA_CLOSEOUT_DIR/chat-durable-reconnect.json"
```

运行 profile memory 写入 + Temporal memory recall projection 专项 smoke：

```bash
pnpm smoke:app-api -- chat-memory-staging \
  | tee "$E2E_QA_CLOSEOUT_DIR/chat-memory-recall.json"
```

Hindsight personal memory 与 public web search 不再通过 app-api package script 直连
execution-control internal endpoint。相关能力必须通过 app-api chat stream、
operator read model 或 execution-control K8s readiness 间接证明；需要内部 endpoint
诊断时按环境仓 runbook 在受控集群网络内临时执行，不进入 release closeout 默认命令。

通过标准：

- 每条命令 exit code 为 `0`
- durable reconnect 输出 `passed=true`
- durable reconnect 输出 `submitStreamAbortedAfterAccepted=true`
- durable reconnect 输出包含同一个 `submit.runId`、`run.runId`、`run.requestId` 与
  `run.traceId`
- durable reconnect 输出 `workflow.workflowId` 与 `workflow.attemptCount > 0`
- durable reconnect 输出 `langfuseCloseout.productTraceId`、`requestId`、`runId`、
  `workflowId`、`sessionId` 与 `userId`，这些字段作为 Langfuse release closeout
  的产品侧身份来源
- durable reconnect 的 `resume.terminalEvent.event=request.completed`
- durable reconnect 的 `conversation.hasAssistantMessageForRequest=true`
- memory recall 输出 `passed=true`
- memory recall 输出 `memory.deleted=true`
- memory recall 输出 `recall.stepId=memory.recall`、`recall.status=completed`
  与 `recall.selectedMemoryCount > 0`
- 当前 app-api Worker 配置包含 `EXECUTION_CONTROL_PRIVATE` VPC Service binding 与
  `EXECUTION_CONTROL_PRIVATE_ORIGIN`

不接受：

- `retrieval_failed`
- `execution_runtime_unavailable`
- transport error
- Worker proxy error
- `--expect-result-kind any` 作为 release closeout 通过标准

如果链路成功但答案质量差，记录为 `non-blocking answer-quality badcase`，不要把 transport smoke 标绿为质量验收。

## 5. Docs Reader And Gated Docs

运行 repo-owned gated docs smoke：

```bash
pnpm exec tsx scripts/deploy/run-with-staging-smoke-env.ts --cwd apps/app-api \
  pnpm exec tsx ./e2e/docs-gated-staging.ts \
  | tee "$E2E_QA_CLOSEOUT_DIR/docs-gated-smoke.json"
```

再抽样 docs surface：

```bash
curl --noproxy '*' -sS -i https://campus-staging.mucwiki-edge.link/docs/ \
  | tee "$E2E_QA_CLOSEOUT_DIR/docs-root.txt"
curl --noproxy '*' -sS -i \
  https://campus-staging.mucwiki-edge.link/docs/regulations/student_rules/ \
  | tee "$E2E_QA_CLOSEOUT_DIR/docs-student-rules.txt"
```

通过标准：

- gated reader 匿名访问被拒绝
- 使用 staging smoke session 后 gated reader 可访问
- campus docs root 返回可渲染 HTML
- reader route 返回可渲染 HTML
- reader asset URL 不包含 `localhost`、`127.0.0.1` 或本地 MinIO endpoint

## 6. Operator Console And Access

运行 Access service-token smoke：

```bash
pnpm --dir apps/operator-console-web exec tsx ./e2e/staging-access-service-token.ts \
  | tee "$E2E_QA_CLOSEOUT_DIR/operator-console-access-service-token.json"
```

通过标准：

- 未认证 `/readyz` 返回 Cloudflare Access redirect
- service token 访问 `/healthz` 与 `/readyz` 返回 `200`
- allowlisted service token 访问 Worker-local `/api/overview` 返回机器
  operator context
- allowlisted service token 可以通过 Operator Console proxy 读取
  `/api/operator/provider-config/profiles`
- allowlisted service token 可以通过 Operator Console proxy 读取
  `/api/operator/observability-config/llm-debug-trace`，且响应不包含 raw auth
  header

该 smoke 证明 Access envelope 可由 automation 到达，并证明受控机器
operator 可以走 Operator Console -> app-api 的 provider-config 与
observability-config 路径；它不代表 human operator browser E2E。

使用 admitted human operator 登录后，至少检查当前 domain matrix：

- Shell：panel shell loads after Cloudflare Access login
- Requests：`/requests` loads and calls `/api/requests`
- Provider Config：`/operations/provider-config` loads and calls
  `/api/operator/provider-config/profiles`
- Observability Config：`/operations/observability` loads and calls
  `/api/operator/observability-config/llm-debug-trace`

以上 closeout artifact 可以是 browser automation report、network capture 摘要或截图加对应
HTTP status 记录；不能用 service-token smoke 代替。

The Operator Console must not directly call execution-control, Temporal, PG,
Sentry, Axiom or Langfuse during this browser check.

使用已登录 human operator 的 Playwright storage state 后，可以运行 repo-owned
browser E2E runner 生成 panel matrix evidence：

```bash
pnpm --dir apps/operator-console-web exec tsx ./e2e/staging-browser.ts \
  --storage-state "$OPERATOR_CONSOLE_STORAGE_STATE" \
  --evidence-dir "$E2E_QA_CLOSEOUT_DIR" \
  | tee "$E2E_QA_CLOSEOUT_DIR/operator-console-browser-e2e.stdout.json"
```

通过标准：

- `operator-console-browser-e2e.json` 输出 `passed=true`
- screenshots 覆盖 shell、Requests、Provider Config 与 Observability Config
- network summary 中不出现 direct execution-control、Temporal、PG、Sentry、Axiom
  或 Langfuse URL
- console / network blocker 为 `0`

## 7. Browser QA

人工或浏览器自动化至少检查：

- `https://campus-staging.mucwiki-edge.link`
  - campus shell 可见
  - account / dining / map / docs / feedback 入口可打开
  - 不出现 `ayafeed.com`、`localhost`、`127.0.0.1`
- `https://campus-staging.mucwiki-edge.link`
  - 使用 staging smoke identity 后 chat UI 可打开
  - conversations 列表能看到本轮 E2E 创建的新会话
  - 人工发送一条问题能返回 answer
- `https://campus-staging.mucwiki-edge.link/docs/`
  - 首页、分类、reader 页面可打开
  - gated 文档未授权不可读，授权后可读
- `https://panel-staging.mucwiki-edge.link`
  - 首次访问进入 Cloudflare Access
  - Access 登录后 panel shell 可加载
  - Requests、Provider Config 与 Observability Config 当前域矩阵完成检查

每个 surface 至少保存一份 screenshot 或可审计文字 closeout artifact。console / network
明显错误必须记录。

campus-web browser runner：

```bash
pnpm exec tsx scripts/deploy/run-with-staging-smoke-env.ts --cwd apps/campus-web \
  pnpm exec tsx ./e2e/staging-browser.ts \
    --evidence-dir "$E2E_QA_CLOSEOUT_DIR" \
  | tee "$E2E_QA_CLOSEOUT_DIR/campus-browser-e2e.stdout.json"
```

通过标准：

- 使用 `APP_API_STAGING_SMOKE_AUTH_SECRET` 或
  `STAGING_APP_API_SMOKE_AUTH_SECRET` 铸造真实 staging smoke session
- `campus-browser-e2e.json` 输出 `passed=true`
- screenshots 覆盖 campus home、chat 与 docs reader
- chat runner 访问 `/chat` 并向真实 staging 链路提交问题
- docs runner 访问 `/docs/` 与 `/docs/regulations/student_rules/`
- console / network blocker 为 `0`

## 8. Sentry And Axiom Verification

Sentry closeout 默认使用 Explore spans，不依赖 issue-list endpoint。按目标 org /
project、`environment=staging`、本轮时间窗口和
`span.description:"POST /api/chat/requests/stream"` 过滤，把 Sentry trace 链接或导出的
spans 摘要保存到 `$E2E_QA_CLOSEOUT_DIR/sentry-chat-spans.md`。

如果 Sentry issue-list endpoint 返回
`403 You do not have permission to perform this action.`，不要把它判为 staging
observability blocker。当前 closeout 以 spans evidence 或 Sentry UI 等价 trace
closeout artifact 为准。

Axiom 使用 `campus-agent-runtime` dataset。查询窗口应覆盖本轮 chat /
projection drain 时间段，并保存：

- query/filter
- row count
- matched request id 或 trace id
- redaction note

## 9. Operator Runtime And Eval Closeout

上线前必须验证 operator-safe runtime projection，而不是回读 Temporal history、
Docker state 或本地 closeout artifact。

先确认 GitOps revision、K8s sampler/posture collector 和 app-api operator projection
均已更新。不要从远端 checkout 或一次性 host script 刷新线上 projection。

检查 Temporal task queue snapshot：

```bash
task_queue_url="$APP_API_BASE_URL/api/internal/operator/runtime/temporal-task-queues"
curl --noproxy '*' -sS \
  -H "x-app-internal-auth: $APP_API_INTERNAL_SHARED_SECRET" \
  "$task_queue_url?limit=8" \
  | tee "$E2E_QA_CLOSEOUT_DIR/operator-runtime-task-queues.json"
```

K8s execution runtime 必须检查 autoscaler posture：

```bash
curl --noproxy '*' -sS \
  -H "x-app-internal-auth: $APP_API_INTERNAL_SHARED_SECRET" \
  -H "x-app-operator-email: $APP_API_RELEASE_OPERATOR_EMAIL" \
  "$APP_API_BASE_URL/api/operator/runtime/autoscaler/postures?limit=16" \
  | tee "$E2E_QA_CLOSEOUT_DIR/operator-runtime-autoscaler-postures.json"
```

通过标准：

- task queue current projection 覆盖 workflow worker 与 opened activity workers
- `pollerCount`、`pollerIdentities`、`backlog` 与 `oldestTaskAge` 来自 Temporal
  `DescribeTaskQueue(report_stats=true)`
- 当前 sampler 下 `scheduleToStartLatency` 必须显式为 `unsupported_by_source`
- K8s runtime 的 autoscaler posture 覆盖每个 KEDA-managed worker pool，且
  `scalerKind=keda_temporal`
- explicit closeout 如需保留历史行，producer 必须使用 `history=1`；release QA 默认只要求
  current projection closeout artifact

Eval diagnostic release closeout 必须从 app-api operator observability detail 注入
`runtimeRun.operatorStepTrajectory`，再生成 badcase projection。release mode 必须设置
`require_trajectory_attribution=True`。

阻断条件：

- request correlation 缺失
- app-api observability detail 缺 `runtimeRun.operatorStepTrajectory`
- low-score badcase 的 trajectory attribution 为 `trajectory_missing` 或
  `attribution_missing`
- eval artifact 包含 Temporal history、raw trace、prompt、transcript、auth header 或本地
  object-store path

## 10. Data Plane Sanity

只读检查 Argo CD Applications、Kubernetes workload 与数据面：

```bash
argocd app list | tee "$E2E_QA_CLOSEOUT_DIR/argocd-applications.txt"
kubectl -n campus-agent-staging get pods,svc,networkpolicy \
  | tee "$E2E_QA_CLOSEOUT_DIR/k8s-data-plane.txt"
```

检查项：

- Qdrant、Postgres、Temporal、Hindsight、OTel 与 execution runtime Application
  均为 Synced/Healthy
- 数据面 Service 不通过 host bridge 或手工 EndpointSlice 补齐
- query-enabled aliases 仍为当前 accepted surfaces
- runtime release manifest 可被 guard 读取
- Qdrant snapshot 不存入 staging R2

## Closeout Rules

E2E QA 通过必须同时满足：

- repo preflight 通过
- staging runtime strict check 通过
- public surfaces health / ready 通过
- chat E2E 覆盖 policy、curriculum、alias 用户问法与默认问法
- docs gated smoke 通过
- panel Access envelope smoke 通过
- browser QA 没有阻断性 console / network / auth 问题
- Sentry 有真实 staging span 或等价 trace closeout artifact
- Axiom 有真实 runtime event closeout artifact
- Langfuse real trace closeout artifact 通过
  `pnpm --dir packages/eval-langfuse exec tsx ./src/cli.ts verify-trace`，并带 request /
  run / workflow identity 比对
- 若本轮执行 Ragas eval，`ragas-score-traces` 或 `ragas-score-dataset` 输出已落盘；
  Langfuse score 只作为 eval sink closeout artifact
- operator runtime task queue / autoscaler projection closeout artifact 完整
- Langfuse Ragas score candidate projection 使用 operator step trajectory 且无
  missing attribution
- closeout artifacts 完整落盘到本轮目录

禁止通过标准：

- 使用 fallback、兜底、best-effort 或 silent recovery 把失败标绿
- 跳过 Access / auth / readyz 后宣称通过
- 使用 `--expect-result-kind any` 作为 release gate
- 把 Sentry DSN 存在误判为 sink-side verification 通过
- 把 service-token panel smoke 误判为 human operator 已授权

失败必须分类：

- `blocker`
- `non-blocking answer-quality badcase`
- `external credential/config blocker`
- `documentation drift`

不能用“待确认”代替失败原因。
