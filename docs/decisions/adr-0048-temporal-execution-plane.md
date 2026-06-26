---
doc_type: decision
truth_scope: repository
owner_boundary: docs/decisions
decision_id: ADR-0048
status: accepted
created: 2026-06-06
updated: 2026-06-08
supersedes:
  - adr-0047-run-centric-durable-agent-runtime.md
---
# ADR-0048 Temporal Execution Plane

## 状态

Accepted on 2026-06-06.

本 ADR supersedes `adr-0047-run-centric-durable-agent-runtime.md` 对长期 execution
substrate 的 PG scheduler / lease queue 决策。ADR-0047 仍保留为当前 PG run-level durable
baseline 与历史设计依据。

## Terminology Superseded

本 ADR 使用 `execution-control` / Temporal worker plane 作为 active target
terminology。旧文档、legacy contract 或历史 symbol 中的 `supervisor` 在目标态映射为
`Execution Agent Layer`，不再作为独立 worker、Python bridge 或 active architecture
concept。

## 背景

`campus-agent` 的目标系统需要支持 consumer-scale 多用户并发、长运行 agent workflow、
取消 / 恢复 / 重试、worker 横向扩展、step trajectory 诊断、operator projection 与
eval/badcase 闭环。

此前 repo 已有 Go `apps/execution-control` 的 PG-backed run-level durable baseline：
run store、events、execution leases、lane budgets、worker heartbeat、worker loop、
recovery loop 与 app-api durable chat cutover。当前 active serving path 已硬切到
Temporal-backed `execution-control` run command/query seam；PG 只承载 sanitized product
projection，旧 durable baseline 只保留为 migration artifact，不再作为 online execution
queue truth。继续自研 step-level scheduler、lease recovery、worker autoscaling 与 workflow
history 会把大量精力投入到通用 durable execution kernel，而不是产品能力、capability
contract 与质量闭环。

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
-> execution-control
-> Temporal execution plane
-> workflow / activity worker pools
-> capability packages + data plane
-> sanitized projection / finalization
-> app-api stream / final response
```

## 决策细节

### 决策 1：`execution-control` 是 Temporal client owner

`apps/app-api` 不直接对接 Temporal。

`execution-control` 负责：

- trusted machine ingress from app-api
- capability admission closeout
- workflow template selection
- Temporal workflow start / signal / cancel / query / update
- run correlation 与 projection command
- fail-close terminal mapping

`execution-control` 不负责：

- product-layer auth/session/conversation truth
- browser-facing surface policy ownership
- capability source truth
- worker autoscaling decision
- panel/eval canonical read model

当前实现名仍是 `apps/execution-control`。长期概念名收口为 `execution-control`；代码目录是否重命名是后续
implementation work，不改变本 ADR 的架构边界。

### 决策 1A：当前 Temporal SDK owner 使用 Go SDK

当前 `execution-control` Temporal integration 使用 Temporal Go SDK。

原因：

- `apps/execution-control` 已是 Go-owned runtime boundary，Go SDK 与当前
  workflow / activity worker、HTTP command seam、projection activity 和 Go RAG
  runtime 同语言收口
- Temporal Go SDK 是当前可用于生产级 workflow / activity / worker / test-suite
  的稳定 SDK surface
- Temporal Rust SDK 当前仍不作为本仓库的默认 production SDK 选择；在 Rust SDK
  正式 release 前，不把 execution plane 切到 Rust

未来只有同时满足以下条件，才重新评估切换 Rust SDK：

- Temporal Rust SDK 已正式 release，且官方能力覆盖本仓库需要的 workflow /
  activity worker、client start / cancel、interceptor / telemetry 与 testing
  surface
- 针对本仓库真实 workload 的 profiling 证明 Rust SDK 在 CPU、memory 或 tail latency
  上有明确资源收益
- 切换不会破坏 `execution-control` 对 repo-owned DTO、sanitized projection、
  OpenTelemetry redaction 与 operator-safe evidence 的 owner boundary

没有上述证据时，不因为“Rust 可能更省资源”提前迁移 SDK。

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
- capability admission and ToolSpec / CapabilitySpec policy
- source-truth ownership
- final answer contract
- sanitized step / event / result projection
- Operator Console / eval / badcase read model
- observability redaction policy

Temporal history is not the product query source for Operator Console/eval.
Operator Console and eval consume repo-owned sanitized projection derived from
workflow/activity progress.

### 决策 3：Postgres remains product and projection truth

Postgres 不再作为长期 canonical execution queue / lease scheduler。

Postgres continues to own：

- conversations
- request ledger
- product run projection
- sanitized run events
- step trajectory projection
- final answer projection
- Operator Console read model
- eval / badcase / golden dataset projection
- source truth and release catalog where already assigned

Direct PG `FOR UPDATE SKIP LOCKED` queue consumption is current baseline /
migration evidence, not target execution substrate.

### 决策 4：Task Queue 替代 repo 自建 lane lease queue

长期 lane / capability worker pool 映射到 Temporal Task Queue。

第一组 target task queue family：

- `campus-agent.workflow`
- `campus-agent.activity.context`
- `campus-agent.activity.knowledge.plan`
- `campus-agent.activity.knowledge.retrieval`
- `campus-agent.activity.knowledge.synthesis`
- `campus-agent.activity.notice`
- `campus-agent.activity.navigation`
- `campus-agent.activity.campus_services`
- `campus-agent.activity.finalization`
- `campus-agent.activity.projection`

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
- execution-control pods
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

### 决策 9：RAG step boundary 必须是真实 DTO/activity 边界

2026-06-08 补充评估：

- 当前 online chat path 已经进入 Temporal-backed `CapabilityExecutionWorkflow`。
- 当前主问答 trajectory 已接入 Temporal-visible primary agent graph：
  `context.memory_recall -> agent.primary -> finalization.write`，或由
  `agent.primary` 选择 `knowledge_query` workflow signal 后进入 Go-owned RAG
  graph：`rag.plan -> retrieval.indexed_lookup ->
  retrieval.expand_or_rescue -> evidence.selection -> synthesis ->
  grounding.verify -> finalization.write`。
- `plan.route` 只保留为 retained deterministic support path / historical
  planning artifact；它不再是 ordinary chat 的第一模型决策入口。
- Go `activity-worker-knowledge-plan`、`activity-worker-knowledge-retrieval` 与
  `activity-worker-knowledge-synthesis` 分别拥有 RAG planning / evidence
  selection / grounding、online Qdrant / embedding lookup、synthesis provider
  execution，并通过 repo-owned DTO、`provider_execution_summary_v1` 与 step
  attempt evidence 记录 lookup latency、provider request ref、latency、token、
  estimated cost、cancel / timeout outcome。
- Python `supervisor-agent-worker` 不再参与 online answer path；它只保留 offline /
  eval / tooling / historical bridge reference。

本 ADR 冻结以下判断：

1. `semantic.rag` 已从 active workflow graph 退役，不得作为 serving fallback 或
   compatibility branch 恢复。
1. 真实 RAG boundary 不等于投影更多 step 名称；每个 durable step 必须有
   repo-owned DTO input / output、Temporal Activity boundary、sanitized
   `RunStep -> StepAttempt -> StepResult` projection、明确 failure / cancel /
   timeout ownership。
1. RAG target graph 固定为：

   ```text
   memory.recall
   -> planning
   -> rag.plan
   -> retrieval.indexed_lookup
   -> retrieval.expand_or_rescue
   -> evidence.selection
   -> synthesis
   -> grounding.verify
   -> finalization.write
   ```

1. `synthesis` 只能消费 bounded supporting evidence projection，不得消费 raw prompt、
   raw provider response、raw source body 或 SDK-native trace。
1. `grounding.verify` 必须成为 Temporal-visible durable step；在真实 verifier
   输出 claim / list-item support、source span、coverage 与 unsupported branch
   之前，不得把 default `grounded` 当作证明。
1. Python 不再作为 online stage backend 被 activity 调用；不得拥有 online
   provider cancellation、token/cost accounting、workflow step truth、projection
   truth 或 top-level semantic orchestration。
1. Rust rewrite 不是默认下一步；只有 step-level latency / CPU profiling 证明某个
   retrieval、selection、ranking 或 grounding stage 是 CPU 热点后，才允许把该 stage
   迁入 Rust 或单独高性能 service。

### 决策 10：当前 Temporal SDK posture 保持 Go SDK

当前 production execution plane 继续使用 Temporal Go SDK。原因不是 Rust 语言或
Temporal Rust SDK 被长期排除，而是当前 `execution-control`、workflow worker、activity
worker、RAG runtime、projection writer、OpenTelemetry interceptor 与 cancel / timeout
evidence spine 已经是 Go-owned implementation boundary；把 canonical execution plane
迁到 Rust SDK 会同时改变 runtime owner、worker implementation boundary 与 observability
integration。

截至 2026-06-26，Temporal Rust SDK / Rust Client 官方仓库仍标注为 Public Preview。它不得作为
`campus-agent` online durable orchestration 的默认替代方案。

未来只有同时满足以下条件，才应重新评估 Rust SDK 迁移：

1. Temporal Rust SDK / Rust Client 已进入官方稳定 / GA posture，而不是 Public Preview。
1. 基于 `campus-agent` 真实 workflow / activity workload 的 profile 证明
   Rust SDK worker 在 CPU、内存、tail latency 或 pod density 上有明确、
   可重复的资源消耗优势。
1. 迁移方案能保持 existing Temporal workflow semantics、sanitized projection、
   OpenTelemetry / Langfuse trace、activity cancel / timeout outcome 与
   operator read model 不回退。
1. 迁移以整条 worker pool 或清晰 stage boundary 为单位进行，不新增双 SDK
   compatibility path、serving fallback 或长期混合 owner。

#### Step Contract Skeleton

本 ADR 只冻结 boundary 不变量，不冻结最终 package 路径或字段全集。后续实现计划必须把
以下 DTO family 落成 repo-owned contract，并由 tests 固定 raw payload 禁止项：

- `RagPlanProjection`：admitted query mode、scope、collection / profile refs、
  evidence budget、no-widening policy、required evidence contract。
- `RetrievalLookupRequest` / `RetrievalLookupResult`：authorized filter refs、
  retrieval profile refs、query activity summary、candidate summary、Qdrant /
  retrieval latency、timeout outcome。
- `RetrievalRescueRequest` / `RetrievalRescueResult`：只表达已 admission 的 parent
  context expansion、freshness branch、same-document support 或 rescue branch，不扩大
  query-enabled surface。
- `EvidenceSelectionResult`：answer-bearing evidence refs、span refs、bounded excerpts、
  rejection reasons、coverage status、payload hash。
- `RagSynthesisPacketProjection`：由 Go `EvidenceSelectionResult` assembly 得到；
  不得由 Python bridge 黑盒直接产出。
- `GroundingVerificationResult`：claim / list-item support verdict、unsupported fields、
  source trust summary、clarification / fail-close branch。
- `FinalizationPacket`：final answer projection input、source refs、policy closeout、
  user-facing event material。

#### Implemented Direction

- DTO family 先由 Go `apps/execution-control/internal/ragruntime` 拥有；只有出现稳定跨语言消费需求时
  才提升到 shared contract。
- stage backend 直接迁入 Go implementation；不新增 Python stage endpoint。
- `retrieval.indexed_lookup` 使用 Go Qdrant native adapter，连接 self-hosted
  authenticated private data-plane。
- `grounding.verify` 先采用 Go deterministic verifier，输出 sanitized support verdict；
  不把默认 `grounded` 当作证明。
- Panel / eval 读取 PG sanitized step projection，不读取 Temporal history、raw provider
  trace、raw prompt 或 raw source body。

#### Falsifier

如果实现评估证明：

- stage DTO 无法在不泄漏 raw prompt、raw source body、raw provider response 或 auth
  material 的情况下表达 required semantics；或
- step split 导致 online latency / operational complexity 明显恶化，且 step-level
  evidence 不能改善 eval、badcase、cancel 或 autoscaling 决策；

则应先设计更小的 semantic stage backend contract，而不是继续机械拆 activity。

## 结果

- `docs/architecture/target-architecture.md` 以
  `app-api -> execution-control -> Temporal` 作为长期拓扑。
- `docs/architecture/system/durable-agent-runtime-architecture.md` 以 Temporal
  execution plane 取代 PG scheduler / lease coordinator 作为 target runtime substrate。
- `docs/architecture/system/durable-agent-runtime-architecture.md` 负责
  execution-control、Temporal workflow worker 与 activity worker pools 的 target
  runtime roles。
- `docs/contracts/durable-agent-runtime-contract.md` 与
  `docs/data/durable-agent-runtime-schema.md` 中的 run / step / event 表述必须被
  解释为 repo-owned product projection / eval truth，而不是 Temporal 的内部
  workflow history 替代品。
- ADR-0047 的 target substrate 决策被本 ADR supersede；其当前 PG baseline 描述继续保留历史价值。

## 非目标

本 ADR 不决定：

- 立即重命名 `apps/execution-control` 目录
- Temporal Cloud 还是 self-hosted Temporal
- Temporal SDK 的永久最终选择；当前 posture 是 Go SDK，Rust SDK 迁移条件见“决策 10”
- worker image 拆分数量
- 具体 autoscaling 阈值
- 具体 migration 顺序

## 参考

- [Temporal Workflows](https://docs.temporal.io/workflows)
- [Temporal Activities](https://docs.temporal.io/activities)
- [Temporal Task Queues](https://docs.temporal.io/task-queue)
- [Temporal Workers](https://docs.temporal.io/workers)
- [Temporal Visibility](https://docs.temporal.io/visibility)
- [Temporal Go SDK](https://github.com/temporalio/sdk-go)
- [Temporal Rust SDK](https://github.com/temporalio/sdk-rust)
