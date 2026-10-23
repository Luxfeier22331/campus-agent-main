---
doc_type: runbook
owner_boundary: data-platform
status: active
---

# 数据恢复

## 边界

本文记录源码仓可确认的 PostgreSQL、对象存储和 Campus RAG 恢复事实，以及环境 owner 在恢复演练中
必须提供的证据。它不创建备份供应商、恢复控制器或自动清理任务，也不把仓库清单当作生产环境状态。

## 当前清单事实

当前源码清单显示：

- CNPG PostgreSQL 为 2 实例，每实例存储 `30Gi`；资源额度由环境 overlay 设置；
- Barman Cloud Plugin 连续归档 WAL，每日 20:00 UTC 备份，ObjectStore 的 `spec.retentionPolicy` 为 `7d`；
- 备份依赖的 Secret、ObjectStore、网络规则先于 Cluster 协调，ScheduledBackup 在 Cluster 之后；
- RustFS 为单副本，存储 `20Gi`；
- 对象 bucket 使用 versioning 时，源码合同仍不能据此推断存在独立备份。

这些是仓库 desired state 的事实，不能据此断言生产环境没有备份，也不能据此推断能够达到某个 RPO/RTO。

## 环境 owner 必须提供

对每个实际环境，恢复前应记录：

1. PostgreSQL backup destination、保留期、最近成功时间和可恢复时间点；
2. RustFS/S3 兼容对象存储的独立备份目的地、对象版本/删除标记保留期和最近成功时间；
3. 目标 RPO/RTO 及其负责人；
4. 最近一次隔离目标 restore drill 的开始/结束时间、revision、结果和遗留问题。

没有这些证据时，只能称为“清单存在”，不能称为“可恢复”或“已验证恢复”。

## 恢复顺序

1. 先停止会写入恢复目标的应用和发布 Job，记录 revision、migration ledger 和当前索引指针。
2. 将 PostgreSQL 恢复到隔离目标；不要直接覆盖当前数据库。
3. 将对象恢复到隔离 bucket/prefix；保留对象 key、VersionId、delete marker 和 checksum。
4. 在隔离目标核对 schema migration ledger、schema owner、runtime grants、关键表约束和索引。
5. 按 `source.json` 及其 reader、补充对象引用核对 `byteSize` 与 `sha256`；不从 bucket listing 推断存活集合。
6. 核对 `campus_docs_serving.current_index` 指向的统一 Qdrant collection 是否存在、配置一致，且同时
   包含 Docs 与 Notice point；按显式 Docs/Notice Embedding Set 引用核对两条 artifact chain 的 manifest、
   Chunk/Chunk Run 和向量数量。
7. 通过所属应用的健康检查和最小读取/写入演练验证恢复目标，再由环境 owner 决定是否切换。

## 数据边界

- App API 负责用户、会话、账号关联数据和原始执行输入；
- agent-control 负责 execution projection，账号删除时清理，但 `owner_deletion_fences` 的 deleted
  tombstone 只保留防复活所需的最小状态；
- Temporal/platform 负责 workflow history retention，不由账号删除任务即时清除；
- Hindsight 负责 personal memory bank 和内容；
- 来源 owner 负责门户原始 source/file/source.json；
- Campus RAG serving 负责 Docs/Notice chunk/embedding 制品、统一当前索引和旧 collection 的人工清理；
  `jobs/retrieval-index` 是 `campus_docs_serving.current_index` 的唯一写入者。

恢复演练不得把这些不同 owner 的事实合并成一个 PostgreSQL 表，也不得复制 Hindsight、Temporal 或 Qdrant
的内部历史来“补齐”恢复证据。

## 相关文档

- [PostgreSQL 所有权](../data/postgres-ownership.md)
- [对象存储 ADR](../../.agents/notes/implemented/architecture/2026-07-16-object-storage.md)
- [Campus Docs 维护与索引发布](./ingestion/campus-docs.md)
- [Temporal runbook](./runtime/temporal.md)

## CNPG 备份恢复与失败副本重建

先确认 primary/targetPrimary、最近完成的基础备份和 `pg_stat_archiver`，修复归档连接后再处理失败副本。
数据库实际服务证书必须与环境 `PGHOST`、CA 挂载和 `verify-full` 一致；备份改动不改变现有 TLS 合同。

隔离恢复 Cluster 使用 `bootstrap.recovery.source` 引用 `externalClusters[].plugin`，插件参数
`barmanObjectName` 指向 ObjectStore，`serverName` 指向原集群。按名称恢复时，
`recoveryTarget` 必须同时设置已完成备份的 `backupID` 和 `targetName`。
恢复目标使用独立 PVC，不挂业务 Service，不配置向原备份目的地归档的 plugin；放行 operator、DNS、
Kubernetes API 和 RustFS 连接。验证成功后只清理演练 Cluster、PVC 和对应网络策略。

失败副本确需重建时，先确认它不是 primary 或 targetPrimary。staging 使用 local-path；保留失败副本
底层 PV 时先把该 PV reclaimPolicy 改为 `Retain`，再用 CNPG destroy 删除该副本的 Pod/PVC，
由 operator 新建副本。不要只保留同名 PVC 后期待 operator 跳过旧实例编号。
核对新 PVC/PV、两实例 Ready 和 replication `streaming`，旧 PV 保持 Released/Retain，后续删除单独处理。

2026-09-29 staging 演练使用基础备份 `20260928T214911` 和命名恢复点 `campus_repair_20260929`，
恢复实例读取到 7,241 条通知与原 `current_index`，随后清理隔离资源。
该结果证明当时备份和 WAL 可恢复；数据库、RustFS 与副本仍在同一节点，不代表节点丢失后的恢复能力。
相关故障经过见[集群恢复复盘](../postmortem/0002-staging-postgres-pipeline-recovery.md)。
