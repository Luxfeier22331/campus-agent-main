---
doc_type: index
status: active
created: 2026-04-12
updated: 2026-06-10
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
- `../decisions/adr-0022-campus-identity-and-restricted-document-authorization.m
  d`
- `../decisions/adr-0034-authorization-model-and-retrieval-filter-projection.md`

## Contract 与 Data

- `../contracts/app-api-http.md`
- `../contracts/capability-execution.md`
- `../data/app-api-schema.md`

## 执行路由

- 当前 merged truth 统一看 `../architecture/current-architecture.md` 与
  `../architecture/system/identity-and-authorization-architecture.md`
- 当前 pending work 统一看 `README.md` 定义的通用执行态入口与 GSD SDK / Codex native
  session
- foundation 文档只保留为关闭态基线；restricted rollout、legacy ACL sunset 与后续 memory
  productization 统一从下面的 follow-up 入口进入

## Follow-up Entry Points

- restricted document rollout：从 `.planning/WORKSTREAMS.md` 的 active work map
  与 git history 恢复具体历史片段
- legacy ACL carrier sunset：历史背景通过 git history 恢复对应 archived plan
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
5. personalization 可以影响 routing、admission、applicability、retrieval planning、
   ranking / disambiguation、clarification 与 answer wording；不得伪造
   identity claim 或 restricted entitlement。

这些规则只定义恢复 productization 时的执行入口和验收口径，不表示当前 memory productization 已经上线。

## 相关领域

- `operator-observability.md`
  - operator panel 只消费 app-owned authz / audit / quality projections
