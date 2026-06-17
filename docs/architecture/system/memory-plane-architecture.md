---
doc_type: architecture
truth_scope: execution
owner_boundary: execution-control
status: active
created: 2026-06-09
updated: 2026-06-18
---
# Memory Plane Architecture

本文冻结 `campus-agent` 的 Hindsight self-host Personal Memory Plane。当前个人记忆不再
使用 Qdrant collection、repo-owned LLM extraction prompt、personal memory embedding
profile 或 provider-backed memory extraction eval；Qdrant 只承载 institutional RAG。

## Positioning

Personal memory 是 per-user advisory context，用于 follow-up、偏好、常用地点 / 服务、
别名消歧、query framing 与回答措辞。它不是身份、授权、source truth、capability opening
或 fail-close truth，不能决定用户能使用哪些工具、能读取哪些 source，不能放宽 evidence
requirement，也不能授予 operator surface 权限。

长期 owner 固定为：

- `apps/execution-control` owns online memory recall execution and append command.
- Temporal orchestrates `context.memory_recall` and `memory.append`.
- Hindsight owns personal memory extraction, graph storage, dedupe / merge
  semantics and recall.
- `apps/app-api` owns user-facing manual profile-memory product API and PG projection.
- PostgreSQL `profile.memory_items` stores product projection and the Hindsight
  document id runtime reference; it is not online recall truth.

因此：

- online chat hot path 不再执行 `app-api -> PG profile.memory_items ->
  context.profile_memory` full injection。
- personal memory 与 institutional RAG 完全分离：personal memory 走 Hindsight runtime，
  institutional RAG 走 Qdrant / retrieval-core。
- execution-control 不维护个人记忆向量 schema、collection alias、embedding compatibility
  check、repo-owned extraction prompt 或 extraction threshold。
- Temporal 不是 memory database；Temporal 只编排 activity / workflow lifecycle。

## Hindsight Runtime

Hindsight runtime 以独立自托管服务部署，`campus-agent` 只通过官方 Go SDK 消费
Hindsight HTTP API。Hindsight API、Hindsight worker、PostgreSQL / pgvector 与
embedding / LLM provider 是 Hindsight deployment 内部组件，不是 `campus-agent`
业务代码或 `packages/contracts` 的集成边界。

Hindsight runtime 的 execution-control internal env projection 为：

```text
PERSONAL_MEMORY_BASE_URL
PERSONAL_MEMORY_API_SECRET
PERSONAL_MEMORY_OWNER_SALT
```

`personal_memory.runtime`、`personal_memory.timeout_seconds`、
`personal_memory.recall_limit` 与 `personal_memory.recall_max_chars` 由
execution-control runtime profile 管理，不再通过 env 配置。

Hindsight API 使用 `HINDSIGHT_API_TENANT_EXTENSION` /
`HINDSIGHT_API_TENANT_API_KEY` 做 service-to-service auth；`PERSONAL_MEMORY_API_SECRET`
就是 execution-control 对 Hindsight API 的 bearer token。Hindsight LLM / embedding /
reranker provider 配置属于 Hindsight deployment secret，不通过 app-api
provider-config proxy 间接投影。

`PERSONAL_MEMORY_BASE_URL` 默认由 deployment profile 投影为 internal service DNS，例如
Docker Compose 内的 `http://hindsight-api:8888`。`PERSONAL_MEMORY_API_SECRET` 与
`PERSONAL_MEMORY_OWNER_SALT` 由 local / staging lifecycle 首次生成并持久化到
ops-owned generated env file；开发者不需要手工填写这些内部值。只有部署到外部
Hindsight endpoint 或轮换 secret / salt 时才应显式覆盖。

local dev 的 self-host runtime secret 由
`infra/local/scripts/ensure-runtime-secrets.mjs` 生成到
`infra/local/.generated/runtime.env`。staging lifecycle 生成到 runtime dir 下的
`secrets/runtime.env`。这些文件属于对应环境 runtime，不进入 repo-tracked env。

`PERSONAL_MEMORY_OWNER_SALT` 用于把 `tenant_id + user_id` 派生为 scoped Hindsight
bank id，并把 scoped bank id + 产品侧 `conversation_id` 派生为 Hindsight
conversation document id。
local / staging / production 都必须持有稳定 salt。产品侧 user id / conversation id
不得直接作为 Hindsight runtime id；sanitized projection 只保留产品侧 `thread_id` /
`conversation_id`，不暴露 internal Hindsight bank id。

当前单校区产品 profile 的默认 product tenant 固定为 `tenant-main`，由 app-api
代码内约定写入 durable execution payload 与 internal personal-memory command；开发者不
需要为该 tenant 手工配置 env。后续若引入多租户，必须先提升为明确 product identity
contract，而不是让各调用点自行传空字符串或猜默认值。

retired env 必须 fail closed：

```text
ZEP_BASE_URL
ZEP_API_KEY
ZEP_PROJECT_SALT
ZEP_TIMEOUT_SECONDS
ZEP_RECALL_MAX_CHARS
ZEP_ASSISTANT_NAME
ZEP_USER_NAME
PERSONAL_MEMORY_COLLECTION
PERSONAL_MEMORY_TOP_K
PERSONAL_MEMORY_MAX_CHARS
PERSONAL_MEMORY_SCORE_THRESHOLD
```

retired provider-config roles：

```text
personal_memory_extraction
personal_memory_embedding
```

## Online Recall Flow

目标 online path：

```text
user request
-> app-api creates execution run without PG memory full injection
-> execution-control starts CapabilityExecutionWorkflow
-> first Execution Agent decision determines whether memory/tool context is needed
-> Temporal context.memory_recall activity
-> Hindsight recall scoped to actor bank
-> bounded memory context
-> planning / RAG / deterministic tools
-> sanitized run step projection
```

`memory.recall` 是 capability-neutral execution step，不属于 RAG worker 的私有前置逻辑；
目标态也不要求每个 product identity / no-tool direct answer 都先做 memory recall。

`context.memory.enabled` 是 recall gate。gate 缺失或为 false 时
`context.memory_recall` 必须投影为 skipped，不调用 Hindsight，也不向 primary agent /
RAG graph 传入 `memory_context` 或 `memory_ref`。gate 为 true 时才构造 Hindsight recall
request。recall query 由 `user_goal` 加确定性排序后的 confirmed `session_slots` 组成。

recall request 必须包含：

```text
run_id
tenant_id
user_id
user_goal
requested_capability
session_slots
```

recall result 只投影 sanitized context：

```text
schema_version = memory_recall_result_v1
memory_ref
selected_memory_count
selected_memory_chars
memory_context_items[]
payload_sha256
```

每个 context item 只包含：

```text
memory_id
memory_type
capability
compact_text
score
updated_at
```

RAG / synthesis 可以消费 bounded memory context 来影响 follow-up、applicability、query
framing、answer defaults 和 wording。它不得用 memory 打开未开放 capability / collection、
放宽 source trust、覆盖 fail-close、伪造 account / session truth，或替代 institutional
evidence。

## Write / Update Flow

### Completed Turn Append

completed run 后置写入走 Temporal `AppendConversationMemoryActivity`：

```text
finalization.write completed
-> memory.append
-> read sanitized execution payload and final answer projection
-> derive scoped Hindsight bank/document id from tenant + user + conversation
-> Hindsight retain completed turn document
-> sanitized memory.append step projection
```

`context.memory.enabled` 是自动写入 gate。gate 缺失或为 false 时必须跳过 append；不得通过
PG profile memory item 全量注入来推断 gate。

completed-turn append 对 Hindsight 使用 async retain，因此成功语义是 `accepted`，不是
`completed`。append 属于 final answer 后置 side-effect；Hindsight/config/request 失败不反向
失败最终回答，但必须写入 `memory.append` failed step projection 并进入 metrics。

append projection 只记录：

```text
schema_version = memory_conversation_append_result_v1
status
thread_id
appended_message_count
payload_sha256
skip_reasons
failure_kind
```

不得在 projection、Temporal activity result 或 eval artifact 中保存 raw transcript、
provider raw response、tool raw payload、Hindsight raw payload 或 unrestricted notes。

execution-control `/metrics` 暴露 personal memory 的 bounded-label 指标：

```text
campus_execution_control_personal_memory_operations_total{operation,outcome,failure_kind}
campus_execution_control_personal_memory_operation_duration_ms{operation}
campus_execution_control_personal_memory_selected_items_count{operation}
campus_execution_control_personal_memory_selected_chars_count{operation}
```

这些指标不得包含 user id、tenant id、run id、conversation id、memory id 或 raw text。

`/internal/memory/personal/turns:append` 与 `/internal/memory/personal/graph:recall`
只服务 internal worker / runtime smoke。它们用于 Hindsight live gate 直接验证 append、recall
和 user isolation，不是 browser-facing API，也不替代 Temporal production workflow。

### Explicit Profile Memory

用户显式 profile memory 仍是 app-api 产品面，但 app-api 不知道 Hindsight API、Qdrant 或
embedding。

```text
POST /api/me/profile-memory/items
-> app-api validates product command
-> execution-control /internal/memory/personal/items:upsert
-> Hindsight retain profile document
-> execution-control returns episode_uuid
-> app-api stores episode_uuid in PG projection
```

删除 item：

```text
DELETE /api/me/profile-memory/items/:id
-> app-api loads runtime_episode_uuid from PG projection
-> execution-control /internal/memory/personal/items:disable
-> Hindsight document delete
-> app-api marks PG projection disabled
```

删除 owner / RTBF：

```text
profile memory owner delete
-> execution-control /internal/memory/personal/owner:disable
-> Hindsight bank delete
-> app-api projection follows product retention policy
```

`episode_uuid` 是 runtime/internal ref。当前 Hindsight profile memory 使用
`profile:<memory_id>` document id 作为该 ref。它可以存在 PG projection 和 internal
command payload；
不得暴露给 browser-facing profile-memory item response。

## Eval And Acceptance

repo-owned memory eval profile 是 `hindsight-memory-product-path`，不是
`personal-memory-extraction`。该 profile 覆盖：

- completed turn append
- cross-thread recall
- explicit profile memory upsert
- explicit profile memory disable
- owner disable / RTBF
- user isolation

runtime collector 只记录 schema、status、hash 与字段级 token，不保存 raw transcript、
provider raw response、Hindsight raw payload 或 API key。runtime collector 必须实际调用
internal append、recall、explicit profile upsert / disable 与 owner disable endpoint；不得用
`not_collected` 或离线 fixture 冒充 live smoke。离线 gate 消费 sanitized observations；
runtime gate 需要 `EXECUTION_CONTROL_BASE_URL` 与 `API_WORKER_SHARED_SECRET`。

## Data-Plane Boundary

Hindsight posture：

- personal memory graph storage / extraction / dedupe / merge / recall 由 Hindsight
  承担。
- execution-control 通过官方 Go SDK 消费 Hindsight HTTP API，不把 Hindsight SDK 类型泄漏进
  `packages/contracts`。
- staging / local compose 默认使用内网 `http://hindsight-api:8888`；只有外接
  Hindsight endpoint 时才需要覆盖 URL，外部 endpoint 必须使用 HTTPS。
- `PERSONAL_MEMORY_API_SECRET` 只注入需要 personal memory 的 execution-control
  runtime role：`execution-control` 与 `activity-context`。local / staging lifecycle
  负责生成并持久化该值。
- `PERSONAL_MEMORY_BASE_URL`、`PERSONAL_MEMORY_API_SECRET` 与
  `PERSONAL_MEMORY_OWNER_SALT` 是 deployment projection，不是开发者手工配置项；
  `runtime`、timeout 与 recall limits 由 execution-control runtime profile 管理。
- `activity-knowledge-plan` / `activity-knowledge-synthesis` 不要求 Hindsight 配置；
  `activity-knowledge-retrieval` 只在需要 query-side recall runtime 时加载 Hindsight
  connectivity；knowledge worker 消费的是 bounded memory context，不拥有 memory
  substrate。

Qdrant posture：

- Qdrant 只承载 institutional RAG / retrieval data plane。
- Qdrant personal memory collection、`personal_memory_v1`、personal memory
  embedding role 和 Qdrant personal memory schema install/check 已退休。

## Not This

Memory Plane 不是：

- Qdrant-backed personal memory collection。
- repo-owned memory extraction prompt / threshold / provider compare harness。
- Temporal-backed memory database。
- compliance-style full audit system。
- hidden agent self-editing memory。
- app-api 每次 chat 读取 PG profile memory 并全量注入。
- 把个人 memory 写进 institutional Qdrant index。

## Guardrails

- Do not reintroduce PG all-memory injection into chat submit.
- Do not make app-api call Hindsight API or private vector store directly.
- Do not reintroduce `personal_memory_extraction` or `personal_memory_embedding`.
- Do not let RAG / provider adapters write long-term memory inline during answer
  synthesis.
- Do not store raw transcript as personal memory compact text.
- Do not use memory as authorization truth, capability-opening truth, source truth,
  or fail-close override.
- Do not require panel/eval memory influence tracing as v1 acceptance.
