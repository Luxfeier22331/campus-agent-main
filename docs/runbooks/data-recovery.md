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

- CNPG PostgreSQL 为单实例，存储 `30Gi`，容器 memory limit 为 `1536Mi`；
- CNPG 清单未声明 backup/PITR/WAL archive 或 `PodMonitor` desired state，且 `enablePodMonitor: false`；
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
- execution-control 负责 execution projection，账号删除时清理，但 `owner_deletion_fences` 的 deleted
  tombstone 只保留防复活所需的最小状态；
- Temporal/platform 负责 workflow history retention，不由账号删除任务即时清除；
- Hindsight 负责 personal memory bank 和内容；
- 来源 owner 负责门户原始 source/file/source.json；
- Campus RAG serving 负责 Docs/Notice chunk/embedding 制品、统一当前索引和旧 collection 的人工清理；
  `jobs/campus-rag-index-publisher` 是 `campus_docs_serving.current_index` 的唯一写入者。

恢复演练不得把这些不同 owner 的事实合并成一个 PostgreSQL 表，也不得复制 Hindsight、Temporal 或 Qdrant
的内部历史来“补齐”恢复证据。

## 相关入口

- [PostgreSQL 所有权](../data/postgres-ownership.md)
- [对象存储 ADR](../../.agents/notes/implemented/architecture/2026-07-16-object-storage.md)
- [Campus Docs 维护与索引发布](./campus-docs.md)
- [Temporal runbook](./temporal.md)
