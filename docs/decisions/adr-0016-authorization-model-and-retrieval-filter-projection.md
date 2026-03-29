---
doc_type: decision
decision_id: ADR-0016
status: accepted
created: 2026-03-29
updated: 2026-03-29
---

# ADR-0016 授权模型与检索过滤投影

## 状态

Accepted on 2026-03-29.

## 背景

当前 phase-1 查询链路已经建立了最小 ACL 闭环：

- query path 会把 caller identity / group 传到 retrieval
- retrieval 会在 candidate retrieval 前执行 metadata pre-filter
- memory / personalization 不应扩大权限

但如果长期继续把这套实现直接等同于完整授权模型，会产生几个问题：

- 把 `acl_level`、`acl_groups`、`campus_scope` 误当成 canonical authorization truth
- 把 Cloudflare / edge token claims 误当成最终 entitlement truth
- 把 applicability / personalization 与 visibility 混在同一过滤字段里
- 让 panel、conversation ownership、memory visibility 与 document visibility 继续分裂成多套局部规则

因此需要在长期边界上明确：授权真相源在哪、检索过滤字段是什么语义、当前实现哪些只是过渡态。

## 决策 1：canonical authorization truth 由 `app-api` 拥有

长期上：

- `apps/app-api` 拥有 canonical principal mapping、entitlement truth、resource ownership truth 与 approval truth
- `apps/supervisor-api`、`packages/supervisor-core`、`packages/rag-specialist` 与 `packages/retrieval-core` 只消费最小化 typed authz projection
- edge / Worker / Cloudflare Access 侧身份材料只属于 boundary input，不等于 canonical authorization truth

## 决策 2：长期授权模型必须覆盖 `subject / action / resource / context`

长期授权不再描述为“用户带了哪些 group，所以能看到哪些文档”。

长期最小语义固定为：

- `subject`
- `action`
- `resource`
- `context`

允许在实现层组合使用 RBAC、ABAC、ReBAC、ownership rule 或审批状态，但不允许继续把纯 group filter 写成长期完整授权模型。

## 决策 3：retrieval index 中的 ACL metadata 只是 filter projection

长期上：

- document registry、chunk metadata 与 vector index 中的 ACL 字段属于 search-time filter projection
- 这些字段服务于 retrieval pre-filter 的高性能执行
- 它们不是 canonical authorization truth store

因此：

- retrieval metadata 可以被重建、迁移或重新投影
- 真正的 entitlement / ownership / approval truth 不应只存在于索引层
- 长期词汇应收敛到显式 `visibility` / `entitlement` projection，而不是继续扩写 `acl_*`

长期推荐的 retrieval projection 语义包括：

- `visibility_level`
- `visibility_scope`
- `entitlement_groups`
- `policy_projection_version`

如果未来 conversation、memory 或其他 user-private 资源进入 retrieval index，则额外引入：

- `owner_scope`
- `tenant_scope`

这些字段仍然只是执行投影，不是 canonical authz truth。

## 决策 4：retrieval 必须消费授权层投影后的 filter，并在 candidate retrieval 前执行

长期上：

- retrieval pre-filter 仍是强约束
- pre-filter 必须在 candidate retrieval 前执行，而不是在生成后裁剪 evidence
- retrieval-core 执行的是上游授权层投影后的 filter，不在 retrieval-core 内自行做最终权限解析
- projection 缺失、冲突或不可安全推断时必须 fail-closed

## 决策 5：`visibility` 与 `applicability` 必须拆分

长期上：

- `visibility`
  表示 principal 是否有权读取某资源
- `applicability`
  表示某条制度或答案是否适用于该用户背景

因此：

- `major`、`cohort`、`program`、recent goal 等默认首先属于 applicability / personalization
- 只有被显式建模为 entitlement 或 policy 条件的字段，才属于 authorization truth
- 当前 `campus_scope` 的混合语义必须在后续迁移中拆成 `visibility_scope` 与 `applicability_scope`

## 决策 6：token claims 与 boundary identity 只属于输入材料，不直接成为 entitlement truth

长期上：

- JWT claims、Access envelope、Worker admission 事实可以作为 boundary input
- 这些输入必须在 app-layer boundary 内完成映射、裁剪、版本化和最小化投影
- 不允许把 raw token claims 直接一路传给 specialist / retrieval，作为长期 contract

## 决策 7：当前 phase-1 的 `groups + campus_scope` 只是一种 transitional shape

当前仓库允许保留 phase-1 的最小实现形态：

- `ActorContext.groups`
- retrieval 侧 `acl_level` / `acl_groups`
- 过渡期 `campus_scope` 过滤

但这组字段的长期语义固定为：

- current implementation filter carrier
- transitional projection shape

而不是：

- canonical authz schema
- long-term唯一权限模型
- 新功能继续扩展的默认真相源

## 决策 8：identity / memory / applicability 不进入 retrieval ACL metadata

长期上：

- `major`、`cohort`、`program`、`recent goal`
- profile memory / session memory
- raw token claims / raw session envelope

都不应直接进入 document / chunk ACL metadata。

它们只能：

- 保留在 `app-api` canonical truth
- 作为 typed identity / applicability claim 参与 workflow 或 personalization
- 或在明确 policy 建模后，被上游授权层映射成最小化 entitlement / visibility projection

## 结果

直接结果如下：

- 后续 identity / memory / personalization 文档只负责上下文和个性化边界，不再独自承担完整授权模型定义
- retrieval 文档必须区分 serving filter、authorization filter 与 applicability hint
- `app-api` 文档必须显式承担 principal / entitlement / ownership / approval ownership
- ingestion / registry / chunk metadata 文档必须明确区分 canonical authz truth 与 search-time projection
- 新实现若要增加 panel、memory 或 conversation 权限逻辑，必须对齐同一 authz model，而不是再发明局部 ACL

## 相关文档

- `docs/architecture/authorization-and-access-control-architecture.md`
- `docs/architecture/long-term-architecture.md`
- `docs/architecture/app-api-architecture.md`
- `docs/architecture/retrieval-query-strategy.md`
- `docs/decisions/adr-0015-user-identity-memory-and-personalization-boundaries.md`
