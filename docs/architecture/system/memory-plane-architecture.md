---
doc_type: architecture
status: active
created: 2026-06-09
updated: 2026-06-10
---
# Memory Plane Architecture

本文冻结 `campus-agent` 的 Qdrant-native Personal Memory Plane。它描述目标边界和当前
实现方向；当前 merged implementation 的细节仍以 `../current-architecture.md` 与代码事实为准。

## Positioning

Memory Plane 的目标是让少量个人长期信息成为 online execution 可检索的 context，而不是把
PG profile memory 全量塞进 prompt。

Personal memory 是 per-user advisory context，不是身份、授权、source truth、capability
opening 或 fail-close truth。它可以帮助 follow-up、偏好、常用地点 / 服务 / 别名消歧、query
framing 与回答措辞；不能决定用户能使用哪些工具、能读取哪些 source、是否放宽 evidence requirement，或是否拥有 operator
surface 权限。

长期 owner 固定为：

- `apps/execution-control` owns online memory recall execution.
- Temporal orchestrates `memory.recall` and later memory update / extraction workflows.
- self-hosted Qdrant owns `personal_memory_v1` retrieval substrate.
- `apps/app-api` may expose manual profile-memory product API, but it no
  longer owns online recall.
- PostgreSQL profile memory tables are product projection / migration source
  during transition, not online recall truth.

因此：

- online chat hot path 不再执行 `app-api -> PG profile.memory_items -> context.profile_memory`
  full injection。
- personal memory 与 institutional RAG index 必须隔离 collection，不共享 canonical retrieval
  truth。
- Zep、Graphiti、LightMem、Mem0、A-MEM 只能作为 external reference，不是默认 runtime
  dependency 或 canonical owner。
- Temporal 不是 memory database；Temporal 只编排 activity / workflow
  lifecycle，memory vectors 与 compact payload 存在 self-hosted Qdrant。

## Memory Index

默认 personal memory collection：

```text
personal_memory_v1
```

payload 固定为：

```text
memory_id
user_id
tenant_id
memory_type: profile | goal | preference | session_summary | task_state
capability: knowledge | campus_services | notice | navigation | any
status: active | stale | disabled
source: explicit | inferred | imported
compact_text
updated_at
```

`compact_text` 是 online context 唯一可消费的 personal memory 文本字段。它必须是压缩后的短
文本，不得是 raw transcript、raw user profile row、raw provider trace 或 unrestricted notes。

## Online Recall Flow

目标 online path：

```text
user request
-> app-api creates execution run without PG memory full injection
-> execution-control starts CapabilityExecutionWorkflow
-> Temporal memory.recall activity
-> Qdrant personal_memory_v1
-> bounded memory context
-> planning / RAG / deterministic tools
-> sanitized run step projection
```

`memory.recall` 是 capability-neutral execution step graph 的第一步，不属于 RAG
worker 的私有前置逻辑：

```text
context.memory_recall
-> plan.route
-> capability branch
-> finalization.write
```

online recall 查询规则：

- `must user_id = actor.user_id`
- `must status = active`
- `should capability in [requested_capability, any]`
- dense vector query from `user_goal + session slots`
- default `top_k = 5`
- default total `compact_text` budget = 1200 chars

`memory.recall` output:

```text
selected_memory_count
selected_memory_chars
memory_context_items[]
```

每个 item 只包含：

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

v1 先支持 explicit memory indexing：

```text
POST /api/me/profile-memory/items
-> app-api validates product command
-> execution-control internal memory upsert command or background worker
-> embedding
-> Qdrant personal_memory_v1 upsert
```

PG `profile.memory_items` 可以暂时保留为 manual UI projection / migration source；它不再定义
online recall 行为。

后续 inferred update path：

```text
run completed
-> Temporal MemoryUpdateWorkflow
-> extract compact memory
-> dedupe / classify / budget
-> embedding
-> Qdrant personal_memory_v1 upsert
```

用户 accept / reject / edit 不是 v1 必需项。若未来产品需要强治理，可以在 app-api product
surface 上加，但不得把它重新变成 online recall 的前置硬条件。

## Data-Plane Boundary

Qdrant posture 继承 `data-plane-architecture.md`：

- self-hosted authenticated private data-plane
- staging / production 必须使用 HTTPS
- online recall 使用 `QDRANT_QUERY_API_KEY`
- app-api manual profile-memory write 调用 execution-control internal memory command；
  execution-control 使用 `QDRANT_WRITE_API_KEY` 写入 personal memory index
- background memory update / rebuild 使用 `QDRANT_WRITE_API_KEY` 或 ops-scoped
  admin key
- authenticated HTTPS data-plane 必须配置 `QDRANT_TLS_CA_CERT_PATH`
- `PERSONAL_MEMORY_COLLECTION=personal_memory_v1`

personal memory collection 与 institutional RAG collection 只在 substrate 层共享 Qdrant，不共享
collection、payload contract、release alias 或 ingestion truth。

## Not This

Memory Plane 不是：

- Zep / Graphiti / LightMem / Mem0 / A-MEM 的组合架构。
- Temporal-backed memory database。
- compliance-style full audit system。
- hidden agent self-editing memory。
- app-api 每次 chat 读取 PG profile memory 并全量注入。
- 把个人 memory 写进 institutional Qdrant index。

## Guardrails

- Do not reintroduce PG all-memory injection into chat submit.
- Do not make app-api read private Qdrant directly.
- Do not adopt an external memory SDK as canonical owner.
- Do not let RAG / provider adapters write long-term memory inline during answer
  synthesis.
- Do not store raw transcript as personal memory compact text.
- Do not use memory as authorization truth, capability-opening truth, source truth,
  or fail-close override.
- Do not require panel/eval memory influence tracing as v1 acceptance.
