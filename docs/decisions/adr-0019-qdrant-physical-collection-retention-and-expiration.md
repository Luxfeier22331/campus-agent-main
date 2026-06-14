---
doc_type: decision
truth_scope: repository
owner_boundary: docs/decisions
decision_id: ADR-0019
status: accepted
created: 2026-03-31
updated: 2026-06-01
---
# ADR-0019 Qdrant Physical Collection Retention And Expiration

适用范围：所有已进入 release-managed lifecycle 的 Qdrant collection，包括当前 `query_serving` 的
`student_rules`、`curriculum_plan`，以及当前仍处于 `offline_preparation` 的 collection

## 背景

当前 repo 已冻结以下运行现实：

- retrieval 只读取稳定 `serving alias`
- 每次 index release 都会生成新的 versioned physical collection
- release manifest 会记录 `serving_alias`、`physical_collection_name` 与
  `previous_physical_collection_name`
- alias rollback 的标准动作是把 alias 切回上一个 physical collection

但当前仍缺一条明确规则：

- 旧 physical collection 何时允许过期
- 过期前必须满足哪些回滚与追溯条件
- `query_serving` 和 `offline_preparation` collection 是否使用同一套清理策略

如果这条规则不冻结，后续容易退化为：

- 仅按“超过 N 天”删除 collection，结果误删热回滚位
- 因为害怕误删而永久堆积所有旧 collection，导致 cloud storage/cost 不可控
- 把“文档历史版本必须保留”和“Qdrant physical collection 必须永久保留”混为一谈
- 让 `query_serving` 与 `offline_preparation` collection 长出两套不同的 alias/cleanup 语义

## 决策

### 决策 1：旧 physical collection 的过期采用 role-based retention，而不是 time-only deletion

每个 release-managed alias 下的 physical collection 固定分为以下角色：

1. `current`
   - alias 当前指向的 physical collection
   - 永不自动删除
1. `previous`
   - 最新一次已发布 release 的 `previous_physical_collection_name`
   - 作为热回滚位保留
1. `migration_baseline`
   - 当 release 变更以下任一项时，额外保留一版迁移前基线： - embedding model 或 dimensions - vector
     names / schema - chunk profile - cleaning policy - retrieval serving shape
1. `archive_candidate`
   - 既不是 `current`、也不是 `previous`、也不是 `migration_baseline` 的旧 physical
     collection

原因：

- rollback 依赖角色语义，而不是只依赖时间窗口
- 迁移型 release 的回退风险通常高于普通内容更新
- role-based retention 可以同时兼顾安全回滚与成本控制

### 决策 2：最小保留窗口固定如下

- `current`
  - 永不自动删除
- `previous`
  - 至少保留 `7` 天
  - 且在一个更新的 release 完成 publish 后，还必须等该 release 的 post-publish validation /
    acceptance 关闭，才允许降级为 `archive_candidate`
- `migration_baseline`
  - 至少保留 `30` 天
- `archive_candidate`
  - 不承诺最小时长；满足删除门禁后可清理

### 决策 3：删除旧 physical collection 只能在所有门禁同时满足时发生

删除前必须同时满足：

- 目标 collection 不是任何 alias 的 `current`
- 目标 collection 不是该 alias 最新 manifest 指向的 `previous`
- 目标 collection 不是仍在保留窗口内的 `migration_baseline`
- 当前没有 active incident、回归调查或手工验收仍依赖该 release
- 对应 release 的 manifest 与 validation summary 已持久化在对象存储中
- self-hosted Qdrant native snapshot 与 off-host archive 覆盖了这次 release 的恢复窗口

### 决策 4：physical collection 过期不等于文档历史版本删除

- 文档历史版本保留规则继续以 `DocumentRegistry` 与 ADR-0014 为准
- 删除旧 Qdrant physical collection，不得被解释为删除历史 `version_id`
- 默认 current-serving 继续成立，但“历史版本必须保留”的语义属于 registry / object-store truth，不要求所有历史
  release 的物理索引永久常驻 Qdrant

### 决策 5：这套 retention 规则对 `query_serving` 与 `offline_preparation` collection 一致生效

- `service_catalog`
- `contact_directory`
- 以及后续进入 release-managed lifecycle 的其他 collection

都使用：

- 稳定 alias
- versioned physical collection
- 相同的 retention role 语义

原因：

- 是否开放 retrieval，不改变 release/rollback/cleanup 的数据平面语义
- 避免“先 offline，再 query-enabled”时又重开一轮 alias/retention 迁移

## 结果

直接结果如下：

- `docs/reference/runtime-serving-and-index-terms.md` 需要补充 retention role 定义
- `docs/runbooks/index-release-runbook.md` 需要补充旧 collection 清理门禁与操作流程
- `docs/decisions/adr-0052-self-hosted-single-node-qdrant-and-native-backups.md`
  冻结当前 self-hosted native snapshot 恢复覆盖策略
- 后续如果实现自动 GC / cleanup worker，必须严格遵守本 ADR 的角色与门禁，而不是重新发明 time-only policy

明确不做：

- 不允许按“超过 N 天”单条件直接删旧 collection
- 不允许把 `--reset-index` 当作日常 retention cleanup 入口
- 不允许删除旧 physical collection 后，再试图从回答层或 env 配置层临时补回 rollback 语义

## Complements

这项决策 complements：

- `docs/architecture/system/data-plane-architecture.md`
- `docs/reference/runtime-serving-and-index-terms.md`
- `docs/runbooks/index-release-runbook.md`
- `docs/decisions/adr-0052-self-hosted-single-node-qdrant-and-native-backups.md`
- `docs/decisions/adr-0014-versioned-document-serving-and-history-query.md`
