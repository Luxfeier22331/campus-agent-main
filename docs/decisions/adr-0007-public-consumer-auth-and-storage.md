---
doc_type: decision
decision_id: ADR-0007
status: accepted
created: 2026-03-26
updated: 2026-03-26
---

# ADR-0007 Public Consumer Chat 用户系统与存储决策

适用范围：`apps/public-consumer-chat` 第一版用户系统、会话存储与 conversation persistence

## 背景

`public-consumer-chat` 已经被接受为独立 `apps/*` boundary。

这个 app 不是单次表单入口，而是一个带以下能力的 consumer chat product：

- sign-in / sign-out
- app-level session
- user-owned conversation history
- conversation continuation

因此仓库需要冻结三类问题：

- 第一版 app auth 选型
- auth 与 conversation persistence 的数据库边界
- 这套边界与 retrieval / registry / worker admission 的关系

## 决策 1：第一版 app auth 采用 Better Auth

结论：

- `apps/public-consumer-chat` 第一版 app auth 采用 `Better Auth`
- 不采用 `Auth.js` 作为默认方案

原因：

- 当前仓库长期明确要求 runtime 选择延后，不应为了 auth 把 app 冻结到 Next.js / App Router 心智
- `public-consumer-chat` 是独立 app boundary，更适合使用面向标准 handler 的 app-local auth system
- 第一版需要 database-backed session、conversation ownership、history visibility 与 app-local account UX，`Better Auth` 更贴近这个形态
- 官方当前文档同时支持 PostgreSQL、database-backed session、TanStack Start integration，以及非默认 schema

补充说明：

- 这不是说 `Auth.js` 无法完成需求
- 这是在当前仓库边界下做出的长期贴边选择

## 决策 2：auth 与 chat 统一放入 Supabase Postgres

结论：

- `Better Auth` 与 app chat 数据统一放在同一个 `Supabase Postgres`
- 不采用 `D1 for auth + Postgres for chat`
- 不采用“先 D1，后面再迁”的默认路径

原因：

- user、session、conversation ownership 属于同一个 app-level relational boundary
- 把它们拆到两个数据库会制造双真相源、跨库组装、迁移复杂度和长期边界腐烂
- conversation history product 的真正难点不在登录页面，而在 ownership 与 session consistency

## 决策 3：同库分域，不预拆多库

结论：

- `Supabase Postgres` 作为主关系数据库
- 通过 schema 分域，而不是在当前阶段预拆多套数据库

默认推荐域：

- `auth`
- `chat`
- `ingestion_registry`

原因：

- 当前规模下，性能和容量都不是预拆库的主要驱动
- schema 分域已经足够提供 ownership clarity、迁移路径和权限边界
- 真正需要多库时，触发条件应来自运营隔离、合规隔离或生命周期独立，而不是“担心以后会变大”

## 决策 4：Qdrant 继续承担在线 retrieval 主存储

结论：

- `Qdrant` 继续承担在线 chunk metadata、embedding、vector index 与 retrieval 主消费面
- `Supabase Postgres` 不承担在线 vector retrieval 主路径

原因：

- 当前仓库已冻结 `Qdrant` 为 phase-1 canonical online chunk / index store
- 把 chunk / vector retrieval 主路径迁回 Postgres 会破坏既有 retrieval boundary
- `Postgres` 在这里的角色是关系型真相和元数据真相，不是向量检索主引擎

## 决策 5：session 采用 database-backed strategy

结论：

- 第一版 app session 默认采用 database-backed strategy
- 不采用 stateless-only session 作为默认形态

原因：

- 这是 history product，不是一次性匿名提交页
- durable session、logout、session list、ownership 审计和后续 account policy 都更依赖数据库会话真相
- stateless-only 方案只会把未来需要的关系型身份问题延后暴露

缓存与性能说明：

- 如后续需要，可增加 cookie cache 或 Redis secondary storage
- 这些能力只能作为加速层，不能替代 database truth

## 后果

直接结果：

- `apps/public-consumer-chat` 需要自己的 auth handler、session enforcement 和 ownership guard
- app 需要 durable relational schema，而不是只靠 browser cookie 推导用户
- Worker admission 不再被误用成 canonical user system

明确不做：

- 不把 auth truth 放回 `apps/public-entry-worker`
- 不把 user system 塞进 `apps/supervisor-api`
- 不用 `D1` 承担第一版 canonical auth store
- 不把 retrieval 主路径迁回 Postgres

## 相关文档

- `docs/architecture/public-consumer-chat-surface.md`
- `docs/architecture/public-consumer-chat-auth-and-data-boundary.md`
- `docs/architecture/long-term-architecture.md`
