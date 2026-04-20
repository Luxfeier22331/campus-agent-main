---
doc_type: plan
status: deferred
created: 2026-04-02
updated: 2026-04-20
---

# Legacy ACL Carrier Compatibility Sunset

## 文档边界

本文固定 `acl_level`、`acl_groups`、`campus_scope` 这组三个 legacy carrier 的后续下线方案。

它负责：

- shared contract、runtime path、data plane、fixture/docs vocabulary 的 legacy residue 清理
- canonical `visibility_* + entitlement_*` vocabulary 的 repo-wide 收口顺序

它不负责：

- 重开长期 identity / authorization architecture 边界讨论
- 把 personalization、memory 或 actor profile 升级成授权来源
- 把 navigation 场景里的地理语义 `campus_scope` 混成 ACL residue

## Lifecycle Contract

- 文档 lifecycle 保持 `deferred`
- 本文只保留 sunset order、compatibility boundary 与最终完成定义
- 若未来重开这条线，execution state 只写在 `.planning`

## Current Baseline

当前 merged truth 已固定的前提：

- canonical authz vocabulary 已切到 `visibility_level`、`visibility_scope`、`entitlement_groups`、`policy_projection_version`
- restricted retrieval 主路径已按 canonical projection 执行 pre-filter
- legacy carrier 已被降为 transitional residue，而不是 canonical truth
- shared contract、persisted row、fixture/docs vocabulary 与少量 adapter 入口仍残留 legacy 字段

## Sunset Contract

legacy carrier 后续始终按以下顺序下线：

1. public seam and docs example
2. shared contract
3. data-plane primary write path
4. fixture / eval / docs vocabulary
5. physical removal

固定原因：

- 先收 public seam，才能阻止 legacy vocabulary 继续增长
- 先收 shared contract，才能阻止各层继续把 legacy key 当默认字段
- data-plane 只能在 canonical write path 明确后再停掉双写

## Fixed Rules

- canonical authz truth 只允许来自 `apps/app-api` 的 `AuthorizationProjection`
- runtime product path 不再读取 legacy carrier
- compatibility 只允许留在离线导入、重建或 fixture loader 入口
- 若短期保留 legacy mirror，不能反向参与授权决策
- deny path 继续 fail-close，不增加标题、snippet、citation 泄露面

## Forward Phases

### Phase A: Public Seam And Docs Example

目标：

- 把 legacy retrieval filter key 退出公开 seam 与示例

### Phase B: Shared Contract

目标：

- 把 legacy 字段退出 shared contract 的默认稳定入口

### Phase C: Data-Plane Primary Write Path

目标：

- 停止 registry / chunk / index payload 的 legacy primary write

### Phase D: Fixture / Eval / Docs Vocabulary

目标：

- 把测试、benchmark、runbook 与 reference 的 canonical vocabulary 全部切正

### Phase E: Physical Removal

目标：

- 删除最后的 legacy carrier 字段、mirror 与 fallback resolver

## Completion Definition

完成时必须同时满足：

1. product runtime path 不再读取 legacy carrier
2. shared contract 不再把 legacy carrier 当稳定输出
3. data-plane 新写入与 rebuild 结果不再包含 legacy payload key
4. fixture / docs / runbook 不再以 legacy vocabulary 为 canonical 示例

## Handoff Rule

后续接手时：

1. 先看 identity / authz architecture 与 ADR
2. 再看 `.planning` 是否已为这条线显式 reopen
3. 最后回到本文确认 sunset order 与完成定义
