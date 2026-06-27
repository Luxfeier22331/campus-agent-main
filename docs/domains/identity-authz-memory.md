---
doc_type: index
truth_scope: product
owner_boundary: apps/app-api
status: active
created: 2026-04-12
updated: 2026-06-17
---
# Identity / Authz / Memory Domain

## 先看什么

- identity/authz/retrieval projection
  总边界：`../architecture/system/identity-and-authorization-architecture.md`
- 用户系统 product
  boundary：`../architecture/system/identity-platform-architecture.md`
- identity/account browser
  experience：`../architecture/system/identity-browser-experience-architecture.md`
- future muc.wiki login
  federation：`../architecture/system/federation-and-mucwiki-login-architecture.md`
- 产品/runtime owner
  split：`../architecture/system/product-runtime-architecture.md`
- 当前 merged truth：`../architecture/current.md`
- 通用执行态入口：`README.md`

## 长期边界与决策

- `../architecture/system/identity-and-authorization-architecture.md`
- `../architecture/system/identity-platform-architecture.md`
- `../architecture/system/identity-browser-experience-architecture.md`
- `../architecture/system/federation-and-mucwiki-login-architecture.md`
- `../decisions/adr-0015-user-identity-memory-and-personalization-boundaries.md`
- `../decisions/adr-0058-hindsight-self-hosted-personal-memory-plane.md`
- `../decisions/adr-0045-identity-platform-and-auth-runtime-boundary.md`

## Contract 与 Data

- `../contracts/app-api-http.md`
- `../contracts/app-api-identity-platform-http.md`
- `../contracts/app-api-federation-http.md`
- `../contracts/tool-execution.md`
- `../data/app-api-schema.md`
- `../data/identity-platform-schema.md`

## 执行路由

- 当前 merged truth 统一看 `../architecture/current.md` 与
  `../architecture/system/identity-and-authorization-architecture.md`
- 当前 pending work 统一看 `README.md` 定义的通用执行态入口与 GSD SDK / Codex native
  session
- 受限文档、学生 / 教职工差异化 tool 权限与 legacy ACL rollout 已退出当前主问答产品目标；
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
2. Hindsight runtime 承接 personal memory retrieval / extraction / graph
   storage；PG profile memory 只保留为 manual product projection /
   migration source。
3. `app-api` chat hot path 不读取 PG profile memory 并全量注入
   `context.profile_memory`。
4. planning / RAG / deterministic tools 只消费 bounded Hindsight personal
   memory recall packet；
   不得读取 raw memory、raw transcript、raw auth material 或产品层数据库对象。
5. personalization 可以影响 follow-up、applicability、retrieval planning、ranking /
   disambiguation、clarification 与 answer wording；不得伪造 source truth、tool
   opening truth、account / session truth 或 fail-close override。

这些规则只定义恢复 productization 时的执行入口和验收口径，不表示当前 memory productization 已经上线。

## 相关领域

- `operator-observability.md`
  - Operator Console 只消费 app-owned operator access、audit 与 quality projections
