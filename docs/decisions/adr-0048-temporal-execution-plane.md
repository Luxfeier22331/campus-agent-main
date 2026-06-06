---
doc_type: decision
decision_id: ADR-0048
status: accepted
created: 2026-06-06
updated: 2026-06-06
supersedes:
  - adr-0047-run-centric-durable-agent-runtime.md
---
# ADR-0048 Temporal Execution Plane

## 状态

Accepted on 2026-06-06.

本 ADR supersedes `adr-0047-run-centric-durable-agent-runtime.md` 对长期 execution
substrate 的 PG scheduler / lease queue 决策。ADR-0047 仍保留为当前 PG run-level durable
baseline 与历史设计依据。

## 背景

`campus-agent` 的目标系统需要支持 consumer-scale 多用户并发、长运行 agent workflow、
取消 / 恢复 / 重试、worker 横向扩展、step trajectory 诊断、operator projection 与
eval/badcase 闭环。

当前 repo 已有 Go `apps/execution-gateway` 的 PG-backed run-level durable baseline：
run store、events、execution leases、lane budgets、worker heartbeat、worker loop、
recovery loop 与 app-api durable chat cutover。但继续自研 step-level scheduler、lease recovery、worker
autoscaling 与 workflow history 会把大量精力投入到通用 durable execution kernel，而不是产品能力、
capability contract 与质量闭环。

Temporal 的职责边界正好落在 execution plane：Workflow 承接确定性编排与 history，Activity
承接外部 / 非确定性工作，Task Queue 连接 Temporal Service 与 worker，worker poll task queue
推进 workflow/activity，retry、timeout、heartbeat、signal、query、update、visibility 等能力由
Temporal execution substrate 提供。

## 决策

`campus-agent` 长期接受 Temporal 作为 canonical execution plane。

目标主链路固定为：

```text
browser surfaces
-> app-api
-> execution-gateway
-> Temporal execution plane
-> workflow / activity worker pools
-> capability packages + data plane
-> sanitized projection / finalization
-> app-api stream / final response
```

## 决策细节

### 决策 1：`execution-gateway` 是 Temporal client owner

`apps/app-api` 不直接对接 Temporal。

`execution-gateway` 负责：

- trusted machine ingress from app-api
- capability admission closeout
- workflow template selection
- Temporal workflow start / signal / cancel / query / update
- run correlation 与 projection command
- fail-close terminal mapping

`execution-gateway` 不负责：

- product-layer auth/session/conversation truth
- browser-facing surface policy ownership
- capability source truth
- worker autoscaling decision
- panel/eval canonical read model

当前实现名仍是 `apps/execution-gateway`。长期概念名收口为 `execution-gateway`；代码目录是否重命名是后续
implementation work，不改变本 ADR 的架构边界。

### 决策 2：Temporal 拥有 execution truth

Temporal owns：

- Workflow execution state and history
- Workflow and Activity task queues
- worker dispatch through task queue polling
- retry, timeout, timer and heartbeat mechanics
- signal / query / update delivery
- child workflow orchestration
- schedule and visibility substrate

Repo owns：

- product auth/session/conversation truth
- request/run product projection
- capability admission and ToolSpec / AgentSpec policy
- source-truth ownership
- final answer contract
- sanitized step / event / result projection
- panel / eval / badcase read model
- observability redaction policy

Temporal history is not the product query source for panel/eval. Panel and eval
consume repo-owned sanitized projection derived from workflow/activity progress.

### 决策 3：Postgres remains product and projection truth

Postgres 不再作为长期 canonical execution queue / lease scheduler。

Postgres continues to own：

- conversations
- request ledger
- product run projection
- sanitized run events
- step trajectory projection
- final answer projection
- operator panel read model
- eval / badcase / golden dataset projection
- source truth and release catalog where already assigned

Direct PG `FOR UPDATE SKIP LOCKED` queue consumption is current baseline /
migration evidence, not target execution substrate.

### 决策 4：Task Queue 替代 repo 自建 lane lease queue

长期 lane / capability worker pool 映射到 Temporal Task Queue。

第一组 target task queue family：

- `agent.workflow`
- `agent.activity.rag`
- `agent.activity.notice`
- `agent.activity.navigation`
- `agent.activity.campus_services`
- `agent.activity.finalization`
- `agent.activity.projection`

Task Queue 切分按 capability / resource / latency profile，而不是按 UI surface。

### 决策 5：worker autoscaling 调 worker replicas，不写 execution truth

worker autoscaler 可以读取：

- Temporal task queue backlog / poller / schedule-to-start 指标
- workflow / activity latency and timeout metrics
- downstream provider / Qdrant / Postgres / object store budget projection
- repo-owned product SLO and lane policy

worker autoscaler 只能输出 worker replica desired count。它不得写 workflow state、
run projection、step projection、terminal state 或 capability policy。

### 决策 6：K8s 是 substrate only

K8s 调度：

- Temporal service pods if self-hosted
- execution-gateway pods
- workflow worker pods
- activity worker pods
- resource requests / limits
- rollout / readiness / liveness

K8s 不拥有：

- workflow history
- task queue truth
- run terminal state
- product conversation truth
- capability admission
- panel/eval projection truth

### 决策 7：Redis 不进入 canonical execution queue

Redis 只允许作为：

- cache
- non-authoritative wakeup
- live fanout acceleration
- derived counter
- rate-limit adjunct where product policy still has a durable owner

Redis 不得作为 workflow / activity task queue、run queue、step queue、lease store
或 terminal truth。

### 决策 8：RAG / notice / navigation / services are capabilities

RAG、notice、navigation、services 都通过 Temporal workflow 中的 typed activity /
agent-as-tool activity 参与。

RAG 不作为 product entry agent 或 global router；它是 knowledge-family capability
内部的 agentic retrieval specialist。notice / navigation / services 默认
tools-first，只有需要语义消歧、摘要、跨工具编排或 answer shaping 时才表现为
agent-as-tool。

## 结果

- `docs/architecture/target-architecture.md` 以
  `app-api -> execution-gateway -> Temporal` 作为长期拓扑。
- `docs/architecture/system/durable-agent-runtime-architecture.md` 以 Temporal
  execution plane 取代 PG scheduler / lease coordinator 作为 target runtime substrate。
- `docs/architecture/system/execution-and-agents-architecture.md` 的 target runtime
  roles 改为 execution-gateway、Temporal workflow worker 与 activity worker pools。
- `docs/contracts/durable-agent-runtime-contract.md` 与
  `docs/data/durable-agent-runtime-schema.md` 中的 run / step / event 表述必须被
  解释为 repo-owned product projection / eval truth，而不是 Temporal 的内部
  workflow history 替代品。
- ADR-0047 的 target substrate 决策被本 ADR supersede；其当前 PG baseline 描述继续保留历史价值。

## 非目标

本 ADR 不决定：

- 立即重命名 `apps/execution-gateway` 目录
- Temporal Cloud 还是 self-hosted Temporal
- Temporal SDK 语言最终选择
- worker image 拆分数量
- 具体 autoscaling 阈值
- 具体 migration 顺序

## 参考

- [Temporal Workflows](https://docs.temporal.io/workflows)
- [Temporal Activities](https://docs.temporal.io/activities)
- [Temporal Task Queues](https://docs.temporal.io/task-queue)
- [Temporal Workers](https://docs.temporal.io/workers)
- [Temporal Visibility](https://docs.temporal.io/visibility)
