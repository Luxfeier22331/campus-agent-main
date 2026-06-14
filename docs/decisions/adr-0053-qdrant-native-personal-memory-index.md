---
doc_type: decision
truth_scope: repository
owner_boundary: docs/decisions
decision_id: ADR-0053
status: accepted
created: 2026-06-10
updated: 2026-06-10
supersedes:
  - ADR-0015 memory ownership / confirmation / non-authz clauses
---
# ADR-0053 Qdrant-Native Personal Memory Index

## 状态

Accepted on 2026-06-10.

## 背景

当前 memory MVP 曾采用 `app-api -> PG profile.memory_items -> context.profile_memory`
全量注入。这条路径有三个问题：

- 每次 chat 都读 PG profile memory，且缺少 relevance selector。
- online execution 无法把 memory recall 作为 Temporal-visible step 诊断。
- PG product projection 被误当成 online memory retrieval truth。

仓库已经拥有 self-hosted authenticated Qdrant private data-plane；把 personal memory 建成独立
Qdrant collection，比引入外部 memory SDK 或继续全量 PG 注入更符合当前 execution / data-plane
架构。

## 决策

接受 `personal_memory_v1` 作为默认 personal memory index：

- self-hosted Qdrant 是 personal memory retrieval substrate。
- personal memory collection 与 institutional RAG collection 隔离。
- online recall 由 `execution-control` Temporal `memory.recall` activity 执行。
- app-api 不再在 chat hot path 读取并全量注入 PG profile memory。
- `memory.recall` 输出 bounded memory context，供 planning、RAG 和
  deterministic tools 消费。

默认 query contract：

```text
must user_id = actor.user_id
must status = active
should capability in [requested_capability, any]
dense query from user_goal + session slots
top_k default 5
compact_text budget default 1200 chars
```

payload contract：

```text
memory_id
user_id
tenant_id
memory_type
capability
status
source
compact_text
updated_at
```

## Superseded ADR-0015 条款

ADR-0015 仍保留 identity / authorization / raw-state minimization 决策。

以下 memory 相关旧口径被本 ADR 替代：

- app-api owns canonical online memory truth。
- PG profile memory 是 online recall truth。
- inferred candidates 必须 pending 且用户确认后才可生效。
- memory 只能影响 personalization，不能影响 routing / admission / applicability。
- run memory refs 是 v1 mandatory evidence。

保留的边界：

- memory 不能伪造 verified identity claim。
- memory 不能绕过 restricted visibility / entitlement。
- personal memory 不能写入 institutional knowledge index。
- raw transcript、raw provider response、auth material 不得进入 memory compact payload。

## 结果

- `ChatAnswerWorkflow` step graph 从 `memory.recall` 开始。
- app-api profile-memory API 可以暂时保留为 manual product surface /
  migration source，但不再定义 online recall。
- Qdrant data-plane TLS / read-only query key posture 同时适用于 personal memory recall；
  explicit memory upsert / disable 由 execution-control internal command 使用
  `QDRANT_WRITE_API_KEY` 写入 personal memory index。
- inferred memory update 作为 finalization 后置 activity / workflow 执行；首版自动生效为
  `status=active`、`source=inferred`，但必须受 `context.memory.enabled` gate、
  high-confidence extraction 与 compact payload validation 约束。
- 外部 memory SDK 只作为参考，不作为 default runtime。
- Strong user governance、panel/eval influence tracing、full audit graph 与
  graph memory 不属于 v1 acceptance。

## 相关文档

- `docs/architecture/system/memory-plane-architecture.md`
- `docs/architecture/system/data-plane-architecture.md`
- `docs/architecture/system/durable-agent-runtime-architecture.md`
- `docs/decisions/adr-0015-user-identity-memory-and-personalization-boundaries.md`
- `docs/decisions/adr-0048-temporal-execution-plane.md`
