---
doc_type: architecture
status: active
created: 2026-04-02
updated: 2026-04-02
---

# Data Plane Architecture

## 文档边界

本文冻结 repo 级 data plane / source-truth supporting architecture。

它回答的是：

- canonical upstream chain 是什么
- raw、source truth、projection、document truth、chunk/index 分别属于谁
- 哪些规则是 repo 级 shared contract，哪些属于 collection-specific strategy

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

## Object Storage Semantics

对象存储在架构语义上始终视为：

- `S3-compatible object storage`

当前即使本机部署或通过 MinIO 落地，也不改变这条语义。

## Collection-Specific Rules

以下内容不在本文内展开：

- handbook-specific normalization / split / cleanup 细节
- curriculum-specific chunking / serving nuances
- official web page-level source-truth schema 细节

这些分别以：

- `docs/reference/student-handbook-normalization-strategy.md`
- `configs/ingestion/*`
- `docs/architecture/official-web-source-truth-contract.md`

为准。

## Current Scope

当前 data plane 已支撑：

- `regulations/student_handbook`
- `curriculum/curriculum_plan`
- `curriculum/course_facts`
- `official_web` source channel 的 control-plane / source-truth path

## Forbidden Shapes

- 不把 raw local path 语义提升成长期 truth source
- 不让新增下游 collection 在 source truth 已存在时返回 raw 重新消费
- 不把 source-truth contract 污染成 document truth 或 retrieval truth
- 不把 online query logic 混回 data-plane layer

## 相关稳定文档

- `docs/decisions/adr-0002-local-minio-conventions.md`
- `docs/decisions/adr-0019-qdrant-physical-collection-retention-and-expiration.md`
- `docs/decisions/adr-0020-qdrant-cloud-backup-restore-and-object-store-transition.md`
