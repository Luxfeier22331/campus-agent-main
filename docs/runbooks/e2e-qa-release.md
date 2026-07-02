---
doc_type: runbook
truth_scope: ops
owner_boundary: docs/runbooks
status: active
created: 2026-06-03
updated: 2026-06-09
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

## Evidence Directory

每轮 E2E QA 必须先创建独立 evidence 目录：

```bash
export E2E_QA_EVIDENCE_DIR="$PWD/var/staging-evidence/$(date -u +%Y%m%dT%H%M%SZ)-e2e-qa-release"
mkdir -p "$E2E_QA_EVIDENCE_DIR"
git status --short --branch > "$E2E_QA_EVIDENCE_DIR/git-status.txt"
git rev-parse HEAD > "$E2E_QA_EVIDENCE_DIR/git-head.txt"
```

本轮 summary 写入 `$E2E_QA_EVIDENCE_DIR/SUMMARY.md`，至少记录：

- environment、target domain family、git branch / SHA、release identity、
  operator、started / finished UTC 与 final verdict
- repo preflight、staging runtime readiness、public surface health、chat E2E、
  docs QA、operator console QA、browser QA、observability、data-plane sanity 的
  evidence file 与 verdict
- blocker、non-blocking answer-quality badcase、external credential/config
  blocker、documentation drift 的 owner、evidence 与状态

## 1. Repo Preflight

先运行不依赖真实 staging 的仓库验证：

```bash
pnpm repo:static | tee "$E2E_QA_EVIDENCE_DIR/repo-static.txt"
git diff --check | tee "$E2E_QA_EVIDENCE_DIR/git-diff-check.txt"
```

如果本轮包含代码改动，还必须按 `docs/reference/testing-and-verification-lanes.md`
选择对应 unit/typecheck/build lane。文档-only release 不用把全量 runtime tests 伪装成必要 gate。

## 2. Staging Runtime Readiness

先确认 `nc-arm-6c` 上的 execution-control staging runtime。本机只允许作为开发与
静态验证环境，不得作为 staging acceptance source of truth：

```bash
ssh nc-arm-6c \
  'cd /srv/apps/campus-agent && \
    ./infra/local/staging/status-execution-control-staging.sh --check' \
  | tee "$E2E_QA_EVIDENCE_DIR/execution-control-status.txt"
```

通过标准：

- exit code 为 `0`
- 输出包含 strict check 通过信息
- 不出现 `host.docker.internal` 作为 Qdrant runtime URL
- 不出现固定 `172.*` 服务入口

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
done | tee "$E2E_QA_EVIDENCE_DIR/surface-health.txt"
```

通过标准：

- API、campus、chat health / ready endpoints 返回预期 `200`
- docs 作为 campus 内部支撑面，由 campus ready、`/docs/*` browser check 与
  `docs:gated:smoke:staging` 共同证明
- endpoint list 只包含 user/product surfaces，不包含 execution-control machine ingress
- execution-control readiness 由
  `infra/local/staging/status-execution-control-staging.sh --check` 与
  `api-staging /readyz` 的 `executionControl` / `executionRuntime` dependency 证明

## 4. Chat E2E

运行真实 staging chat 链路：

```bash
pnpm --dir apps/app-api chat:e2e:staging \
  | tee "$E2E_QA_EVIDENCE_DIR/chat-default.json"

pnpm --dir apps/app-api chat:e2e:staging -- \
  --prompt "民族学本科人才培养方案总学分要求是多少？" \
  | tee "$E2E_QA_EVIDENCE_DIR/chat-curriculum-plan.json"

pnpm --dir apps/app-api chat:e2e:staging -- \
  --prompt "校园网密码怎么改？" \
  | tee "$E2E_QA_EVIDENCE_DIR/chat-alias-campus-network.json"

pnpm --dir apps/app-api chat:e2e:staging -- \
  --prompt "示例大学本科学生国家奖学金评审办法" \
  | tee "$E2E_QA_EVIDENCE_DIR/chat-student-rule.json"
```

`chat:e2e:staging` 是 release gate 默认入口，验证 durable submit + run-event
resume：先从 `POST /api/chat/requests/stream` 读取 `request.accepted` 与 durable
`runId`，再订阅 `/api/chat/runs/:runId/events/stream` 直到 terminal event，并检查 run
status、steps、Langfuse closeout 身份与 conversation materialization。通用
`chat:e2e -- --profile staging` runner 只允许作为显式诊断，不作为 release gate。

运行同一 durable reconnect 专项 smoke：

```bash
pnpm --dir apps/app-api chat:durable:e2e:staging \
  | tee "$E2E_QA_EVIDENCE_DIR/chat-durable-reconnect.json"
```

运行 profile memory 写入 + Temporal memory recall projection 专项 smoke：

```bash
pnpm --dir apps/app-api chat:memory:e2e:staging \
  | tee "$E2E_QA_EVIDENCE_DIR/chat-memory-recall.json"
```

运行 Hindsight personal memory product-path runtime gate：

```bash
pnpm --dir apps/app-api hindsight:memory:e2e:staging \
  | tee "$E2E_QA_EVIDENCE_DIR/hindsight-memory-e2e-staging.json"
```

运行真实 chat + app-api Postgres projection + Hyperdrive usage proof：

```bash
pnpm --dir apps/app-api runtime-db:proof:staging \
  -- --output "$E2E_QA_EVIDENCE_DIR/runtime-db-proof.json"
```

该命令由 app-api staging proof runner 读取 ops-owned staging runtime env，并把
`STAGING_APP_API_OPERATOR_DATABASE_URL` 等 staging profile 配置投影为
`APP_API_OPERATOR_DATABASE_URL` 等 canonical runtime env。proof 脚本本身只消费
canonical env，并额外要求 `CLOUDFLARE_ACCOUNT_ID` 与 `CLOUDFLARE_API_TOKEN` 用于读取
Hyperdrive GraphQL 指标。`--output` 写入纯 JSON evidence；stdout 仅用于人工查看，
不要用 shell `tee` 生成 `.json` evidence。`--output` 只接受绝对路径，避免
`pnpm --dir apps/app-api` 改变工作目录后把 evidence 写进 app 子目录。它不会打印
Cloudflare token、Postgres DSN 或 Worker secrets。

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
- Hindsight memory staging 输出 `passed=true`，并覆盖 append accepted、operation
  status materialization proof、operation list sanitized projection、recall、
  reflect based_on facts、profile upsert / disable、owner disable / RTBF 与 user
  isolation
- runtime DB proof 输出 `passed=true`
- runtime DB proof 输出 `checks.chatCompleted=true`、
  `checks.postgresProjectionFound=true`、
  `checks.hyperdriveUsageCollected=true` 与
  `checks.traceBacklinkSatisfied=true`
- runtime DB proof 的 `postgres.projection.requestExecution` 与
  `postgres.projection.observabilityFact` 必须都存在，并且 `traceId` 与本次 chat
  durable run 一致
- runtime DB proof 的 `postgres.delta.temporalTaskQueueSnapshotCount` 与
  `postgres.delta.workerAutoscalerDecisionCount` 应保持 `0`；如果非 `0`，说明本轮
  release window 内仍有 sampler/autoscaler 历史写入，需要先定位
- runtime DB proof 的 `hyperdrive.delta.freshQueryCount` 只接受来自 auth /
  provider-config / dining 这类白名单路径；真实 chat 主链路不应把 runtime /
  observability projection 默认打到 `APP_API_DB_FRESH`

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
node apps/app-api/scripts/run-with-staging-smoke-env.mjs \
  pnpm exec tsx ./scripts/staging-docs-gated-smoke.ts \
  | tee "$E2E_QA_EVIDENCE_DIR/docs-gated-smoke.json"
```

再抽样 docs surface：

```bash
curl --noproxy '*' -sS -i https://campus-staging.mucwiki-edge.link/docs/ \
  | tee "$E2E_QA_EVIDENCE_DIR/docs-root.txt"
curl --noproxy '*' -sS -i \
  https://campus-staging.mucwiki-edge.link/docs/regulations/student_rules/ \
  | tee "$E2E_QA_EVIDENCE_DIR/docs-student-rules.txt"
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
node apps/operator-console-web/scripts/staging-access-service-token-smoke.mjs \
  | tee "$E2E_QA_EVIDENCE_DIR/operator-console-access-service-token.json"
```

通过标准：

- 未认证 `/readyz` 返回 Cloudflare Access redirect
- service token 访问 `/healthz` 与 `/readyz` 返回 `200`
- allowlisted service token 访问 Worker-local `/api/overview` 返回机器
  operator context
- allowlisted service token 可以通过 Operator Console proxy 读取
  `/api/operator/provider-config/profiles`

该 smoke 证明 Access envelope 可由 automation 到达，并证明受控机器
operator 可以走 Operator Console -> app-api 的 provider-config 路径；它不代表
human operator browser E2E。

使用 admitted human operator 登录后，至少检查当前 domain matrix：

- Shell：panel shell loads after Cloudflare Access login
- Overview：root dashboard loads and calls `/api/operator/overview`
- Runtime Health：overview runtime card calls `/api/operator/runtime/health`
- Requests：`/requests` loads and calls `/api/requests`
- Provider Config：`/operations/provider-config` loads and calls
  `/api/operator/provider-config/profiles`
- Official Web：`/officialWebSites` loads and calls `/api/official-web/sites`
- Authenticated Notices：`/authenticatedNoticeProcessing` loads and calls
  `/api/authenticated-notices/processing`
- Dining Operations：current minimal Operator Console does not claim dining
  operations readiness. If a historical `/operations/dining` smoke is run, it
  may call `/api/ops/dining/halls` or show `食堂运营状态未初始化或持久化状态不完整。`
  when transitional dining seed state has not been applied. This is not target
  production data readiness; target dining data readiness requires dining sync
  Job/CronJob evidence and a published projection.

以上证据可以是 browser automation report、network capture 摘要或截图加对应
HTTP status 记录；不能用 service-token smoke 代替。

Runtime Health is a projection owned by `app-api`; the Operator Console must not
directly call execution-control, Temporal, PG, Sentry or Axiom during this
browser check. Dining checks must use real seeded state when the release claims
the domain is ready; otherwise the accepted evidence is the governed diagnostic
state above, not synthesized frontend data.

使用已登录 human operator 的 Playwright storage state 后，可以运行 repo-owned
browser E2E runner 生成 panel matrix evidence：

```bash
node apps/operator-console-web/scripts/staging-browser-e2e.mjs \
  --storage-state "$OPERATOR_CONSOLE_STORAGE_STATE" \
  --evidence-dir "$E2E_QA_EVIDENCE_DIR" \
  | tee "$E2E_QA_EVIDENCE_DIR/operator-console-browser-e2e.stdout.json"
```

通过标准：

- `operator-console-browser-e2e.json` 输出 `passed=true`
- screenshots 覆盖 shell、Overview、Requests、Provider Config、
  Official Web、Authenticated Notices 与 Dining Operations
- network summary 中不出现 direct execution-control、Temporal、PG、Sentry 或 Axiom URL
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
  - Overview、Runtime Health、Requests、Provider Config、
    Official Web、Authenticated Notices 与 Dining Operations 当前域矩阵完成检查

每个 surface 至少保存一份 screenshot 或可审计文字证据。console / network 明显错误必须记录。

campus-web browser runner：

```bash
node apps/app-api/scripts/run-with-staging-smoke-env.mjs \
  --cwd apps/campus-web \
  pnpm exec tsx ./scripts/staging-browser-e2e.ts \
    --evidence-dir "$E2E_QA_EVIDENCE_DIR" \
  | tee "$E2E_QA_EVIDENCE_DIR/campus-browser-e2e.stdout.json"
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

先确认 Sentry lookup token：

```bash
uv run --all-packages python -m scripts.check_sentry_lookup_access --json \
  | tee "$E2E_QA_EVIDENCE_DIR/sentry-lookup.json"
```

Sentry closeout 默认查询 Explore spans，不依赖 issue-list endpoint：

```bash
uv run --all-packages python -m scripts.query_sentry_spans \
  --org-slug linear27 \
  --project 4511351503454208 \
  --environment staging \
  --stats-period 3h \
  --query 'span.description:"POST /api/chat/requests/stream"' \
  --markdown-output "$E2E_QA_EVIDENCE_DIR/sentry-chat-spans.md" \
  | tee "$E2E_QA_EVIDENCE_DIR/sentry-chat-spans.txt"
```

如果 Sentry issue-list endpoint 返回
`403 You do not have permission to perform this action.`，不要把它判为 staging
observability blocker。当前 closeout 以 spans evidence 或 Sentry UI 等价 trace
evidence 为准。

Axiom 使用 `campus-agent-runtime` dataset。查询窗口应覆盖本轮 chat /
projection drain 时间段，并保存：

- query/filter
- row count
- matched request id 或 trace id
- redaction note

## 9. Operator Runtime And Eval Closeout

上线前必须验证 operator-safe runtime projection，而不是回读 Temporal history、
Docker state 或本地证据文件。

先在 `nc-arm-6c` 的 pinned staging checkout 中运行一次显式 ops proof，刷新 bounded
current projection。该步骤不启动常驻 sampler/autoscaler loop：

```bash
ssh nc-arm-6c \
  'cd /srv/apps/campus-agent && \
    ./infra/local/staging/run-execution-control-ops-proof.sh' \
  | tee "$E2E_QA_EVIDENCE_DIR/operator-runtime-ops-proof.txt"
```

检查 Temporal task queue snapshot：

```bash
task_queue_url="$APP_API_BASE_URL/api/internal/operator/runtime/temporal-task-queues"
curl --noproxy '*' -sS \
  -H "x-app-internal-auth: $APP_API_INTERNAL_SHARED_SECRET" \
  "$task_queue_url?limit=8" \
  | tee "$E2E_QA_EVIDENCE_DIR/operator-runtime-task-queues.json"
```

K8s execution runtime 必须检查 autoscaler posture：

```bash
curl --noproxy '*' -sS \
  -H "x-app-internal-auth: $APP_API_INTERNAL_SHARED_SECRET" \
  -H "x-app-operator-email: $APP_API_RELEASE_OPERATOR_EMAIL" \
  "$APP_API_BASE_URL/api/operator/runtime/autoscaler/postures?limit=16" \
  | tee "$E2E_QA_EVIDENCE_DIR/operator-runtime-autoscaler-postures.json"
```

Docker Compose transitional runtime 额外检查 autoscaler decisions：

```bash
curl --noproxy '*' -sS \
  -H "x-app-internal-auth: $APP_API_INTERNAL_SHARED_SECRET" \
  -H "x-app-operator-email: $APP_API_RELEASE_OPERATOR_EMAIL" \
  "$APP_API_BASE_URL/api/operator/runtime/autoscaler/decisions?limit=8" \
  | tee "$E2E_QA_EVIDENCE_DIR/operator-runtime-autoscaler-decisions.json"
```

Docker Compose transitional runtime 额外检查 autoscaler actuations：

```bash
curl --noproxy '*' -sS \
  -H "x-app-internal-auth: $APP_API_INTERNAL_SHARED_SECRET" \
  -H "x-app-operator-email: $APP_API_RELEASE_OPERATOR_EMAIL" \
  "$APP_API_BASE_URL/api/operator/runtime/autoscaler/actuations?limit=8" \
  | tee "$E2E_QA_EVIDENCE_DIR/operator-runtime-autoscaler-actuations.json"
```

通过标准：

- task queue current projection 覆盖 workflow worker 与 opened activity workers
- `pollerCount`、`pollerIdentities`、`backlog` 与 `oldestTaskAge` 来自 Temporal
  `DescribeTaskQueue(report_stats=true)`
- 当前 sampler 下 `scheduleToStartLatency` 必须显式为 `unsupported_by_source`
- K8s runtime 的 autoscaler posture 覆盖每个 KEDA-managed worker pool，且
  `scalerKind=keda_temporal`
- Docker Compose transitional autoscaler decision 包含 `sourceSnapshotId`、`currentReplicas`、`desiredReplicas`
  与 `budgetState`
- Docker Compose apply mode 下 autoscaler actuation 只允许 `applied`、`skipped` 或
  `failed`
- explicit proof 如需保留历史行，producer 必须使用 `history=1`；release QA 默认只要求
  current projection evidence

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

只读检查 `nc-arm-6c` 容器与数据面：

```bash
ssh nc-arm-6c \
  'cd /srv/apps/campus-agent && \
    docker ps --format "{{.Names}}\t{{.Status}}\t{{.Ports}}"' \
  | tee "$E2E_QA_EVIDENCE_DIR/remote-containers.txt"
```

检查项：

- Qdrant、Postgres、MinIO、execution runtime 容器健康
- Qdrant 端口只绑定 host loopback 或 Docker data-plane，不公网暴露
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
- Sentry 有真实 staging span 或等价 trace evidence
- Axiom 有真实 runtime event evidence
- Langfuse real trace evidence 通过
  `pnpm --dir packages/eval-langfuse langfuse verify-trace`，并带 request /
  run / workflow identity 比对
- 若本轮执行 Ragas eval，`ragas-score-traces` 或 `ragas-score-dataset` 输出已落盘；
  Langfuse score 只作为 eval sink evidence
- operator runtime task queue / autoscaler projection evidence 完整
- Langfuse Ragas score candidate projection 使用 operator step trajectory 且无
  missing attribution
- evidence 完整落盘到本轮目录

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
