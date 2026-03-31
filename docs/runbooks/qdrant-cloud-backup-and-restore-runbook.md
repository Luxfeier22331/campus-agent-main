---
doc_type: runbook
status: active
created: 2026-03-31
updated: 2026-03-31
---

# Qdrant Cloud Backup And Restore Runbook

## 文档边界

这份 runbook 只回答 Qdrant Cloud 上 release-managed collection 的备份与恢复操作面：

- `Standard` automatic backups 怎么作为默认恢复覆盖
- 当前 `Free` tier 怎么用 snapshot-to-object-storage 补过渡期恢复窗口
- 恢复时 alias、manifest、retrieval 要按什么顺序校验

它不重复：

- retention role 与删除门禁定义：`docs/decisions/adr-0019-qdrant-physical-collection-retention-and-expiration.md`
- backup 模式与对象存储策略：`docs/decisions/adr-0020-qdrant-cloud-backup-restore-and-object-store-transition.md`
- index release 标准发布流程：`docs/runbooks/index-release-runbook.md`
- object storage bucket / key 不变量：`docs/decisions/adr-0002-local-minio-conventions.md`

## 备份模式选择

### 目标态：Qdrant Cloud Standard

默认使用 dashboard automatic backups 作为主恢复覆盖。

建议配置：

- daily backups：至少 `14` 天
- weekly backups：至少 `8` 周
- monthly backups：至少 `6` 个月

这条路径适用于：

- routine retention cleanup 前的恢复覆盖
- 整集群故障或误删后的主恢复入口
- release 已经进入稳定运营阶段的日常灾备

### 过渡态：当前 Free tier

当前 `Free` tier 不提供 managed backup / disaster recovery，因此要靠 per-collection snapshot bundle 补恢复窗口。

这条路径适用于：

- 当前环境仍是 `Free` tier
- 准备删除 `archive_candidate`
- 准备执行 model/schema/policy/retrieval-shape 迁移
- 需要为 `current`、`previous`、`migration_baseline` 补显式恢复证据

## Standard Automatic Backups

### 配置要求

在 dashboard 中确认：

1. backup frequency 已启用
2. daily / weekly / monthly retention 已满足本仓库基线
3. 能看到最近一次 successful backup 时间

### 删除门禁如何使用 Standard 备份

准备删除旧 physical collection 时，至少确认：

1. backup schedule 已启用
2. 最近一次 successful backup 晚于该 alias 最近一次受保护 release 的 publish 时间
3. 对应 `index-release.json` 与 `validation-summary.json` 已落盘
4. 当前没有 incident / rollback investigation 仍依赖该 release

### Standard 恢复流程

1. 在 dashboard 选定需要恢复的 backup 时间点。
2. 恢复目标 cluster。
3. 对照 `index-release.json` 核对目标 physical collection 是否存在。
4. 核对或重建 `serving_alias -> physical_collection_name` 绑定。
5. 检查 points count、payload 中的 release metadata、validation summary。
6. 做 retrieval 抽样或 acceptance 验证。

补充说明：

- managed backup 是 cluster-level 恢复面，但 alias correctness 仍以 release manifest 为准
- 如果恢复后 alias 缺失或不一致，按 release manifest 手动修正

## Free Tier Snapshot To Object Storage

### 触发时机

满足以下任一条件时，执行 snapshot bundle：

1. 新 release 进入 `current`、`previous` 或 `migration_baseline` 保护窗口
2. 删除 `archive_candidate` 前，但当前环境没有 Standard managed backup 覆盖
3. 执行 embedding model、dimensions、vector schema、chunk profile、cleaning policy、retrieval shape 迁移前

### 备份步骤

1. 从对应 release 的 `index-release.json` 读取：
   - `release_id`
   - `serving_alias`
   - `physical_collection_name`
   - `previous_physical_collection_name`
2. 读取当前 alias 绑定，生成 `alias_bindings`。
3. 通过 Qdrant API 创建 collection snapshot。
4. 下载 snapshot 到本地 operator 环境。
5. 计算 snapshot 的 `sha256`。
6. 将 snapshot 上传到 derived bucket：
   - `{corpus}/backups/{collection}/{release_id}/{backup_id}/{physical_collection_name}.snapshot`
7. 写入 `backup-manifest.json`：
   - `{corpus}/backups/{collection}/{release_id}/{backup_id}/backup-manifest.json`
8. 把本次操作关联到 release 记录或变更单。

### Backup Manifest 最小字段

`backup-manifest.json` 至少包含：

- `backup_id`
- `backup_mode`
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

注意：

- `alias_bindings` 必须显式保存，因为 collection snapshot 不包含 aliases
- snapshot 文件必须和 manifest 成对出现；只有二进制文件没有 manifest，视为不可用备份

### 对象存储布局

derived bucket 下固定使用：

- `{corpus}/backups/{collection}/{release_id}/{backup_id}/backup-manifest.json`
- `{corpus}/backups/{collection}/{release_id}/{backup_id}/{physical_collection_name}.snapshot`
- `{corpus}/backups/{collection}/{release_id}/{backup_id}/restore-report.json`

其中：

- `backup_id` 采用 `bYYYYMMDDTHHMMSSZ`
- `restore-report.json` 可选，仅在做 restore drill 或真实恢复后补写

## 恢复流程

### 从 Free tier snapshot bundle 恢复

1. 从对象存储找到目标 bundle：
   - `backup-manifest.json`
   - `{physical_collection_name}.snapshot`
2. 校验 snapshot 的 `sha256` 与 manifest 一致。
3. 将 snapshot 下载到本地 operator 环境。
4. 通过 Qdrant Cloud 支持的上传文件路径恢复 snapshot。
5. 按 `backup-manifest.json` 中的 `alias_bindings` 重建 alias。
6. 对照 `index-release.json` 核对：
   - `physical_collection_name`
   - `point_count`
   - payload release metadata
7. 做 retrieval 抽样或 acceptance 验证。
8. 如完成 restore drill 或真实恢复，补写 `restore-report.json`。

补充说明：

- Qdrant Cloud 不支持从外部 URL 直接恢复 snapshot，所以必须先下载，再上传恢复
- 恢复完成前，不要先把 serving alias 指回线上流量

### 恢复后最小验证

至少确认：

1. 目标 physical collection 存在
2. alias 指向与 manifest 一致
3. points count 与 release manifest 大致一致
4. payload 中存在 `index_release_id`、`index_release_manifest_key`、`index_release_alias`
5. retrieval 抽样通过

## 对象存储职责边界

对象存储在这套 runbook 里的职责是：

- 保存 source truth、document artifact、release manifest
- 在 `Free` tier 过渡期保存 snapshot bundle

对象存储不承担：

- 在线 query-serving
- canonical chunk truth
- 没有 manifest 的临时快照堆积

## 退出 Free Tier 过渡方案

满足以下条件后，才允许停止“默认导出 snapshot bundle”：

1. 集群已升级到 `Qdrant Cloud Standard`
2. automatic backups 已按仓库基线配置
3. 至少有一份 successful backup
4. 至少做过一次 restore drill，并验证 alias / manifest / retrieval 一致
