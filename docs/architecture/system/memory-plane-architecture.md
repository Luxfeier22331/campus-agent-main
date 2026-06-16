---
doc_type: architecture
truth_scope: execution
owner_boundary: execution-control
status: active
created: 2026-06-09
updated: 2026-06-16
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
canonical_key
canonical_subject
status: active | stale | disabled
source: explicit | inferred | imported
compact_text
confidence
reason_code
source_hashes
first_seen_at
last_seen_at
merge_count
supersedes_memory_ids
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
-> first Execution Agent decision determines whether memory/tool context is needed
-> Temporal memory.recall activity
-> Qdrant personal_memory_v1
-> bounded memory context
-> planning / RAG / deterministic tools
-> sanitized run step projection
```

`memory.recall` 是 capability-neutral execution step，不属于 RAG worker 的私有前置逻辑；
但目标态不要求每个 product identity / no-tool direct answer 都先做 memory recall：

```text
first_decision
-> optional context.memory_recall
-> capability routing / workflow planning
-> capability branch when needed
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
-> provider-backed structured extraction from sanitized execution packet
-> deterministic admission / classify / budget
-> canonical key resolution / dedupe / merge decision
-> embedding
-> Qdrant personal_memory_v1 upsert
```

当前落地策略：

- inferred memory 首版自动生效，写入 `status=active`、`source=inferred`。
- 自动提取只消费 completed run 的 sanitized execution payload /
  projection summary；不得消费 raw transcript、raw provider response、
  tool raw payload 或 institutional source text。
- 抽取只接受用户当轮明确表达的长期偏好、近期目标、常用地点 / 服务上下文或稳定称呼；一次性问题、临时安排、制度 /
  通知事实、身份权限与不确定推断必须跳过。
- 自动抽取消费 app-api active provider-config role
  `personal_memory_extraction`。execution-control 不从 `PROMPT_RUNTIME_*` env
  读取 online memory extraction API key / model；缺 active profile 或 provider
  response contract 不完整时 fail closed，并留下可诊断 activity failure。
- provider 只产出候选；写入准入仍由 execution-control deterministic gate
  决定。gate 要求 `confidence >= 0.9`、合法 `memory_type` /
  `capability`、合法 `reason_code`、非空 `source_hash`、非空
  `canonical_subject` 与 compact payload 校验通过。
- `canonical_subject` 由 provider 输出，execution-control 本地派生
  `canonical_key = memory_type + ":" + capability + ":" + normalized(canonical_subject)`。
  `source_hash` 只用于来源追踪和审计，不参与长期 memory identity。
- 写入前必须先做 per-user / per-tenant dedupe：
  - exact `canonical_key` 命中 active / stale memory 时，刷新同一条 memory，不创建新
    point。
  - 无 exact 命中时，在同用户 / 同租户、同 `memory_type` 且 capability compatible 的
    active / stale memory 中做 dense similarity 查询。
  - similarity `>= 0.92` 时合并到既有 memory；`0.84 <= score < 0.92`
    时跳过并记录 `dedupe_review_required`；低于该阈值时创建新 memory。
  - dedupe 不得跨 user / tenant，不得查询或写入 institutional RAG collection。
- merge 不拼接 `compact_text`。确定包含关系时保留更完整文本；需要语义融合时必须走结构化
  provider merge，并重新通过 deterministic gate。merge 输出无效时跳过写入并投影
  `merge_failed`。
- `source_hashes` 累积去重，`first_seen_at` 保留首次写入时间，
  `last_seen_at` / `updated_at` 记录最近刷新时间，`merge_count` 记录同一长期 memory 被刷新 /
  合并的次数。
- memory update 是 finalization 后的后置 workflow / activity；失败只写可诊断 step projection，不回滚已经完成的主回答。
- `context.memory.enabled` 是自动写入 gate。gate 缺失或为 false 时必须跳过自动写入；不得通过
  PG profile memory item 全量注入来推断 gate。
- memory update projection 只记录 count、hash、skip reason 与 memory id 摘要，不记录
  `compact_text` 原文。

用户 accept / reject / edit 不是当前自动生效策略的前置条件。本阶段不提供人工 review
queue；不能自动判定的相似候选必须 fail closed 并跳过写入。若未来产品需要强治理，可以在
app-api product surface 上增加候选确认或用户可见 inferred item projection，但不得把它重新变成 online recall
的前置硬条件。

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
- online memory recall / upsert embedding provider config comes from the active
  app-api provider-config role `personal_memory_embedding`; online memory
  extraction prompt provider config comes from `personal_memory_extraction`;
  `EMBEDDING_*` / `PROMPT_RUNTIME_*` env is local/ingestion/eval seed, not online
  serving truth
- personal memory collection dense vector schema must match the active
  `personal_memory_embedding.dimensions`; mismatch fails closed

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
