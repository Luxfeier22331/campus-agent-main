---
doc_type: index
status: active
created: 2026-04-12
updated: 2026-04-27
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
- `../decisions/adr-0022-campus-identity-and-restricted-document-authorization.m
  d`
- `../decisions/adr-0034-authorization-model-and-retrieval-filter-projection.md`

## Contract 与 Data

- `../contracts/app-api-http.md`
- `../contracts/app-api-supervisor-execution.md`
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

1. `app-api` 先拥有 profile memory 与 session memory 的 durable truth、用户可见控制面与数据最小化
   策略。
2. `app-api` 再把 verified identity、profile memory summary、session summary 与 authz
   projection 组装成最小 `ContextProjection`。
3. `execution-control`、`supervisor-agent-worker` 与 `knowledge` 只消费 typed projection；不得读取
   raw memory、raw transcript、raw auth material 或产品层数据库对象。
4. personalization 只允许影响 intent framing、retrieval planning、ranking / disambiguation、
   clarification 与 answer wording；不得扩大 ACL、serving surface、approval 权限或 tool permission。
5. memory 专项 eval 必须覆盖 non-authorizing behavior、scope / ACL 不提升、相关性注入、stale /
   conflicting memory、用户删除 / 禁用后的 projection 失效，以及未成年人 / 敏感数据保护。

这些规则只定义恢复 productization 时的执行入口和验收口径，不表示当前 memory productization 已经上线。

## 相关领域

- `operator-observability.md`
  - operator panel 只消费 app-owned authz / audit / quality projections
