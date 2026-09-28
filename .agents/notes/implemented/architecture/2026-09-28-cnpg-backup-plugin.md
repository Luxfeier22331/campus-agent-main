# Agent Note: CNPG PostgreSQL 备份与 2 实例拓扑

Status: implemented

## 背景

`campus-agent-postgres` 集群长期单实例运行且没有任何备份：staging 的存储是
`local-path`（不支持 CSI 快照），节点或 PV 损坏即数据不可恢复。同时单实例意味着
operator 滚动升级或 Pod 重建期间数据库完全不可用。

## 决策

采用 **Barman Cloud Plugin**（CNPG-I）为集群启用连续 WAL 归档 + 每日基础备份
（20:00 UTC = 上海时间 04:00），实例数从 1 提升到 2。备份落到集群内已有的
RustFS 对象存储，使用专用 bucket `campus-agent-postgres-backups` 与最小权限凭据。
恢复通过新 Cluster 的 `bootstrap.recovery` 指向同一 ObjectStore 完成 PITR。

配置归属：`instances`、plugins 段、ObjectStore 结构、ScheduledBackup 调度归源码仓
base（备份行为是架构行为，同 schema Job 先例）；endpoint 与备份凭据归 gitops
overlay（环境连接信息）；bucket 声明与凭据 policy 归 `data-object-store` 的
bootstrap。

## 未采用方案

- in-tree `spec.backup.barmanObjectStore`：CNPG 1.26 起弃用，当前 chart 0.29.0
  对应 operator 1.30.0，不应新增已弃用配置。
- Volume Snapshot：staging 的 local-path 不支持快照，且 WAL 归档仍需对象存储。
- 外部 S3：集群内已有 RustFS，引入外部依赖无当前需求；未来切换只需在 overlay
  patch endpoint 与凭据。

## 后果

- `archive_timeout` 为 5 分钟，每日一次基础备份，retention 7 天；实际 RPO 取决于归档成功时间；
  staging 数据可重建，7 天足够恢复演练。
- 新增一个部署单元 `platform-cnpg-plugin-barman-cloud`（chart 0.8.0，与 operator 同
  namespace、同治理分组），退役条件是 CNPG 官方更换备份插件机制。
- staging 内存占用翻倍（384Mi × 2），已确认接受。
- 新增副本由 operator 初始化；备份迁移不改变原有服务端证书与客户端 CA 合同。

2026-09-29 恢复修正了 ObjectStore retention 的层级，并将 ObjectStore 与实例网络策略移到 wave -2、
ScheduledBackup 移到 wave 2。实例必须允许同集群 5432 复制和 RustFS 9000 归档；否则副本初始化与
归档同时失败。隔离恢复已验证基础备份与命名恢复点。staging 的两个实例和 RustFS 同节点，当前选择
不提供节点级容灾；不把 5 分钟 archive_timeout 表述为无条件 RPO 保证。
操作见[数据恢复](../../../../docs/runbooks/data-recovery.md)，事件见[复盘](../../../../docs/postmortem/0002-staging-postgres-pipeline-recovery.md)。
