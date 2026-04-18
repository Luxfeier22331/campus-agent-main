---
doc_type: architecture
status: active
created: 2026-04-02
updated: 2026-04-19
---

# Data Plane Architecture

## 文档边界

本文冻结 repo 级 data plane / source-truth supporting architecture。

它回答的是：

- canonical upstream chain 是什么
- raw、source truth、projection、document truth、chunk/index 分别属于谁
- 哪些规则是 repo 级 shared contract，哪些属于 collection-specific strategy

补充约束：

- 当前 merged truth 的开放 surface 与产品执行状态不在本文维护，统一看 `docs/architecture/current-architecture.md` 与 `.planning/`
- 本文中的 “scope” 指 canonical data-plane support 范围，不等于 query-enabled 或 rollout 已完成

## Canonical Chain

repo 级 canonical data-plane chain 固定为：

`raw asset -> provider output -> source truth -> declared projections -> canonical document artifacts -> document-units -> chunks -> index`

这条链路适用于：

- institutional document OCR ingestion
- `official_web` source channel
- 其他后续 source-shared collection / corpus

## Source-Truth Rules

source truth 的长期硬约束：

- source truth 是 provider-agnostic shared upstream
- 一份 raw source asset 只生成一份 canonical source truth
- 一份 source truth 可以 fan-out 到多份 projection / collection / corpus
- source truth 不提前携带 document / chunk / retrieval 语义
- 后续 replay / rebuild 从 source truth 继续，而不是返回 raw 重消费

不同 `source_channel` 可以拥有各自的 source-specific contract 与 canonical source unit，只要不破坏这条 shared chain。

当前已接受的 source-specific contract 包括：

- `official_web`
  page-level source truth，详见 `docs/architecture/official-web-source-truth-contract.md`
- `authenticated_notice_portal`
  notice-level source truth，详见 `docs/architecture/authenticated-notice-source-truth-contract.md`

这不表示它们都已进入当前 merged truth；当前已落地范围仍以下文 `Accepted Data-Plane Scope` 为准。

## Shared File-Asset Loader Boundary

对 file-like asset，repo 级 data plane 固定允许插入一条 shared subchain：

`source-truth relation or file descriptor -> optional normalization -> extraction/provider artifacts -> terminal outcome or canonical child document artifacts`

固定规则：

- 这条 subchain 不改变 repo 的 canonical chain，只是把 file-like asset handling 从 source-specific path 收口成 shared contract
- source unit 继续由 source channel 定义；`official_web` 仍是 page-level source-truth，`authenticated_notice_portal` 仍是 notice-level source-truth
- shared file asset loader 的 canonical owner 固定为 `packages/ingestion-core`
- legacy binary Office、modern OOXML、PDF、image 的 admitted family 与 deployment posture 固定看 `docs/architecture/file-asset-loader-architecture.md`
- remote API 与 self-hosted service 都只是 shared contract 下的 deployment mode，不构成新的 data-plane layer

## Derived Collection Rebuild

当某个 collection 的上游已经不是 raw/source-truth，而是另一条 canonical document scope 的 `document-units` 时，固定规则为：

- materialization / rebuild 从 canonical `document-units` 开始，不返回 raw source bucket 或 provider replay
- 派生 collection 仍要把自己的 canonical document artifacts、registry rows 与 release manifest 独立落盘
- 派生 collection 的 indexing / alias publish 继续走 release-managed registry scope 流程

当前已接受实例：

- `curriculum/curriculum_plan -> curriculum/program_semester_facts`

## Layer Ownership

### Raw Layer

- source asset
- provider output
- provenance / audit / replay input

### Source-Truth Layer

- provider-agnostic layout / page / block truth
- projection upstream

### Document Layer

- canonical document identity
- revision / version truth
- document metadata
- document-units

### Chunk / Index Layer

- chunk metadata
- vector / sparse index
- serving-side evidence carrier

## Registry And Release Model

- raw asset registry 持有原始来源身份、版本与存储定位
- document registry 持有逻辑文档版本、hash、status 与 serving关联
- serving alias 指向当前 query-serving physical collection
- index release 通过 versioned physical collection + release manifest 追溯

对部分 `offline_preparation` collection，index release 之前允许插入一个 preparation gate。

固定规则：

- collection-specific `chunk preparation` 属于 data-plane 内的独立阶段，不等于 index release
- preparation 只负责 split / cleanup / chunk / validation，不负责 embedding / indexing
- preparation truth 固定落在 operations prefix，而不是 release prefix
- 当某个 collection 启用 hard gate 时，release 必须显式引用 verified preparation truth 才能继续

## Object Storage Semantics

对象存储在架构语义上始终视为：

- `S3-compatible object storage`

当前即使本机部署或通过 MinIO 落地，也不改变这条语义。

## Registry Database Connectivity

registry / control-plane database 与对象存储长期分层。

固定规则：

- Postgres 只承载 registry、run/progress truth 与其他关系型 metadata
- 对象 bytes 不迁入 Postgres，也不改变 `S3-compatible object storage` 的长期语义
- 当共享 Postgres 由 Supabase 承载且 repo-owned runtime 采用 IPv4-only 姿态时，运行时连接规则以 `docs/decisions/adr-0029-ipv4-session-pooler-postgres-connectivity.md` 为准

## Collection-Specific Rules

以下内容不在本文内展开：

- handbook-specific normalization / split / cleanup 细节
- curriculum-specific chunking / serving nuances
- official web page-level source-truth schema 细节
- authenticated notice notice-level source-truth schema 细节
- shared file asset family matrix、normalization / extraction / terminal outcome 细节

这些分别以：

- `docs/reference/student-handbook-normalization-strategy.md`
- `configs/ingestion/*`
- `docs/architecture/official-web-source-truth-contract.md`
- `docs/architecture/authenticated-notice-source-truth-contract.md`
- `docs/architecture/file-asset-loader-architecture.md`
- `docs/reference/internal-notice-offline-preparation-strategy.md`

为准。

## Accepted Data-Plane Scope

当前 data plane 已支撑以下 canonical scope：

- `regulations/student_handbook`
- `curriculum/curriculum_plan`
- `curriculum/course_facts`
- `curriculum/program_family_facts`
- `curriculum/program_semester_facts`
- `official_web` source channel 的 control-plane / source-truth path

这表示 repo 已为这些 scope 建立了 canonical data-plane 语义，并不表示它们都已开放 query-serving 或已完成当前 rollout。

## Authenticated Notice Async Staged Closeout

Phase 12.2 的 staged closeout 不改变 data-plane canonical chain，只改变 historical closeout 的执行模型；ADR-0026 进一步把 executor 升级为 batch-leased pipeline。

固定规则：

- run metadata、workers、milestones、batch manifests、batch input slices 与 staged document objects 落在 `campus_notices/operations/authenticated-notice-closeout/{run_id}/`
- `packages/ingestion-core` 通过 `ingestion_closeout.closeout_*` 表记录 run / shard / batch / worker / notice / raw asset / document / promotion staging truth
- planner 只负责冻结输入与计划，不得在 planning 阶段执行整份 bundle 的 source-truth prepare
- worker 只围绕 claimed batch 准备 source-truth 与 staged document artifacts；吞吐由 worker 数量扩展，而不是由单进程全局 bundle prepare 扩展
- notice/raw/document staging rows 与 run/shard/batch/worker counters 必须作为 batch 级单事务提交
- batch 围绕 canonical source-truth 与 declared document artifacts 工作，但 canonical final document scope 只允许 promoter 单写
- promoter 在 verification 通过后，才把 staged document artifacts 复制到 `campus_notices/documents/internal_notice/...` 并执行 `replace_scope`
- 若 collection 额外启用了 registry-scope chunk preparation，则 preparation artifacts 固定落在 `campus_notices/operations/registry-scope-chunk-preparation/{run_id}/...`，它们属于 operations truth，不属于 release truth

因此被并行化的是 staging，而不是 canonical document scope mutation。

## Forbidden Shapes

- 不把 raw local path 语义提升成长期 truth source
- 不让新增下游 collection 在 source truth 已存在时返回 raw 重新消费
- 不把 source-truth contract 污染成 document truth 或 retrieval truth
- 不把 online query logic 混回 data-plane layer

## 相关稳定文档

- `docs/architecture/current-architecture.md`
- `docs/decisions/adr-0002-local-minio-conventions.md`
- `docs/decisions/adr-0019-qdrant-physical-collection-retention-and-expiration.md`
- `docs/decisions/adr-0020-qdrant-cloud-backup-restore-and-object-store-transition.md`
- `docs/decisions/adr-0025-authenticated-notice-async-staged-closeout.md`
- `docs/decisions/adr-0026-authenticated-notice-batch-leased-closeout-throughput.md`
- `docs/decisions/adr-0029-ipv4-session-pooler-postgres-connectivity.md`
- `docs/architecture/authenticated-notice-source-truth-contract.md`
- `docs/architecture/file-asset-loader-architecture.md`
- `docs/reference/internal-notice-offline-preparation-strategy.md`
