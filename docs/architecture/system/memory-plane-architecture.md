---
doc_type: architecture
truth_scope: execution
owner_boundary: execution-control
status: active
created: 2026-06-09
updated: 2026-06-16
---
# Memory Plane Architecture

本文冻结 `campus-agent` 的 Zep-native Personal Memory Plane。当前个人记忆不再
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
- Zep owns personal memory extraction, graph storage, dedupe / merge semantics and
  graph search.
- `apps/app-api` owns user-facing manual profile-memory product API and PG projection.
- PostgreSQL `profile.memory_items` stores product projection and the Zep `episode_uuid`
  runtime reference; it is not online recall truth.

因此：

- online chat hot path 不再执行 `app-api -> PG profile.memory_items ->
  context.profile_memory` full injection。
- personal memory 与 institutional RAG 完全分离：personal memory 走 Zep user graph，
  institutional RAG 走 Qdrant / retrieval-core。
- execution-control 不维护个人记忆向量 schema、collection alias、embedding compatibility
  check、repo-owned extraction prompt 或 extraction threshold。
- Temporal 不是 memory database；Temporal 只编排 activity / workflow lifecycle。

## Zep Runtime

Zep runtime 的 execution-control 配置项为：

```text
ZEP_BASE_URL
ZEP_API_KEY
ZEP_PROJECT_SALT
ZEP_TIMEOUT_SECONDS
ZEP_RECALL_MAX_CHARS
ZEP_ASSISTANT_NAME
ZEP_USER_NAME
```

`ZEP_PROJECT_SALT` 用于把 `tenant_id + user_id` 派生为 scoped Zep user id，并把 scoped
user id + 产品侧 `conversation_id` 派生为 internal Zep thread id。未配置时使用可读形式，
便于 local/dev 诊断。staging / production 必须配置 salt。产品侧 user id /
conversation id 不得直接作为 Zep runtime id；sanitized projection 只保留产品侧
`thread_id` / `conversation_id`，不暴露 internal Zep id。

retired env 必须 fail closed：

```text
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
-> Zep graph search scoped to actor user
-> bounded memory context
-> planning / RAG / deterministic tools
-> sanitized run step projection
```

`memory.recall` 是 capability-neutral execution step，不属于 RAG worker 的私有前置逻辑；
目标态也不要求每个 product identity / no-tool direct answer 都先做 memory recall。

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
-> derive scoped Zep user/thread id from tenant + user + conversation
-> Zep thread.add_messages(user + assistant)
-> ignore assistant role for graph extraction
-> sanitized memory.append step projection
```

`context.memory.enabled` 是自动写入 gate。gate 缺失或为 false 时必须跳过 append；不得通过
PG profile memory item 全量注入来推断 gate。

append projection 只记录：

```text
schema_version = memory_conversation_append_result_v1
status
thread_id
appended_message_count
payload_sha256
skip_reasons
```

不得在 projection、Temporal activity result 或 eval artifact 中保存 raw transcript、
provider raw response、tool raw payload、Zep raw graph payload 或 unrestricted notes。

`/internal/memory/personal/turns:append` 与 `/internal/memory/personal/graph:recall`
只服务 internal worker / runtime smoke。它们用于 Zep live gate 直接验证 append、recall
和 user isolation，不是 browser-facing API，也不替代 Temporal production workflow。

### Explicit Profile Memory

用户显式 profile memory 仍是 app-api 产品面，但 app-api 不知道 Zep SDK、Qdrant 或 embedding。

```text
POST /api/me/profile-memory/items
-> app-api validates product command
-> execution-control /internal/memory/personal/items:upsert
-> Zep graph.add user episode
-> execution-control returns episode_uuid
-> app-api stores episode_uuid in PG projection
```

删除 item：

```text
DELETE /api/me/profile-memory/items/:id
-> app-api loads runtime_episode_uuid from PG projection
-> execution-control /internal/memory/personal/items:disable
-> Zep episode.delete
-> app-api marks PG projection disabled
```

删除 owner / RTBF：

```text
profile memory owner delete
-> execution-control /internal/memory/personal/owner:disable
-> Zep user.delete
-> app-api projection follows product retention policy
```

`episode_uuid` 是 runtime/internal ref。它可以存在 PG projection 和 internal command payload；
不得暴露给 browser-facing profile-memory item response。

## Eval And Acceptance

repo-owned memory eval profile 是 `zep-memory-product-path`，不是
`personal-memory-extraction`。该 profile 覆盖：

- completed turn append
- cross-thread recall
- explicit profile memory upsert
- explicit profile memory disable
- owner disable / RTBF
- user isolation

runtime collector 只记录 schema、status、hash 与字段级 token，不保存 raw transcript、
provider raw response、Zep raw graph payload 或 API key。runtime collector 必须实际调用
internal append、recall、explicit profile upsert / disable 与 owner disable endpoint；不得用
`not_collected` 或离线 fixture 冒充 live smoke。离线 gate 消费 sanitized observations；
runtime gate 需要 `EXECUTION_CONTROL_BASE_URL` 与 `API_WORKER_SHARED_SECRET`。

## Data-Plane Boundary

Zep posture：

- personal memory graph storage / extraction / dedupe / merge / search 由 Zep 承担。
- execution-control 只消费 Zep SDK / API，不把 Zep 类型泄漏进 `packages/contracts`。
- staging / production 必须使用 HTTPS Zep endpoint。
- `ZEP_API_KEY` 只注入需要 personal memory 的 execution-control runtime role：
  `execution-control` 与 `activity-context`。
- `activity-knowledge` 不要求 Zep 配置；knowledge worker 消费的是 bounded memory context，
  不是 memory substrate。

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
- Do not make app-api call Zep SDK or private vector store directly.
- Do not reintroduce `personal_memory_extraction` or `personal_memory_embedding`.
- Do not let RAG / provider adapters write long-term memory inline during answer
  synthesis.
- Do not store raw transcript as personal memory compact text.
- Do not use memory as authorization truth, capability-opening truth, source truth,
  or fail-close override.
- Do not require panel/eval memory influence tracing as v1 acceptance.
