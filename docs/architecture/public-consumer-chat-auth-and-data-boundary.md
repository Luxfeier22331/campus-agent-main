---
doc_type: architecture
status: superseded
created: 2026-03-26
updated: 2026-03-28
---

# Public Consumer Chat Auth And Data Boundary

> Superseded on 2026-03-28 by `docs/architecture/shared-app-api-and-worker-web-surfaces.md` and `docs/decisions/adr-0012-shared-app-api-and-worker-web-surfaces.md`.
>
> This file records the earlier direction where auth/session/conversation were owned by `public-consumer-chat` itself. The accepted direction now moves those concerns into shared `apps/app-api`.

## 文档边界

这份文档冻结 public consumer chat 的用户系统边界、数据归属边界与存储分层。

它补充但不替代以下文档：

- consumer product surface：`docs/architecture/public-consumer-chat-surface.md`
- 长期 `apps/*` / `packages/*` 边界：`docs/architecture/long-term-architecture.md`
- public entry edge boundary：`docs/architecture/cloudflare-public-entry-boundary.md`
- public entry 到 runtime origin 的 forwarding contract：`docs/architecture/cloudflare-public-entry-integration-contract.md`
- operator-facing request projection boundary：`docs/architecture/request-projection-and-operator-query-architecture.md`

这份文档不负责冻结：

- Phase 5 actor / ACL / audit 最终闭环
- retrieval 质量策略
- admin / operator product surface

## 目标

第一版 public consumer chat 需要一个长期可演进的 app-level user system，而不是临时登录壳。

这里要冻结的是：

- 用户身份真相放在哪一层
- session / conversation ownership 由谁负责
- auth、chat 与 retrieval / registry 的数据边界如何分层
- 为什么不采用会快速腐烂的双真相源方案

## 核心结论

第一版 public consumer chat 的 app-level 用户系统固定采用：

- self-maintained app auth system
- database-backed session
- app-owned conversation persistence
- same-site app routing

对应的长期边界固定为：

- auth provider：`Better Auth`
- app host：`TanStack Start`
- primary relational store：`Supabase Postgres`
- online retrieval store：`Qdrant`

不采用：

- `Auth.js` 作为第一版 app auth 方案
- `D1 for auth + Postgres for chat` 的双数据库拆分
- 把 Worker admission 当作 app-level canonical identity
- 把 Postgres 作为在线 chunk / vector retrieval 主存储

## Why Better Auth

选择 `Better Auth` 的原因不是“更快接上”，而是它更符合当前仓库边界：

- `public-consumer-chat` 是独立 app boundary，不应把用户系统耦合到 `apps/supervisor-api`
- 仓库长期明确要求 runtime 选择延后，不把产品边界冻结到单一 Web 框架
- consumer app 需要 database-backed session、conversation ownership、sign-in UX 和 app-local API seam
- `Better Auth` 对标准 `Request` / `Response` handler 友好，并有官方 `TanStack Start` 集成，适合独立 app 形态

## Why TanStack Start

选择 `TanStack Start` 的原因不是“只是换个 router”，而是它更符合这个 app 的真实边界：

- `public-consumer-chat` 需要的是 app-local full-stack boundary，而不只是 client-side routing
- 这个 app 需要在同一边界里承载 route、auth handler、session protection、conversation CRUD 和 ownership guard
- `TanStack Start` 能把这些能力留在 consumer app 内，而不需要再把 auth / conversation API 回灌到 `apps/supervisor-api`
- `TanStack Router` 的类型安全、route context、search params 和 loader integration 更适合 conversation/history 产品
- 官方路线接受 `Cloudflare Workers` 作为正式宿主目标，与当前 public-entry/runtime 分层不冲突

这里冻结的是 app 宿主方向，而不是 repo-wide framework truth。

不选 `Auth.js` 作为第一版默认方案的原因：

- 它今天仍明显以 Next.js 心智和 `next-auth` 生态为主
- 它当然可以工作，但对当前这个不想被 Next.js / App Router 提前冻结的仓库，不是最贴边的长期起点
- 官方迁移文档已明确：老项目稳定运行时没有紧急迁移需求，但新项目更推荐 `Better Auth`

## User System Boundary

public consumer chat 的 canonical user system 固定属于 app layer，而不是 edge layer 或 supervisor layer。

因此：

- `apps/public-entry-worker`
  只负责 public hostname、outer admission、forwarding posture 和 same-site entry assumptions
- `apps/public-consumer-chat`
  拥有 sign-in、sign-out、session、conversation ownership、history visibility 和 app-level account UX
- `apps/supervisor-api`
  继续只承担 runtime ingress，不拥有用户系统真相

必须保持的边界：

- Worker admission 不能直接等价于 app user identity
- `SupervisorRequest.actor` 不是前台 app user system 的唯一真相源
- conversation ownership 检查必须在 consumer app 自己的 server boundary 完成
- operator-facing request truth 不来自 consumer app 的 conversation/message store

## Storage Boundary

第一版 storage 分层固定为：

- `Supabase Postgres`
  承担用户、session、conversation、message，以及 app-owned relational truth
- `Supabase Postgres`
  也可以承载 document / raw registry 这类关系型元数据
- `Qdrant`
  继续承担在线 chunk metadata、embedding、vector index 与 retrieval 主消费面
- object storage
  继续承担 raw / processed artifacts

这里的关键点不是“所有东西都塞进一个数据库”，而是：

- 关系型业务真相与关系型元数据真相可以在同一个 Postgres 中分域共存
- 在线语义检索主路径仍然留在 Qdrant，不回退到 Postgres
- operator-facing request projection 即使未来也落在同一个 Postgres，也应保持单独 read-model 领域，而不是复用 chat conversation truth

## PostgreSQL Domain Layout

长期推荐把 `Supabase Postgres` 作为一个主业务数据库，但按 schema 明确分域：

- `auth`
  Better Auth 核心表与插件表
- `chat`
  user profile projection、conversation、message、conversation membership / ownership 等 app 表
- `ingestion_registry`
  `document_registry_records`、`raw_asset_registry_records` 等关系型元数据
- `public`
  只保留确有必要暴露的共享对象；不作为默认落点

当前阶段不推荐一开始再拆成多套 Postgres 或多套真相源。

只有在出现明确的运营隔离、合规隔离、爆炸性增长、或独立生命周期管理要求时，才考虑拆库，而不是在 MVP 阶段预拆。

## Why Not D1 Plus Postgres

`D1 for auth + Supabase Postgres for chat / registry` 看起来像“先跑起来”的方案，但长期会腐烂。

主要问题：

- session、user、conversation ownership 不再处于同一个关系边界
- app server 每次做 ownership / history / account projection 都要跨两个真相源拼装
- 迁移和回溯复杂度上升，调试边界也变差
- 一旦后续要加 account policy、session audit、invite / role、conversation sharing，双库会迅速演变成架构债

因此第一版就应坚持：

- auth 与 chat 放在同一个主关系数据库里
- 按 schema 分域，而不是按产品随意拆库

## Session Strategy

public consumer chat 默认采用 database-backed session。

理由：

- 这是一个带历史记录和 ownership 的产品，而不是一次性匿名表单
- durable session、logout、multi-session 管理、future audit 和 account policy 都更适合落在数据库里
- stateless-only session 会把真正的用户系统复杂度推迟，而不是消除它

如后续需要降低热点读取成本，可以在不改变真相源的前提下，引入 cookie cache 或 Redis 一类 secondary storage。

但这些都只能作为缓存 / 加速层，不能替代 Postgres 里的 canonical auth/session truth。

## Performance Posture

在当前产品预期下：

- auth / session / conversation 的关系型读写压力较低
- document registry / raw asset registry 的关系型负载也远低于在线 vector retrieval
- 真正更重的链路通常是 embedding、Qdrant query 和 ingestion 批量写入

因此：

- 同一个 `Supabase Postgres` 同时承载 `auth + chat + registry metadata` 是合理的
- 真正需要守住的是边界，而不是过早拆散数据库

但这不改变另一条约束：

- panel / operator request list 不能直接从 `chat.conversation`、`chat.message` 推导
- consumer app 的关系型真相与 operator request projection 即使共库，也必须分开建模

## Fail-Closed Rules

以下规则固定为 fail-closed：

- 无有效 app session 时，不得读取任何 conversation history
- conversation ownership 校验失败时，不得返回线程内容
- app user identity 缺失时，不得把 Worker / browser header 猜成 canonical user
- auth store 或 chat store 故障时，不得降级成“匿名也能看到历史”

## Non-Goals

- 不把 Better Auth 扩散成 repo-wide auth substrate
- 不在第一版引入 team / workspace / shared conversations
- 不在第一版冻结最终 actor -> ACL -> audit 全链路
- 不把 consumer app 的用户系统真相回灌到 Worker
- 不把 Qdrant 职责迁回 Postgres
