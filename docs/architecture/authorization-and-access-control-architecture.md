---
doc_type: architecture
status: active
created: 2026-03-29
updated: 2026-03-29
---

# Authorization And Access Control Architecture

## 文档边界

本文只冻结 `campus-agent` 的长期授权模型、ownership、retrieval filter projection 语义，以及 visibility / applicability 的分层关系。

本文不负责：

- 具体 auth provider、IdP 或 Cloudflare 产品配置
- 某个 policy engine、relation store 或规则引擎的最终选型
- 某次迭代的表结构、API 形状或 rollout 顺序
- 当前 phase-1 代码实现是否已经全部完成长期授权形态

对应 source of truth：

- repo 级长期边界：`long-term-architecture.md`
- shared app backend ownership：`app-api-architecture.md`
- supervisor 编排边界：`supervisor-architecture.md`
- rag specialist 检索侧边界：`rag-specialist-architecture.md`
- retrieval runtime truth：`retrieval-query-strategy.md`
- identity / memory / personalization 边界：`../decisions/adr-0015-user-identity-memory-and-personalization-boundaries.md`
- 授权模型与检索过滤投影决策：`../decisions/adr-0016-authorization-model-and-retrieval-filter-projection.md`

## 目标

这里要回答的问题只有五个：

- canonical authorization truth 长期属于哪一层
- retrieval index 中的 ACL metadata 到底是什么语义
- query path 应如何消费授权结果而不把权限判断交给模型
- `visibility` 与 `applicability` 应如何拆分
- public chat、panel、conversation、memory 与 approval path 应如何共享同一授权平面

## 核心结论

长期上：

- `apps/app-api` 是 canonical authorization truth owner
- `apps/supervisor-api`、`packages/supervisor-core`、`packages/rag-specialist` 与 `packages/retrieval-core` 只消费最小化 typed authz projection
- retrieval index 中的 `acl_level`、`acl_groups` 与同类字段只表达 search-time filter projection，不是 canonical authorization truth
- 长期授权模型必须至少覆盖 `subject / action / resource / context`，而不是只靠 group filter
- `visibility` 与 `applicability` 必须分层；个性化和适用性不能伪装成权限
- 所有高风险或不可逆动作仍由 deterministic code gate 收口，而不是交给 LLM 自行决定

## Canonical Authorization Truth

长期上，`apps/app-api` 至少拥有以下四类授权真相：

- `principal truth`
  canonical principal id、principal type、身份映射结果与最小可信身份快照
- `entitlement truth`
  group membership、role assignment、relation / ownership 派生结果与版本化 entitlement snapshot
- `resource ownership truth`
  conversation ownership、memory visibility、operator resource ownership 与其他产品层对象归属
- `approval truth`
  break-glass、operator approval、人工复核状态与其他不可逆动作门禁上下文

这些真相可以共库、共事务或共边界实现，但不应散落到 `supervisor-api`、`retrieval-core` 或 specialist 里各自重建。

## Authorization Model

长期授权模型固定为：

- `subject`
  谁在请求，例如 student principal、staff principal、operator principal、anonymous session
- `action`
  要做什么，例如 `read_document`、`read_conversation`、`write_memory`、`review_request`
- `resource`
  作用在哪个对象上，例如 document、chunk、conversation、memory item、operator projection
- `context`
  与请求同时成立的约束，例如 active campus、channel、approval state、session ownership、time-based policy

允许使用 RBAC、ABAC、ReBAC、ownership rule 或显式 policy rule 的组合实现这套模型；但长期不接受“只靠 `acl_groups` 过滤就等价于完整授权模型”的表述。

## Projection To Execution Path

`app-api -> supervisor-api -> specialist -> retrieval-core` 链路长期只应传递最小化 typed authz projection。

允许的语义包括：

- stable principal id / actor id
- entitlement snapshot id、version 或等价的最小化 membership summary
- ownership / approval summary
- authorized retrieval filter projection
- 仍然需要给 workflow 使用的 typed claims
- correlation / trace metadata

不允许跨边界直传：

- raw JWT、raw Access envelope、raw cookie
- 未经 app-layer 映射的 provider identity payload
- 产品层 authz store 对象
- 用于重建完整授权决策的 raw private state

这里冻结的是语义，不冻结具体 dataclass、JSON schema 或 header 名称。

## Retrieval Filter Projection

长期上，retrieval path 继续要求 pre-filter，但其含义固定为“执行上游授权层投影后的过滤结果”，而不是在 retrieval-core 内部拥有 canonical authz truth。

因此：

- `packages/retrieval-core` 负责在 candidate retrieval 前执行 serving filter 与 authorization filter
- `packages/retrieval-core` 不反向读取 profile/auth/chat store 做最终 entitlement resolution
- document / chunk metadata 中的 ACL 字段属于 search projection，服务于高性能过滤，不是长期授权真相源
- filter 缺失、冲突或无法安全判定时必须 fail-closed

当前 phase-1 实现仍允许使用如下 transitional projection：

- `acl_level`
- `acl_groups`
- `campus_scope`

但这些字段只表示当前实现使用的过滤载体，不应继续被文档或新实现描述为长期 canonical authorization model。

## Visibility Vs Applicability

长期必须把以下两类语义拆开：

- `visibility`
  principal 是否有权看到某条内容或访问某个资源
- `applicability`
  某条制度、流程或答案是否适用于该用户背景、校区、项目或年级

这意味着：

- `major`、`cohort`、`program`、近期目标等信息默认首先属于 applicability / personalization
- 只有被显式建模为 entitlement 或 policy 条件的字段，才进入 authorization truth
- 当前被写进 `campus_scope` 的过滤语义，长期上应拆成 `visibility_scope` 与 `applicability_scope`

如果某字段同时承担两种语义，应优先拆字段和拆决策路径，而不是继续在同一个 filter 中混用。

## Cross-Surface Authorization Plane

长期上，以下资源类型应共享同一授权平面，而不是各自发明一套局部 ACL：

- institutional document / chunk / evidence
- conversation / message / request execution
- profile memory / session memory
- operator projection / operator workflow
- approval-required capability 与人工复核动作

这并不要求它们共用同一种存储或同一个 policy engine，但要求：

- principal 语义一致
- deny-by-default 一致
- 审计字段一致
- 过渡态说明一致

## Transitional Shape And Migration Guardrails

当前仓库的 phase-1 查询面已经实现了“caller identity/groups 到 retrieval pre-filter”的最小闭环，但这仍只是 transitional shape。

具体含义固定如下：

- 当前 `apps/supervisor-api` 内的 actor 映射只属于 phase-1 execution seam，不是长期 canonical authz truth
- 当前 retrieval path 中的 `acl_groups + campus_scope` 只是过渡期 filter projection
- 新的长期 contract 不应再把 raw token claims 直接暴露给 specialist 或 retrieval-core
- 后续实现应优先引入显式 entitlement snapshot / authz projection，而不是继续扩大 `ActorContext.groups`

## Current Transitional State

截至 2026-03-29，主线代码已经完成了一半迁移，但还没有完成“结束过渡态”所需的 app-layer 收口。

当前已经成立的是：

- shared contract 已显式拥有 `AuthorizationProjection` 与 `AuthorizedRetrievalFilter`
- `supervisor-api` 已能在受控前提下接收 typed `ContextProjection`
- `retrieval-core` 与 `rag-specialist` 已优先消费 authz projection，并仅在兼容场景下回退到 `acl_groups` / `campus_scope`

当前仍然保留过渡态的原因是：

- `apps/app-api` 还没有成为所有产品执行面的唯一 authz projection owner
- 尚未全部切换到 `app-api -> supervisor-api` 的 canonical `ContextProjection.authorization` 路径
- 仍有未合入或未对齐的 app/worktree 实现继续使用 top-level `actor` carrier、`snapshot` 字段和 legacy `groups/campus_scope` 语义
- 因此当前主线仍必须保留少量 compatibility fallback，避免打断 phase-1 已在运行的 query path

这里的关键结论是：

- 当前过渡态不是长期设计不清楚
- 当前过渡态是调用方迁移尚未完成
- 在调用方全部切到 canonical projection 之前，legacy carrier 只能作为 migration carrier，不能再扩成新的长期真相源

## Exit Conditions For Transitional State

要结束当前 ACL/authz 过渡态，至少必须同时满足以下条件：

1. `apps/app-api` 在 execution path 内稳定产出 canonical principal / authorization / memory projection，而不再只输出 actor carrier。
2. `app-api -> supervisor-api` 的产品调用统一发送 `ContextProjection`，其中 `context.authorization` 成为 retrieval filter 的 canonical 上游输入。
3. 产品调用面不再依赖 top-level `actor` payload、`snapshot` payload 或 specialist-only response shape。
4. `ExecutionActorContext.groups/campusScope` 与 retrieval 侧 legacy `acl_groups/campus_scope` 不再被产品路径当作 canonical authz truth，只保留为受控兼容层，或在迁移完成后删除。
5. `profile memory` 与 `session memory` 不得改写 authorization projection，这条约束在 app-api、supervisor、retrieval tests 中持续可验证。
6. app-api 自身测试、shared contract tests、supervisor/retrieval/specialist tests 与仓库级 baseline 全部通过。

如果这些条件仍未同时满足，就只能称为“migration in progress”，不能宣称长期 ACL/authz 已完成收口。

## Forbidden Shapes

长期不接受以下形态：

- 把 Worker / edge JWT payload 直接当成最终 actor 或 entitlement truth
- 让 `packages/retrieval-core` 成为 canonical authz owner
- 让 `rag-specialist` 或 `supervisor` 自行从 raw conversation / memory 中推断权限
- 让 personalization 或 applicability 改写 visibility 结果
- 先检索再事后裁剪未授权 evidence
- panel、conversation ownership、memory visibility 各自维护互不兼容的权限模型
