---
doc_type: decision
truth_scope: repository
owner_boundary: docs/decisions
decision_id: ADR-0047
status: superseded
created: 2026-06-04
updated: 2026-06-08
replacement: adr-0048-temporal-execution-plane.md
---
# ADR-0047 Run And Step-Centric Durable Agent Runtime

## 状态

Accepted on 2026-06-04.

Superseded on 2026-06-06 by `adr-0048-temporal-execution-plane.md`.

本 ADR 只保留 PG-backed run-level durable baseline 与 run / step / event projection
语义的历史依据；长期 execution substrate 已改为 Temporal execution plane。branch tip 不再保留
PG lease runtime code、proof command 或 gap matrix。

## 背景

`campus-agent` 当前已经冻结了以下方向：

- `apps/app-api` 是 product-layer auth、session、principal、conversation 与 surface
  capability policy owner
- `apps/execution-control` 是 Docker-first internal execution engine
- `apps/supervisor-agent-worker` 是 private semantic worker
- supervisor 拥有 deterministic governance、workflow planning、admission、budget 与
  finalization
- deterministic data access 以 typed tool 参与执行；semantic specialist 以 agent-as-tool
  参与执行

当前历史 baseline 曾具备 Go `execution-control` 的 execution ingress、PG run-level
durable store、run events、execution leases、lane budgets、worker heartbeat、
lease coordinator、worker loop、recovery loop、cancel / timeout / recovery 与
app-api durable chat cutover。

该历史 baseline 当时暴露出的 production agent runtime 差距包括：

- run-level durable baseline 还没有扩展成 step-level durable ledger
- supervisor code domain 还没有拆成 control / scheduler / recovery / lane
  worker / autoscaler 部署职责
- multi-lane worker pool 与 worker autoscaler 还没有形成可审计 topology
- typed-tool agentic RAG 还没有把 planner、tool、retrieval、rerank、
  selection、synthesis 与 grounding 全部落成 durable step trajectory
- panel / eval / badcase / RAGAS 还没有统一消费 step-level sanitized projection

如果不正式冻结 run + step-centric run projection，后续实现很容易退回以下形态：

- 用负载均衡和多个 supervisor 实例冒充 production scheduler
- 在每个进程里维护各自的队列和 active count
- 让 worker 直接决定是否执行，而不是持有 durable lease
- 让同一个 conversation 的多个 active run 同时争写 context
- 让 panel / eval / tracing 继续从分散日志或 transient lifecycle 里拼接执行事实
- 让 Redis、K8s、provider trace 或 SDK graph 反向成为 execution truth

## 决策

### 决策 1：一次回答的 canonical execution object 是 `Run`

用户的一次回答执行必须建模为 durable `Run`。

固定生命周期为：

`created -> queued -> admitted -> running -> streaming -> completed / failed /
canceled / expired`

直接含义：

- HTTP request 只负责创建、查询、取消或订阅 run
- run state 必须可查询、可审计、可投影
- run terminal state 必须携带 terminal reason、business outcome、runtime versions 与 safe
  failure summary
- worker process、HTTP handler、goroutine 或 SSE connection 都不能成为 run truth owner

### 决策 2：production execution truth 由 Temporal run projection 拥有

production admission 和 execution dispatch 不得只存在于单个 `execution-control` 进程内存。

固定 owner：

- Temporal 拥有 workflow execution state、task queue、activity retry / timeout /
  heartbeat 与 signal / cancel delivery
- PG run / step projection store 拥有 sanitized product projection，不拥有 execution
  dispatch truth
- worker pool 只消费 Temporal activity task，不拥有 global admission truth
- `apps/execution-control` 继续拥有 deterministic control plane、workflow command/query、
  admission / policy gate、projection writeback 与 finalization

### 决策 3：process-local admission limiter 只保留为 runtime protection

当前 `EXECUTION_CONTROL_MAX_CONCURRENT_ANSWERS`、
`EXECUTION_CONTROL_QUEUE_CAPACITY` 与 `EXECUTION_CONTROL_QUEUE_TIMEOUT_MS` 表达的是当前
single-process protection。

解释固定为：

- 可以保留为本进程资源保护
- 可以保护 HTTP handler、bridge client、local worker dispatch 与 graceful drain
- 不得作为 production 全局并发预算 source of truth
- 不得用多个 supervisor 实例叠加本地预算来宣称已具备 production scheduler

### 决策 4：conversation 默认只允许一个 active primary run

conversation 是上下文、memory、authorization 与 committed history 的边界。

默认策略：

- 一个 conversation 同时最多一个 active primary run
- 第二条消息默认返回 `conversation_active_run`
- `enqueue`、`cancel_then_start`、`interrupt`、`rollback` 只能作为显式产品语义开启
- conversation context 只从 completed / committed run 进入下一轮

直接含义：

- 不允许多个 active run 同时写同一 conversation committed context
- 不允许 worker 在内部暗中合并、覆盖或取消另一个 active run
- 同会话并发策略必须进入 contract、observability 与 eval

### 决策 5：streaming 是 run event subscription，不是 execution ownership

长期 streaming 固定为：

`browser -> app-api stream endpoint -> run event subscription`

直接含义：

- SSE / WebSocket connection 断开不自动定义 run terminal state
- cancel 必须是显式 command
- client 可以通过 `run_id` 查询 terminal status 或恢复 event stream
- panel、eval 与 operator projection 应消费 sanitized run events 或其 read model

### 决策 6：lane 和 worker pool 是 durable scheduling 维度

当前 lane family：

- `rag`
- `notice`
- `navigation`
- `campus_services`
- `default`

lane 不只是 `execution-control` 内部计数器，而是 durable queue / lease / worker pool 的调度维度。

直接含义：

- RAG、notice、navigation 与 campus services 的执行预算必须可独立治理
- worker pool 横向扩展只能增加消费能力，不改变 run / step / lease 语义
- provider、Qdrant、Postgres、object store 等 downstream resource budget 必须成为 scheduler
  输入

### 决策 7：Postgres 是 canonical durable execution substrate

repo-owned canonical execution substrate 固定为：

`Postgres-backed run / step store + scheduler / lease coordinator`

原因：

- repo 已有 shared Postgres product/runtime schema boundary
- `apps/execution-control` 已冻结为 Docker-first internal execution service
- PG row lock、transaction、index 与 audit model 能表达 run / step / lease truth
- self-hosted data plane 已存在，不需要把 Redis 或 provider graph 推进 canonical queue path

Temporal、Cloudflare Workflows、Cloudflare Queues 或其他 durable execution
substrate 只能替换 implementation substrate，不能改变本 ADR 冻结的 conversation、run、step、
attempt、result、event、lane、lease 与 worker pool 语义。

### 决策 8：K8s 是 deployment substrate，不是 execution truth owner

K8s 可以调度 pod、resource、rollout、readiness 与 service discovery。

固定禁止：

- K8s 不拥有 workflow queue、activity queue、run projection、step projection、run event
  或 terminal state
- HPA / KEDA / CronJob 不能替代 Temporal execution substrate
- pod readiness 不能被解释成 step execution success

### 决策 9：worker autoscaler 只调整 capability worker replicas

`worker-autoscaler` 只能读取 Temporal task queue backlog / schedule-to-start
latency / poller health、downstream budget projection 与当前 worker replica
observation，并输出 workflow / activity worker desired replica count。

固定禁止：

- autoscaler 不写 workflow state、run projection、step projection、event projection
  或 terminal state
- autoscaler 不改变 downstream budget 或 execution policy
- autoscaler 不基于 raw prompt、raw provider trace 或 raw source body 做决策

### 决策 10：domain capability 默认 tools-first

notice、services、navigation 与 retrieval-domain deterministic data access 默认表现为
typed tool 或 projection-backed internal query service。semantic specialist 只能作为
agent-as-tool 参与 typed step。

直接含义：

- `notice`、`campus_services`、`navigation` 等 label 表示 semantic
  specialist family，不表示 source truth owner
- supervisor 只调度 typed step，不调用自由 agent
- RAG 目标形态是 durable planner-first typed-tool agentic RAG

## 结果

直接结果如下：

- 新增 `docs/architecture/system/durable-agent-runtime-architecture.md`
- `target-architecture.md` 必须把 run + step-centric run projection 写为
  production execution shape
- `current-architecture.md` 当时需要明确已具备 run-level durable baseline，同时列出
  step-level ledger、role split、lane worker pool 与 autoscaler 差距
- `durable-agent-runtime-architecture.md` 必须区分 durable run / step store、scheduler、
  lease coordinator、worker roles 与 process-local limiter
- `tool-and-capability-runtime-architecture.md` 必须区分 tools-first domain capability
- `product-runtime-architecture.md` 必须把 browser streaming 改写成 run event subscription
  语义
- `capability-routing-and-admission-architecture.md` 必须把 admission 拆成 surface、
  identity/quota、run admission、execution lease admission
- `agentic-retrieval-architecture.md` 必须把 RAG 写成 durable typed-tool agentic RAG

## 非目标

本 ADR 不决定：

- 具体 schema 名称、migration 文件或索引设计
- worker pool 的机器规格或 autoscaling 阈值
- 是否把 deployment substrate 放到 K8s
- 长任务产品 UX 的完整交互细节

## Complementary Decisions

本 ADR complements：

- `docs/decisions/adr-0006-agent-orchestration-and-safety.md`
- `docs/decisions/adr-0012-shared-app-api-and-worker-web-surfaces.md`
- `docs/decisions/adr-0013-app-api-worker-runtime.md`
- `docs/decisions/adr-0015-user-identity-memory-and-personalization-boundaries.md`
- `docs/decisions/adr-0017-supervisor-internal-execution-admission.md`
- `docs/decisions/adr-0042-capability-neutral-supervisor-routing-and-surface-capability-policy.md`
- `docs/decisions/adr-0043-execution-control-docker-first-runtime.md`

本 ADR 不 supersede 上述 ADR；它补充 production agent execution substrate 的 run projection
truth，并冻结 PG-backed step-level execution queue / lease / result model。
