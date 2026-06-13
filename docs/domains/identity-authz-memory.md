---
doc_type: index
truth_scope: product
owner_boundary: apps/app-api
status: active
created: 2026-04-12
updated: 2026-06-12
---
# Identity / Authz / Memory Domain

## 先看什么

- 架构总边界：`../architecture/system/identity-and-authorization-architecture.md`
- 产品/runtime owner split：`../architecture/system/product-runtime-architecture.md`
- 当前 merged truth：`../architecture/current-architecture.md`
- 通用执行态入口：`README.md`

## 长期边界与决策

- `../architecture/system/identity-and-authorization-architecture.md`
- `../decisions/adr-0015-user-identity-memory-and-personalization-boundaries.md`
- `../decisions/adr-0049-qdrant-native-personal-memory-index.md`

## Contract 与 Data

- `../contracts/app-api-http.md`
- `../contracts/capability-execution.md`
- `../data/app-api-schema.md`

## 执行路由

- 当前 merged truth 统一看 `../architecture/current-architecture.md` 与
  `../architecture/system/identity-and-authorization-architecture.md`
- 当前 pending work 统一看 `README.md` 定义的通用执行态入口与 GSD SDK / Codex native
  session
- 受限文档、学生 / 教职工差异化 capability 权限与 legacy ACL rollout 已退出当前主问答产品目标；
  如需追溯，只能作为 historical ADR 阅读

## Historical References

- historical background:
  `../decisions/adr-0022-campus-identity-and-restricted-document-authorization.md`
- historical background:
  `../decisions/adr-0034-authorization-model-and-retrieval-filter-projection.md`

These ADRs are superseded background only; current identity, authorization and
memory boundaries are owned by the architecture documents listed above.

## Follow-up Entry Points

- memory / personalization productization：当前尚无 live workstream；恢复时必须新开
  GSD SDK / Codex native session，并把长期结论提升到 docs / ADR / runbook，不得复用已关闭的
  foundation plan

## Memory Productization Landing Rule

后续 memory / personalization productization 的落地顺序固定为：

1. `execution-control` / Temporal 拥有 online `memory.recall` step。
2. Qdrant `personal_memory_v1` 承接 personal memory retrieval；PG profile memory 只保留为
   manual product projection / migration source。
3. `app-api` chat hot path 不读取 PG profile memory 并全量注入
   `context.profile_memory`。
4. planning / RAG / deterministic tools 只消费 bounded compact memory context；
   不得读取 raw memory、raw transcript、raw auth material 或产品层数据库对象。
5. personalization 可以影响 follow-up、applicability、retrieval planning、ranking /
   disambiguation、clarification 与 answer wording；不得伪造 source truth、capability
   opening truth、account / session truth 或 fail-close override。

这些规则只定义恢复 productization 时的执行入口和验收口径，不表示当前 memory productization 已经上线。

## 相关领域

- `operator-observability.md`
  - operator panel 只消费 app-owned operator access、audit 与 quality projections
