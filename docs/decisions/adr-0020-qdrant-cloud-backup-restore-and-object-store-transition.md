---
doc_type: decision
decision_id: ADR-0020
status: accepted
created: 2026-03-31
updated: 2026-03-31
---

# ADR-0020 Qdrant Cloud Backup Restore And Object-Store Transition

适用范围：所有已进入 release-managed lifecycle 的 Qdrant Cloud collection，包括当前 `student_handbook`、`curriculum_plan`、`service_catalog`、`contact_directory`

## 背景

ADR-0019 已冻结一条删除门禁：

- 删除旧 physical collection 之前，必须先确认恢复窗口被 backup 覆盖

但当前仍缺三条更细的真相：

- `Qdrant Cloud Standard` 与当前 `Free` tier 各自使用什么备份主路径
- 当前没有 managed backup 时，删除门禁如何闭合
- 对象存储是否需要承载过渡期 snapshot，以及该怎么组织

2026-03-31 查官方文档后，当前能力边界是：

- `Qdrant Cloud Standard` 支持 dashboard 配置的 automatic backups
- 当前 `Free` tier 不提供 managed backup / disaster recovery，只能通过 API 手动做 snapshot / restore
- collection snapshot 不包含 aliases
- 在 Qdrant Cloud 上，snapshot restore 不支持从外部 URL 直接拉取，必须走上传文件的恢复路径

如果这条策略不冻结，后续容易退化为：

- 误把 `Free` tier 的 snapshot 当成与 `Standard` 同级的托管灾备
- 没有保留 alias mapping，恢复出 collection 后却无法正确切回 serving alias
- 在对象存储里随意堆 snapshot 文件，但没有 release / alias / checksum 元数据，导致恢复不可验证
- 删除旧 collection 时只看 manifest 已落盘，却没有真正的 backup evidence

## 决策

### 决策 1：目标态采用 Qdrant Cloud Standard automatic backups 作为主恢复覆盖

一旦运行环境升级到 `Qdrant Cloud Standard`，默认恢复主路径切换为 cloud-managed backups，而不是继续把每次 release 都导出成手工 snapshot。

默认 backup 基线：

- daily backups 保留至少 `14` 天
- weekly backups 保留至少 `8` 周
- monthly backups 保留至少 `6` 个月

原因：

- `previous` 至少保留 `7` 天，daily 需要覆盖这个热回滚窗口并保留余量
- `migration_baseline` 至少保留 `30` 天，weekly / monthly 需要覆盖迁移回退与较晚发现问题的恢复窗口
- managed backup 是 cluster-level 恢复面，适合作为 routine retention cleanup 的默认前置条件

`Standard` 模式下，删除门禁默认要求同时满足：

- backup schedule 已配置
- 至少存在一份成功的 managed backup，时间晚于目标 release 进入受保护窗口之后的最近一次 alias publish
- 对应 release manifest 与 validation summary 已落盘

### 决策 2：当前 Free tier 采用 snapshot-to-object-storage 作为过渡方案

在 `Free` tier 上，当前不具备 managed backup / disaster recovery，因此删除门禁不能只靠“manifest 已存在”闭合，必须先补显式 snapshot bundle。

过渡期默认触发点：

1. 某个 release 完成 alias publish，且需要作为 `current`、`previous` 或 `migration_baseline` 进入保护窗口时
2. 准备删除 `archive_candidate`，但当前环境仍没有足够的 managed backup 覆盖时
3. 准备执行 embedding model、dimensions、vector schema、chunk profile、cleaning policy、retrieval shape 迁移前

当前 `Free` tier 的过渡方案不是长期真相，只是为了在没有托管备份时先把恢复窗口补齐。

### 决策 3：Free tier snapshot bundle 必须和对象存储元数据一起归档

过渡期 snapshot 归档到 derived bucket，前缀固定为：

- `{corpus}/backups/{collection}/{release_id}/{backup_id}/backup-manifest.json`
- `{corpus}/backups/{collection}/{release_id}/{backup_id}/{physical_collection_name}.snapshot`
- `{corpus}/backups/{collection}/{release_id}/{backup_id}/restore-report.json`

其中：

- `backup_id` 采用 `bYYYYMMDDTHHMMSSZ` 形式
- `restore-report.json` 是可选项；完成 restore drill 或真实恢复后写入

`backup-manifest.json` 至少包含：

- `backup_id`
- `backup_mode`，取值为 `qdrant_cloud_managed` 或 `qdrant_collection_snapshot_export`
- `captured_at`
- `corpus`
- `collection`
- `release_id`
- `serving_alias`
- `physical_collection_name`
- `alias_bindings`
- `index_release_manifest_key`
- `validation_summary_key`
- `snapshot_object_key`
- `snapshot_sha256`
- `backup_reason`
- `operator`

其中 `alias_bindings` 必填，原因是 collection snapshot 本身不包含 aliases。

### 决策 4：恢复顺序固定为“恢复 physical collection，再恢复 alias，再做 release 验证”

无论使用哪种恢复来源，恢复顺序都固定为：

1. 恢复目标 physical collection
2. 按 manifest 或 backup bundle 中的 `alias_bindings` 恢复 serving alias
3. 核对 release manifest、points count、payload release metadata
4. 做 retrieval 抽样或 acceptance 验证

补充约束：

- `Standard` 模式下，即使使用 managed backup 恢复整集群，也不能跳过 alias 与 manifest 的一致性核对
- `Free` tier 模式下，因为 Qdrant Cloud 不支持从外部 URL 直接恢复 snapshot，operator 必须先从对象存储下载 snapshot，再上传到目标集群恢复

### 决策 5：对象存储可以承载过渡期 snapshot bundle，但不升级为在线 chunk truth

对象存储在这条策略里的角色固定为：

- 长期真相：source truth、document artifact、release manifest
- 过渡期灾备材料：`Free` tier snapshot bundle

明确不变：

- query-serving 的 canonical chunk/index truth 仍在 Qdrant
- snapshot bundle 只是恢复材料，不参与在线检索
- 不允许因为对象存储里有 snapshot 文件，就把对象存储误当作新的 query store

### 决策 6：从 Free tier 退出过渡方案的条件必须显式闭合

只有在以下条件全部满足后，才允许把“每次 release 都导出 snapshot bundle”降级为非默认动作：

1. 集群已升级到 `Qdrant Cloud Standard`
2. automatic backup schedule 已按本 ADR 配置
3. 至少出现一份成功的 managed backup
4. 至少完成一次 restore drill，并验证 alias / manifest / retrieval 一致

在此之前，`Free` tier snapshot bundle 继续作为删除门禁与迁移保护的必要证据。

## 结果

直接结果如下：

- `docs/runbooks/qdrant-cloud-backup-and-restore-runbook.md` 承担 operator 流程
- `docs/decisions/adr-0002-local-minio-conventions.md` 需要补充对象存储中的 snapshot bundle 前缀
- `docs/architecture/data-plane-architecture.md` 需要明确“snapshot bundle 只是备份材料，不是新的 chunk truth”
- `docs/reference/runtime-serving-and-index-terms.md` 需要补充 managed backup 与 snapshot bundle 术语
- `docs/runbooks/index-release-runbook.md` 的清理门禁需要引用本 ADR

明确不做：

- 不把 `Free` tier snapshot/export 宣称为 managed DR
- 不把 alias mapping 留在 operator 脑内或聊天记录里
- 不在对象存储里保存无 manifest 的孤立 snapshot 文件
- 不要求 `Standard` 模式继续默认镜像所有 managed backups 到对象存储

## 外部依据

- Qdrant Cloud create cluster: https://qdrant.tech/documentation/cloud/create-cluster/
- Qdrant Cloud backups: https://qdrant.tech/documentation/cloud/backups/
- Qdrant snapshots: https://qdrant.tech/documentation/concepts/snapshots/

## Complements

这项决策 complements：

- `docs/decisions/adr-0019-qdrant-physical-collection-retention-and-expiration.md`
- `docs/decisions/adr-0002-local-minio-conventions.md`
- `docs/architecture/data-plane-architecture.md`
- `docs/reference/runtime-serving-and-index-terms.md`
- `docs/runbooks/index-release-runbook.md`
