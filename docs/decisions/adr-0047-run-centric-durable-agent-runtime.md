---
doc_type: decision
decision_id: ADR-0047
status: accepted
created: 2026-06-04
updated: 2026-06-04
---
# ADR-0047 Run-Centric Durable Agent Runtime

## 状态

Accepted on 2026-06-04.

## 背景

`campus-agent` 当前已经冻结了以下方向：

- `apps/app-api` 是 product-layer auth、session、principal、conversation 与 surface
  capability policy owner
- `apps/supervisor-api` 是 Docker-first internal execution engine
- `apps/supervisor-agent-worker` 是 private semantic worker
- supervisor 长期拥有 deterministic governance、workflow planning、admission、budget 与
  finalization
- domain agents 作为 bounded specialist 参与执行

当前实现已经有 Go `supervisor-api` 的 in-process lifecycle registry、global /
per-lane admission、bounded queue、timeout、cancel、drain、bridge circuit breaker
与 observability seam。

但该实现仍然暴露出 production agent runtime 的核心缺口：

- in-process queue 不是 durable execution queue
- active count 不是跨实例全局 admission truth
- HTTP request lifetime 仍强绑定 agent execution lifetime
- 多开 supervisor 实例只会复制本地预算，不会产生统一调度语义
- conversation 内并发消息缺少显式 product/runtime contract
- streaming connection 仍容易被误读成 execution truth

如果不正式冻结 run-centric durable runtime，后续实现很容易退回以下形态：

- 用负载均衡和多个 supervisor 实例冒充 production scheduler
- 在每个进程里维护各自的队列和 active count
- 让 worker 直接决定是否执行，而不是持有 durable lease
- 让同一个 conversation 的多个 active run 同时争写 context
- 让 panel / eval / tracing 继续从分散日志或 transient lifecycle 里拼接执行事实

## 决策

### 决策 1：一次回答的 canonical execution object 是 `Run`

长期上，用户的一次回答执行必须建模为 durable `Run`。

固定生命周期为：

`created -> queued -> admitted -> running -> streaming -> completed / failed /
canceled / expired`

直接含义：

- HTTP request 只负责创建、查询、取消或订阅 run
- run state 必须可查询、可审计、可投影
- run terminal state 必须携带 terminal reason、business outcome、runtime versions 与 safe
  failure summary
- worker process、HTTP handler、goroutine 或 SSE connection 都不能成为 run truth owner

### 决策 2：production execution truth 由 durable runtime 拥有

长期上，production admission 和 execution lease 不得只存在于单个
`supervisor-api` 进程内存。

固定 owner：

- durable run store 拥有 run lifecycle
- scheduler / lease coordinator 拥有 run admission 与 execution lease
- worker pool 只消费 lease，不拥有 global admission truth
- `apps/supervisor-api` 继续拥有 deterministic control plane、scheduler adapter、
  workflow planning、budget decision 与 finalization

### 决策 3：process-local admission limiter 只保留为 runtime protection

当前 `SUPERVISOR_API_MAX_CONCURRENT_ANSWERS`、
`SUPERVISOR_API_QUEUE_CAPACITY` 与 `SUPERVISOR_API_QUEUE_TIMEOUT_MS` 表达的是当前
single-process protection。

长期解释固定为：

- 可以保留为本进程资源保护
- 可以保护 HTTP handler、bridge client、local worker dispatch 与 graceful drain
- 不得作为 production 全局并发预算 source of truth
- 不得用多个 supervisor 实例叠加本地预算来宣称已具备 production scheduler

### 决策 4：conversation 默认只允许一个 active primary run

长期上，conversation 是上下文、memory、authorization 与 committed history 的边界。

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

长期上，lane 不只是 `supervisor-api` 内部计数器，而是 durable queue / lease / worker pool
的调度维度。

直接含义：

- RAG、notice、navigation 与 campus services 的执行预算必须可独立治理
- worker pool 横向扩展只能增加消费能力，不改变 run / lease 语义
- provider、Qdrant、Postgres、object store 等 downstream resource budget 必须成为 scheduler
  输入

### 决策 7：初期 substrate 采用 Postgres-backed durable scheduler

本 ADR 不绑定长期 vendor substrate，但当前 repo 的优先落地路径固定为：

`Postgres-backed run store + scheduler / lease coordinator`

原因：

- repo 已有 shared Postgres product/runtime schema boundary
- `apps/supervisor-api` 已冻结为 Docker-first internal execution service
- self-hosted staging / early production data plane 已存在
- Postgres-backed scheduler 能在单机内先落地 durable semantics，又不把架构锁死
  在本地进程

Temporal、Cloudflare Workflows、Cloudflare Queues 或其他 durable execution
substrate 可以作为后续 implementation upgrade。它们只能替换 execution
substrate，不能改变本 ADR 冻结的 conversation、run、event、lane、lease 与
worker pool 语义。

## 结果

直接结果如下：

- 新增 `docs/architecture/system/durable-agent-runtime-architecture.md`
- `target-architecture.md` 必须把 run-centric durable runtime 写为长期 production execution
  shape
- `current-architecture.md` 必须明确当前 in-process queue / admission 是 current implementation
  truth，不是最终 production scheduler
- `execution-and-agents-architecture.md` 必须区分 durable run store / scheduler / lease
  coordinator / process-local limiter
- `product-runtime-architecture.md` 必须把 browser streaming 改写成 run event subscription
  语义
- `capability-routing-and-admission-architecture.md` 必须把 admission 拆成 surface、
  identity/quota、run admission、execution lease admission

## 非目标

本 ADR 不决定：

- 具体 schema 名称、migration 文件或索引设计
- worker pool 的部署数量、机器规格或 autoscaling 策略
- 是否立即引入 Temporal、Cloudflare Workflows 或 Cloudflare Queues
- 当前 staging 是否必须在本轮改造成 durable scheduler
- 长任务产品 UX 的完整交互细节

## Complementary Decisions

本 ADR complements：

- `docs/decisions/adr-0006-agent-orchestration-and-safety.md`
- `docs/decisions/adr-0012-shared-app-api-and-worker-web-surfaces.md`
- `docs/decisions/adr-0013-app-api-worker-runtime.md`
- `docs/decisions/adr-0015-user-identity-memory-and-personalization-boundaries.md`
- `docs/decisions/adr-0017-supervisor-internal-execution-admission.md`
- `docs/decisions/adr-0042-capability-neutral-supervisor-routing-and-surface-capability-policy.md`
- `docs/decisions/adr-0043-supervisor-api-docker-first-runtime.md`

本 ADR 不 supersede 上述 ADR；它补充 production agent execution substrate 的 durable runtime
truth。
