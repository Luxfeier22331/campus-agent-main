---
doc_type: reference
status: active
created: 2026-06-04
updated: 2026-06-04
---
# Durable Agent Runtime Gap Matrix

## 文档边界

本文是 `durable-agent-runtime` 的实现收口矩阵。

它只记录当前实现与目标 durable runtime 之间的差距，不定义最终 schema，不替代
architecture / ADR / contract。

权威设计入口：

- `docs/architecture/system/durable-agent-runtime-architecture.md`
- `docs/decisions/adr-0047-run-centric-durable-agent-runtime.md`
- `docs/contracts/durable-agent-runtime-contract.md`
- `docs/data/durable-agent-runtime-schema.md`

## Summary

当前 repo 已经从 single-process execution protection 推进到 Postgres-backed
run-centric durable runtime substrate，并完成 app-api / public-chat 的 durable run
cutover foundation；它仍不能标记为 production-complete，因为真实 deployed reconnect /
multi-worker recovery evidence 与 run-centric operator/eval consumption 还没有收口。

当前具备：

- Go `supervisor-api` execution ingress
- in-process lifecycle registry
- global / per-lane admission controller
- bounded in-memory queue
- explicit cancel / request timeout / graceful drain
- bridge circuit breaker
- internal lifecycle SSE projection
- initial `WorkflowRunStore` foundation for gated multi-step workflow trace
- isolated durable runtime store kernel and Postgres store foundation
- durable lease coordinator foundation
- supervisor internal durable run create / get / events / cancel substrate
- worker durable bridge endpoint and Go durable bridge client
- supervisor lease-driven single-run executor callable by internal process-next
  command
- supervisor-owned durable worker loop foundation with explicit env contract,
  heartbeat registration, configured lane-budget sync, lease polling and
  readyz status projection; lane budget backpressure is a recorded poll outcome
  and does not terminate the long-running loop
- supervisor-owned durable recovery loop foundation with explicit env contract
  and readyz status projection; it does not execute agent work
- scheduler recovery now runs explicit expired-lease and timed-out-run recovery:
  stale leases become `lease.expired`; runs below the configured max retry
  attempt are re-queued with an incremented lease attempt; runs at the retry
  limit become `run.expired` with terminal `lease_expired`; queued runs past
  lane queue timeout become `run.expired` with `queue_timeout`; active runs past
  lane run timeout release their active lease and become `run.expired` with
  `run_timeout`
- durable cancel command now goes through the durable coordinator: queued /
  active runs transition to `run.canceled`; active leases are released with
  `lease.released`; and active bridge execution receives a cooperative cancel
  command before the HTTP cancel endpoint is accepted
- worker completion now re-reads durable run and execution lease truth after the
  bridge returns and before appending `agent.completed`,
  browser-visible `finalization.completed` or `run.completed`; terminal run
  drift, released / expired lease state, and lease ownership drift fail closed
  without publishing late completion events
- app-api supervisor durable runtime adapter for internal create / get /
  events / cancel command-query calls
- app-api product `POST /api/chat/requests` submit path now creates a
  supervisor durable run after app-api accept, writes the real `run_id`
  backlink into accepted / finalized `runtime.request_execution`, and
  fail-closes durable create errors into finalized app-api error truth
- app-api product stream path can consume supervisor durable run events and
  poll supervisor durable run events by cursor, emit lifecycle events, and
  finalize accepted requests from browser-visible `finalization.completed`
  event payloads
- app-api durable stream closeout is app-owned: after supervisor durable run
  create succeeds, the stream path registers a request `waitUntil`
  finalization closeout before emitting `request.accepted`; browser disconnect
  stops event consumption but does not stop app-api finalization commit
- app-api `runtime.request_execution` finalization is accepted-only: duplicate
  or drifted closeout must fail closed before inserting assistant message,
  projection outbox or observability fact rows
- app-api blocking `POST /api/chat/requests` path now finalizes from supervisor
  durable run `finalization.completed` event payloads when durable runtime is
  configured; it polls `ListRunEventsAfter(after_sequence)` until terminal or
  explicit polling budget exhaustion, and no longer calls the legacy sync
  `/api/v1/answer` response as the terminal answer truth
- app-api product run command-query endpoints now expose session-admitted
  `/api/chat/runs/:runId`, `/api/chat/runs/:runId/events`,
  `/api/chat/runs/:runId/events/stream`, and
  `/api/chat/runs/:runId/cancel`, with local
  `runtime.request_execution.run_id` ownership verification before proxying
  supervisor durable run status / browser-visible events / browser resume
  stream / cancel
- repo-owned staging durable reconnect harness:
  `pnpm --dir apps/app-api chat:durable:e2e:staging` submits the product stream,
  aborts after `request.accepted`, resumes the same durable run through
  `/api/chat/runs/:runId/events/stream?after_sequence=0`, verifies strictly
  advancing browser-visible run events through `finalization.completed`, checks
  durable run status identity, and confirms the conversation contains the
  assistant message for the accepted request
- public-chat pending-run product baseline persists accepted durable run
  identity in tab-scoped storage, resumes by
  `/api/chat/runs/:runId/events/stream?after_sequence=N`, rejects cursor /
  conversation identity drift, loads conversation truth only after terminal run
  events, and routes draft `/chat` back to the canonical conversation path
- product run phase projection is explicit: app-api maps supervisor durable run
  status into a typed product `phase`, unknown supervisor status fails closed,
  chat submit stream emits `runPhase` from the created durable run, and
  public-chat pending state / chat run routes / protected panel request detail
  consume that projection instead of guessing queue or run state
- supervisor durable run create now requires `metadata.execution_payload`
  and validates request / conversation / trace identity alignment
- repo-owned Postgres durable runtime proof command:
  `go run ./cmd/durable-runtime-proof --database-url ... --evidence-path ...`
  verifies against a real Postgres durable store that concurrent workers do not
  double-lease the same queued run, expired leases requeue until the bounded
  retry limit and then terminally expire, proof artifacts are exact-prefix
  cleaned, and the pre-existing lane budget is restored after the proof
- repo-owned durable schema install/check command:
  `go run ./cmd/durable-runtime-schema --mode install|check --database-url ...
  --evidence-path ...` is the formal schema path for durable Postgres store. It
  installs schema through `EnsureSchema` in `install` mode, verifies with
  `HealthCheck` in both modes, and writes explicit JSON evidence. Staging
  lifecycle runs `install` then `check` before Docker Compose runtime starts.
- repo-owned deployed supervisor durable HTTP proof command:
  `go run ./cmd/durable-runtime-http-proof --supervisor-url ... --shared-secret
  ... --evidence-path ...` records `/readyz` evidence and fails closed unless
  durable store, durable worker loop and durable recovery loop are all reported
  ready / started by the deployed supervisor runtime
- repo-owned durable-ready gate: app-api runtime readyz now parses supervisor
  readyz `durable_runtime` / `durable_worker_loop` /
  `durable_recovery_loop` status and requires `dependencies.durableRuntime=ready`
  for `staging` / `production`; staging strict status additionally checks the
  local supervisor readyz payload has durable store healthy plus worker /
  recovery loops enabled, configured, healthy, and started

当前缺失：

- recorded real staging reconnect / refresh E2E evidence for pending-run product
  behavior；2026-06-04 的真实 staging harness 运行失败于
  `request.accepted` 缺少 durable `runId` / `runPhase`，说明当前 deployed
  product path 尚未完成 durable cutover；新增 durable-ready gate 只防止
  readiness 假绿，不能替代重新部署后的 staging durable reconnect evidence
- multi-worker pool deployment verification and production recovery evidence
- local Postgres-backed concurrent lease acquisition and expired-lease recovery
  proof exists, schema install/check is repo-owned, but deployed multi-worker
  staging evidence is still missing
- browser stream real staging evidence as continuous run event subscription
- panel / eval / trace 的统一 run backlink 仍需继续扩展；request detail、
  quality badcase 与 eval candidate 已接入 `runtime.request_execution.run_id`
  backlink

## Gap Matrix

### Answer Execution Object

- Current: `request_id` 贯穿 app-api request、supervisor lifecycle 与 bridge call。
- Target: durable `run_id` 是一次回答的 canonical object，`request_id` 只作为
  correlation。
- Progress: supervisor durable store 已具备 `DurableRun`，并提供 internal
  `/internal/durable/runs` create / get command-query substrate；app-api 已有
  strict durable runtime adapter 可调用 supervisor internal create / get / events /
  cancel endpoint；`runtime.request_execution` 已新增 nullable `run_id` backlink
  用于 durable cutover 后绑定 product request truth；`POST /api/chat/requests`
  的 submit path 已在 app-api accept 后创建 durable run，accepted / finalized
  request truth 均写入真实 `run_id`；blocking submit 与 stream submit 均通过
  `after_sequence` cursor polling 消费 browser-visible durable events，并从
  `finalization.completed` 完成 app-api finalization；stream submit 会在
  `request.accepted` 发送前注册 app-api-owned `waitUntil` closeout，同一个
  invocation 内 stream consumer 与 background closeout 共享一个 finalization
  promise；DB finalization 只允许从 `accepted` 状态推进，防止重复 closeout 双写。
  browser-facing
  `/api/chat/runs/:runId/events/stream` 已能按 `after_sequence` 恢复
  browser-visible durable run event projection，且不重新执行 run；该 endpoint 已按
  bounded continuous subscription 轮询后续事件，遇到 terminal event 后关闭。
  repo-owned `chat:durable:e2e:staging` harness 已固定 staging 断开 submit stream
  后通过 existing run event stream 恢复到 `finalization.completed` 的验收动作。
  public-chat 已持久化 pending durable run identity，并在刷新 / 路由恢复时通过 run
  event stream 接续；terminal 后先校验 conversation truth，再清理 pending state。
- Progress: deployed `staging` / `production` app-api chat command path now
  requires explicitly configured durable runtime. If durable runtime is absent
  or its required supervisor URL / shared secret config is missing, submit and
  stream commands fail before accepting the request and do not call the legacy
  sync `/api/v1/answer` path.
- Progress: app-api `/readyz` now exposes and gates deployed durable runtime
  readiness through supervisor readyz durable store / worker loop / recovery
  loop preflight; staging strict status also checks local supervisor durable
  payload and app-api `dependencies.durableRuntime=ready`.
- Gap: 真实 staging reconnect evidence 尚未落盘；legacy sync `/api/v1/answer`
  仍保留为 local / development 显式 non-durable path。
  Durable Postgres schema 已有正式 install/check 命令和 staging lifecycle gate；
  schema bootstrap 不再依赖 proof command。

### Conversation Concurrency

- Current: `chat.conversations` 拥有 owner 和 messages；未冻结 active run policy。
- Target: 一个 conversation 默认最多一个 active primary run。
- Progress: durable store kernel 与 internal create endpoint 已实现
  `conversation_active_run` fail-closed gate；app-api durable adapter 会保留 typed
  supervisor error envelope，不把该错误扩宽成 generic unavailable；app-api
  submit path 在 durable create 失败后会 finalize accepted request 为 typed
  error，并保留 `run_id` backlink；browser-facing status endpoint 已能通过 app-api
  run ownership gate 查询 durable run summary；public-chat 如果在当前 tab 发现 pending
  durable run 与当前 route conversation 不一致，会回到 pending run 对应的 canonical
  conversation route，不静默忽略进行中的 run。
- Gap: stream path 已按 sequence cursor polling supervisor events，browser resume
  stream 已有 `run_id + after_sequence` bounded subscription endpoint；repo-owned
  staging durable reconnect harness 已完成，仍缺真实 staging evidence closeout。

### Lifecycle Source

- Current: `apps/supervisor-api/internal/lifecycle` 维护进程内 registry。
- Target: durable run store 维护 lifecycle。
- Progress: durable run lifecycle 已可通过 supervisor internal create / process /
  cancel 写入 store 和 run events；app-api durable-configured blocking 与 stream
  chat finalization 均通过 cursor polling 消费 durable `finalization.completed`
  event。
- Progress: browser reconnect / resume 已有 bounded subscription endpoint；
  public-chat pending-run product baseline 已接入 product surface，并按 terminal run
  event 后的 conversation truth 恢复消息。
- Progress: deployed app-api request scope now marks chat command execution as
  durable-required for `staging` and `production`; missing durable runtime or
  missing durable runtime config is a typed pre-accept failure, not a legacy
  execution path and not an accepted request finalized as a dependency error.
- Gap: 真实 staging reconnect / refresh evidence 仍未完成。

### Admission Source

- Current: `internal/admission.Controller` 维护进程内 active count 和 lane queues。
- Target: durable scheduler / lease coordinator 维护 run admission 和 execution
  lease。
- Gap: 多实例下预算不一致，queue 不持久。

### Queue

- Current: bounded in-memory queue，按 lane round-robin dispatch。
- Target: durable lane queue + lease heartbeat / expiry。
- Progress: queued durable runs 可被 lease coordinator 按 lane 获取，并可通过
  internal get/events query 审计；supervisor 已有显式启用的 durable worker loop，
  启动时同步 configured lane budget，并按 lane polling 消费 lease。
- Progress: durable store 已有 concurrent acquire contract：同一 queued run 在并发
  worker poll 下只能产生一个 active lease，另一方必须看到 explicit empty queue /
  budget gate；worker loop 遇到 lane budget backpressure 会保持常驻轮询，不把正常
  调度背压当成 fatal process error；同一不变量已在真实 Postgres store 上通过
  concurrent acquire test 覆盖，测试会清理自身 `pg-*` artifacts，避免持久 test DB
  中的历史 active lease 污染 lane budget。`cmd/durable-runtime-proof` 进一步把该证明
  产品化为 repo-owned evidence command：它读取当前 active lease truth 后设置 proof
  所需 lane budget、验证 multi-worker single-lease、释放自身 proof lease、验证
  expired-lease retry / terminal recovery，并在结束时恢复原 lane budget。
- Progress: schema readiness 不再靠 proof 副作用。`cmd/durable-runtime-schema`
  是正式 schema install/check 入口，staging start 在 compose up 前通过 Docker
  data-plane container 连到 `postgres:5432` 执行 `install` 与 `check`，并生成
  `durable-runtime-schema-install.json` /
  `durable-runtime-schema-check.json` evidence。
- Gap: 还没有 multi-worker retry/recovery staging evidence；browser chat submit
  stream 的 pending-run product baseline、typed run phase projection 与 repo-owned
  staging reconnect harness 已完成，但仍需真实 staging evidence closeout。

### Execution Lease

- Current: `admission.Lease` 是 Go 对象，`Release()` 释放本地计数。
- Target: durable `ExecutionLease` 带 owner、heartbeat、expiry、attempt。
- Progress: durable `ExecutionLease`、worker heartbeat、lane budget、lease
  acquire/release/expire 已有 in-memory 与 Postgres foundation；durable worker
  loop 的 `RunOnce` 会在领取 lease 前注册 ready heartbeat；worker executor 在
  active bridge execution 期间会续租 active lease、追加唯一 `lease.heartbeat`
  event，并在 heartbeat 失败时 fail closed 为 `lease_heartbeat_failed`；expired
  lease recovery 已接入独立 durable recovery loop 和显式 bounded retry policy，
  重试前重新入队并递增 attempt，达到上限后 terminal expire；run timeout 与
  queue timeout recovery 也由 scheduler-owned recovery path 执行，不依赖同一个
  正在执行 agent work 的 worker 再次进入 poll loop；worker 在 completion 事件写入前
  会重新读取当前 lease，发现 released / expired / owner drift 时直接 fail closed。
- Progress: Postgres-backed proof command 已证明 expired lease recovery 在真实
  Postgres store 上按 bounded retry policy 先 requeue、再 terminal
  `lease_expired`，并产出 JSON evidence。
- Gap: multi-worker expiry recovery 仍需 deployed staging / production
  verification；本地 Postgres proof 不能替代真实 worker crash / recovery 证据。

### Worker Execution

- Current: supervisor-api 同步调用 Python bridge；Python worker 处理一次 request。
- Target: worker pool 消费 durable lease 并写 run events。
- Progress: Python worker 已提供 `/internal/bridge/durable/execution`；Go bridge
  client 已提供 `ExecuteDurable`；supervisor internal executor 已能领取 lease、
  调用 durable worker endpoint，并写 `agent.*`、`run.*` 与 `lease.released`
  events；supervisor-api 已有可显式启用的常驻 durable worker loop；active
  execution 期间已执行 lease heartbeat renewal；worker loop 已接入 explicit
  bounded retry policy；bridge late success 不能覆盖已经 cancel / expired 的 run，
  也不能在 lease ownership drift 后写 browser-visible finalization；lane budget
  backpressure 不会杀死常驻 worker loop。
- Gap: multi-worker deployment verification 与 Postgres-backed staging evidence
  仍未完成。

### Streaming

- Current: `POST /api/v1/answer/stream` 是 supervisor internal SSE；app-api 投影为
  product SSE；durable-configured app-api stream path 已可通过 durable run event
  cursor polling 投影 `run.queued` / `run.started` / `finalization.completed`。
- Target: browser 订阅 `RunEvent`，断线不拥有 execution truth。
- Progress: browser resume endpoint 已可按 `after_sequence` 进行 bounded
  continuous run event subscription；chat submit stream 已通过 app-api
  `waitUntil` closeout 解除 browser stream consumer 对 finalization 的所有权；
  public-chat pending-run product baseline 已能保存 cursor、恢复 existing run event
  stream、禁止重发 prompt、terminal 后加载 conversation truth，并在 draft route 上
  replace 到 canonical conversation route。
- Gap: repo-owned 真实 staging 断线/重连 E2E harness 已完成；仍需在 deployed
  staging 上运行并保存 evidence。如果 polling budget 内没有 terminal finalization，
  chat submit stream 仍会 fail closed。

### Cancel

- Current: `POST /internal/execution/cancel` 对 active lifecycle 发 cooperative
  cancel。
- Target: explicit run cancel command 更新 durable run / lease / events。
- Progress: supervisor internal durable cancel command 已能取消 queued / active
  durable run 并追加 `run.canceled` event；app-api browser-facing
  `/api/chat/runs/:runId/cancel` 会先校验 `runtime.request_execution.run_id`
  ownership，再路由到 supervisor durable cancel；active durable run cancel 会释放
  active execution lease、追加 `lease.released`，并要求 bridge cancel propagation
  accepted 后才返回成功。
- Gap: long-running provider / agent delegate 对 cooperative cancel 的实际中断延迟仍需
  staging E2E 验证；multi-worker cancel ownership drift 仍需 production verification。

### Timeout

- Current: request timeout / bridge timeout 仍存在于 legacy HTTP execution path；durable
  recovery loop 已作为独立 scheduler-owned path 执行 timed-out run recovery。
- Target: run timeout、step timeout、lease expiry 分层。
- Progress: lane budget 中的 `queue_timeout` 与 `run_timeout` 已由 durable store /
  coordinator 消费；queued run 超过 queue timeout 会以 `queue_timeout` terminal
  expire，active run 超过 run timeout 会释放 active lease 并以 `run_timeout`
  terminal expire。
- Gap: step-level timeout 与 long-running delegate timeout propagation 仍需
  staging / production verification。

### Run Events

- Current: telemetry / execution audit / projection outbox 分散记录。
- Target: `RunEvent` 是 append-only canonical event stream。
- Progress: durable store 已有 append-only run events；internal events query 可读取
  sequence-ordered event projection；app-api durable adapter 已能读取 strict typed
  run event projection；app-api stream path 已能把 `run.queued` /
  `run.started` / `finalization.completed` 映射为 product stream events 并
  finalize request truth；app-api product event endpoint 已能返回 browser-visible
  run event projection；app-api browser resume stream 已可按 `after_sequence`
  输出 browser-visible run event projection，并等待后续事件直到 terminal 或订阅预算
  用尽。
- Gap: panel / eval 尚未消费 run events 作为统一事实源。

### Workflow Trace

- Current: `WorkflowRunStore` 记录 multi-step workflow / projections。
- Target: `WorkflowRun` 是 run 内部 graph projection，挂到 durable `Run`。
- Gap: answer-level run truth 与 workflow graph truth 未分层。

### Downstream Budgets

- Current: supervisor admission 不直接消费 Qdrant / Postgres / provider budgets。
- Target: scheduler 以 downstream budget 作为 lease admission 输入。
- Gap: 下游饱和无法被统一 admission 表达。

### Observability

- Current: metrics / OTel / audit 有 request/lane labels。
- Target: run / lease / lane / worker heartbeat 进入 operator-safe projection。
- Gap: 缺 run-centric panel/eval backlink。

## Code Evidence

### In-Process Lifecycle

- `apps/supervisor-api/internal/lifecycle/registry.go`
- `apps/supervisor-api/internal/httpapi/execution_runner.go`
- `apps/supervisor-api/internal/httpapi/structured_direct_lifecycle.go`

当前 lifecycle 在 supervisor process 内注册、transition、cancel、complete。

### In-Process Admission

- `apps/supervisor-api/internal/admission/limiter.go`
- `apps/supervisor-api/internal/config/config.go`
- `apps/supervisor-api/internal/httpapi/server.go`

当前 admission 使用 `SUPERVISOR_API_MAX_CONCURRENT_ANSWERS`、
`SUPERVISOR_API_QUEUE_CAPACITY`、`SUPERVISOR_API_QUEUE_TIMEOUT_MS` 与 per-lane
budgets，全部在单进程 controller 内生效。

### Current Request Projection

- `docs/contracts/app-api-request-lifecycle.md`
- `docs/data/app-api-schema.md`
- `apps/app-api/src/modules/runtime`

当前 app-api request truth 以 `runtime.request_execution` 与
`runtime.projection_outbox` 为 command-side truth；它不是 durable run scheduler。

### Current Workflow Foundation

- `apps/supervisor-api/internal/execution/workflow_run.go`
- `apps/supervisor-api/internal/execution/workflow_run_store.go`
- `apps/supervisor-api/internal/execution/workflow_run_postgres_store.go`

当前 `WorkflowRunStore` 约束 multi-step workflow trace、handoff chain、context
projection 与 agent invocation。它是 workflow graph foundation，不是 answer-level
durable run truth。

### Current Streaming

- `docs/contracts/app-api-request-lifecycle.md`
- `docs/contracts/app-api-supervisor-execution.md`
- `apps/supervisor-api/internal/httpapi/sse.go`

当前 durable-configured product SSE 可以通过 `after_sequence` cursor polling 消费
supervisor durable run events 后投影；browser-facing
`/api/chat/runs/:runId/events/stream` 已能按 cursor 恢复 browser-visible run event
bounded subscription stream，遇到 terminal event 后关闭；若订阅预算内没有新 terminal
event，client 必须用最后 sequence 重新连接。

## Phase 0 Closeout Judgment

当前实现可以继续作为 single-instance staging / early runtime protection，但不能作为最终
production agent concurrency architecture。

Phase 1 已冻结 durable runtime contract 与 logical schema。

Phase 2 / Phase 3 / Phase 4 foundation 已落地：

- `apps/supervisor-api/internal/execution/durable_runtime*.go`
  - `DurableRun`、`RunEvent`、`ExecutionLease`、`LaneBudget`、
    `WorkerHeartbeat` 的 isolated store kernel
  - durable lease coordinator；`AcquireNextExecutionLease` 会原子选择 queued
    run、推进 admitted/running、创建 lease 并写入 run events
  - in-memory contract substrate
  - Postgres store foundation 与 schema bootstrap
- `SUPERVISOR_API_DURABLE_RUNTIME_DATABASE_URL`
  - durable runtime Postgres store 的显式配置入口
  - 不从 `SUPERVISOR_API_WORKFLOW_RUN_DATABASE_URL` 或
    `CAMPUS_SHARED_POSTGRES_URL` 隐式推断

Phase 5 / Phase 6 / supervisor substrate 已部分落地：

- `apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/api.py`
  - `/internal/bridge/durable/execution`
  - 要求 `run_id`、`lease_id`、`step_id`、`lane`、`worker_id` 与 `attempt`
  - 缺 durable lease metadata 时 fail closed
- `apps/supervisor-api/internal/bridge/*`
  - `ExecuteDurable` 调用 Python durable worker endpoint
- `apps/supervisor-api/internal/httpapi/durable_worker_executor.go`
  - 领取 durable lease、调用 durable bridge、写 `agent.started` /
    `agent.completed` / `agent.failed`、run terminal event 与 `lease.released`
  - 对 RAG lane，supervisor 负责从 durable `execution_payload` 生成
    `rag-agent` handoff；app-api 不需要也不允许拥有 RAG handoff planning
- `apps/supervisor-api/internal/httpapi/durable_run_handlers.go`
  - internal create / get / events / cancel command-query substrate
  - create command 要求 `metadata.execution_payload`，并校验
    `request_id` / `conversation_id` / `trace_id` 与外层 durable run identity
    对齐
- `apps/supervisor-api/internal/httpapi/durable_worker_handlers.go`
  - explicit `process-next` command；当前不是后台 scheduler loop
- `apps/supervisor-api/internal/httpapi/durable_recovery_loop.go`
  - scheduler-owned recovery loop；只回收 expired lease / timed-out run，不领取
    lease、不调用 bridge、不执行 agent work
- `apps/app-api/src/modules/integration/supervisor-durable.ts`
  - app-api supervisor durable runtime adapter
  - 调用 supervisor internal create / get / events / cancel endpoint
  - strict 解析 durable run projection 与 run event projection
- `apps/app-api/src/modules/runtime-command/service.ts`
  - submit path 在 app-api accept 后创建 durable run
  - `metadata.execution_payload` 只携带 product request / context projection，不携带
    `handoff`
  - durable create 失败后 finalize request 为 typed app-api error truth，不保留悬空
    `accepted`
- `apps/app-api/src/modules/runtime-run/service.ts`
  - app-api product run status / events / cancel service
  - 先用本地 `runtime.request_execution.run_id` 校验 owner user，再调用 supervisor
    durable get / events / cancel
  - browser route 只返回 `visibility=browser` 的 run events，并要求 supervisor event
    sequence 按 requested cursor 单调前进
- `apps/app-api/scripts/chat-durable-e2e-staging.ts`
  - repo-owned staging durable reconnect harness：submit stream 在
    `request.accepted` 后主动断开，随后以 `run_id + after_sequence=0`
    订阅 existing run event stream，并验证 `finalization.completed`、run status
    与 conversation committed assistant message
- `apps/public-chat-web/src/platform/chat/pending-run.ts`
  - tab-scoped pending durable run state、cursor advance、terminal event handling
    与 conversation truth 校验
- `apps/public-chat-web/src/platform/chat/use-active-chat.tsx`
  - pending run product recovery：通过 existing run event stream 恢复，不重发
    prompt；terminal 后更新 conversation truth，并把 draft `/chat` 恢复到
    canonical `/chat/:conversationId`

当前仍未完成：

- deployed multi-worker lease consumption loop staging evidence
- pending-run real staging reconnect / refresh evidence closeout；当前真实
  staging accepted event 缺 durable `runId` / `runPhase`
- deployed multi-worker expired lease recovery / worker crash verification
- panel / eval 改为消费 run event truth
- staging E2E 证明 durable run create -> worker loop -> finalization event -> browser
  endpoint / stream closeout

当前不再缺：

- durable Postgres schema 的 repo-owned install/check path
- staging lifecycle 中 schema install/check 的 fail-closed gate
- proof command 与 schema command 的职责分离

Implementation 不得通过以下方式绕过本 gap matrix：

- 多开 supervisor 实例叠加本地 `max_concurrent`
- 把 in-memory queue 包装成 production queue
- 让 worker 直接决定全局 admission
- 用 telemetry sink 反推 run lifecycle truth
- 用 stream connection 状态反推 execution state
