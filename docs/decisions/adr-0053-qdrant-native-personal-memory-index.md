---
doc_type: decision
truth_scope: repository
owner_boundary: docs/decisions
decision_id: ADR-0053
status: superseded
created: 2026-06-10
updated: 2026-07-04
supersedes:
  - ADR-0015 memory ownership / confirmation / non-authz clauses
superseded_by:
  - adr-0057-zep-native-personal-memory-plane.md
  - adr-0058-hindsight-self-hosted-personal-memory-plane.md
---
# ADR-0053 Qdrant-Native Personal Memory Index

## 状态

Accepted on 2026-06-10. Superseded on 2026-06-16 by ADR-0057 Zep CE
Self-Hosted Personal Memory Plane, then by ADR-0058 Hindsight Self-Hosted
Personal Memory Plane.

本 ADR 只保留为 historical background。不得把本文中的 Qdrant collection、
`personal_memory_v1`、repo-owned extraction prompt / embedding 或 inferred memory
update 路径作为当前实现、目标架构或新代码引用。当前 personal memory truth 以
`docs/decisions/adr-0058-hindsight-self-hosted-personal-memory-plane.md` 与
`docs/architecture/system/memory-plane.md` 为准。

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
should tool in [requested_tool, any]
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
tool
canonical_key
canonical_subject
status
source
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

`memory_id` 必须表达 user / tenant / canonical memory identity，而不是 run-local
`source_hash` identity。`source_hashes` 只承担来源追踪，不能决定长期 memory 是否重复。

默认 inferred write contract：

```text
provider candidate
-> deterministic admission
-> canonical_key exact lookup
-> same-user same-tenant semantic duplicate query
-> create | refresh | merge | skip
-> Qdrant upsert
```

exact `canonical_key` match 刷新同一条 memory；semantic score `>= 0.92`
合并；`0.84 <= score < 0.92` 跳过并投影 `dedupe_review_required`。不得跨 user /
tenant 去重，也不得把 uncertain duplicate 作为新 memory 写入。

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
  high-confidence extraction、canonical dedupe / merge 与 compact payload validation
  约束。
- 外部 memory SDK 只作为参考，不作为 default runtime。
- Strong user governance、panel/eval influence tracing、full audit graph 与
  graph memory 不属于 v1 acceptance。

## 相关文档

- `docs/architecture/system/memory-plane.md`
- `docs/architecture/system/data-plane.md`
- `docs/architecture/system/durable-runtime.md`
- `docs/decisions/adr-0015-user-identity-memory-and-personalization-boundaries.md`
- `docs/decisions/adr-0048-temporal.md`
