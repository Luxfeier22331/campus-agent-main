---
doc_type: plan
status: completed
created: 2026-04-10
updated: 2026-04-10
---

# Authenticated Notice Source Attachment Key 重组方案

## 文档边界

本文只负责一个问题：

- 如何修复 `authenticated_notice_portal` 在 source bucket 中遗留的 attachment object key 污染，并把后续 attachment source object 收口到 repo-owned canonical key contract

它回答的是：

- 当前 source bucket 到底哪里被污染
- 哪些 legacy key 仍被当前 source-truth 引用
- canonical attachment source key 应该长什么样
- 迁移顺序、验收门禁和清理顺序是什么

它不替代：

- `docs/decisions/adr-0002-local-minio-conventions.md` 的 bucket / object-store 不变量
- `docs/architecture/data-plane-architecture.md` 的 repo 级 data-plane chain
- `docs/architecture/authenticated-notice-source-truth-contract.md` 的 `notice` source-truth contract
- `docs/plans/internal-notice-policy-regulation-consumption-implementation.md` 的规章制度消费与 promotion 方案

## 当前问题

当前 `campus-rag-source` bucket 的主要结构仍是 canonical source prefix：

- `authenticated_notice_portal/...`
- `official_web/...`

但 authenticated notice 历史 donor intake 仍残留一批 legacy attachment objects，顶层前缀是 donor blob sha-style key，例如：

- `5b/5b96373175bfe5cb0658348c1fe454b6b40f31b4ee2d00ecc006a77399216d87/38f562f5-4e4d-42e8-bb27-0b2509956db9.png`
- `96/965e8ac0eeb07a9e0a01858435c9179e2ca989c21248196890c0bfbcb0c4f47b/7c5dd972-5dd3-4519-97f3-9644755f52b9.jpg`

这类 key 的问题不是“看起来不好看”，而是：

- 它们不符合 repo 的 source object key contract
- 历史 source-truth / provider artifact 一度直接引用这些 donor key
- 后续 replay / closeout / projection 曾被迫保留 donor key 语义

## 当前审计事实

截至 2026-04-10，本任务已有一轮 pre-cleanup 审计、一轮真实 cleanup 和一轮 post-cleanup 审计。

pre-cleanup fresh local audit：

- evidence dir：`.tmp/authenticated-notice-attachment-key-audit-20260410-153039`
- `audited_notice_count = 160`
- `attachment_refs_object_count = 6698`
- `legacy_key_count = 2399`
- `referenced_legacy_row_count = 0`
- `referenced_legacy_key_count = 0`
- `unreferenced_legacy_key_count = 2399`
- `canonicalizable_referenced_row_count = 0`
- `canonicalizable_referenced_key_count = 0`

provider artifact ad-hoc check：

- scanned `authenticated_notice_portal/**/provider/bundle-import-v1/attachment-observations.jsonl`
- `provider_artifact_count = 6698`
- `provider_legacy_artifact_count = 0`
- `provider_legacy_row_count = 0`

cleanup evidence：

- evidence dir：`.tmp/authenticated-notice-attachment-key-cleanup-20260410-154556`
- `inventory_row_count = 2399`
- `candidate_count = 2399`
- `deleted_count = 2399`
- `already_absent_count = 0`

post-cleanup fresh local audit：

- evidence dir：`.tmp/authenticated-notice-attachment-key-audit-20260410-154556-post-cleanup`
- `legacy_key_count = 0`
- `referenced_legacy_row_count = 0`
- `referenced_legacy_key_count = 0`
- `unreferenced_legacy_key_count = 0`
- `canonicalizable_referenced_row_count = 0`
- `canonicalizable_referenced_key_count = 0`

这说明：

- 问题是 attachment source object contract 被 donor key 污染
- source-truth / provider observation 的 legacy 引用已经在 cleanup 前归零
- 当前 source bucket 中的 legacy attachment objects 也已在 cleanup 后归零
- 问题不是 bucket 设计错误
- 问题也不是 derived bucket 需要重做

## Root Cause

历史污染来自 historical donor/import path：

- donor bundle 在 attachment observation 中保留了原始 `attachment.object_key`
- source-truth 生成时把这个 donor blob key 透传进了 `attachment-refs.jsonl`
- 后续 attachment backfill 继续按这个 legacy key 上传 bytes

因此历史 source-truth 虽然已经 repo-owned，但 attachment byte locator 一度仍不是 repo-owned。

## 目标

目标不是重做对象存储架构，而是把 attachment source object key 修回 repo contract。

固定目标：

- 继续维持两 bucket 模型：
  - `campus-rag-source`
  - `campus-rag-derived`
- 继续维持 `notice` 作为 source-truth unit
- 继续让 source-truth / provider / capture artifacts 与 attachment bytes 都留在 source bucket

要修复的是：

- attachment source bytes 的 key contract
- source-truth / provider observation 对 attachment key 的引用

## Canonical Attachment Source Key

后续 authenticated notice attachment source object 建议统一写成：

- `authenticated_notice_portal/attachment-<sha12>/<year>/sha256/<full_sha256>/capture/<normalized_filename>`

解释：

- 第一层仍是 `source_channel`
- 第二层是 attachment source asset slug，而不是 donor blob key
- 第三层仍是人类可读 `year`
- 第四、五层继续复用 repo 已接受的 source identity segment 语义，对应 `raw_version_id = sha256:<full_sha256>`
- `capture/` 继续表达这是 source bytes，而不是 provider / source-truth artifact

这条 key shape 不改写 notice source-truth unit，因为：

- `notice` 仍然是 canonical upstream unit
- attachment bytes 只是 notice source-truth 所引用的 source-owned object

## 迁移顺序

### Phase 1：只读审计

先产出三份 inventory：

- referenced legacy key inventory
- unreferenced legacy key inventory
- `legacy -> canonical` mapping inventory

这一阶段只读，不做 copy，不改 source-truth。

### Phase 2：修复新写入 contract

修复生成 attachment refs / provider observation / backfill object key 的代码路径，使新 source-truth 不再写 donor key。

当前状态：已完成。

这一步之后：

- 新 source-truth 只写 canonical attachment key
- 旧 source-truth 暂时还可继续读取 legacy key，但不再新增

### Phase 3：复制仍被引用的 legacy objects

只处理当前仍被 source-truth 引用的 legacy objects：

- 从 legacy key copy 到 canonical key
- 校验 byte size / content sha256 一致
- 记录 copy evidence

当前 repo 已提供 mapping-driven copy runner：

- `uv run --package campus-ingestion-worker python -m campus_ingestion_worker.copy_authenticated_notice_source_attachment_keys --mapping-path <legacy-to-canonical-mapping.jsonl> --output-dir <copy-evidence-dir>`

本地 evidence 目录固定产出：

- `copied-objects.jsonl`
- `existing-verified-objects.jsonl`
- `summary.json`

这一步不删除 legacy object。

当前状态：fresh local pre-cleanup audit 已经确认 `referenced_legacy_row_count = 0`，因此本轮不再需要执行 copy。

### Phase 4：重写 refs

在 canonical 副本就绪后，重写 source-truth / provider observation 中的 attachment object key 引用，使 replay 只依赖 canonical key。

当前 repo 已提供 referenced-inventory-driven rewrite runner：

- `uv run --package campus-ingestion-worker python -m campus_ingestion_worker.rewrite_authenticated_notice_source_attachment_refs --referenced-inventory-path <referenced-legacy-keys.jsonl> --output-dir <rewrite-evidence-dir>`

本地 evidence 目录固定产出：

- `rewritten-attachment-refs-artifacts.jsonl`
- `rewritten-provider-artifacts.jsonl`
- `summary.json`

当前状态：已完成。fresh local pre-cleanup audit 与 provider artifact 检查都已确认不再存在 legacy 引用。

### Phase 5：复核 replay / projection

只做 replay / projection 的只读或 bounded verification，确认：

- source-truth 可读
- attachment bytes 可读
- projection 可按 canonical key 成功取回 attachment bytes

当前最低门禁是重跑只读 audit，确认：

- `referenced_legacy_row_count = 0`
- `referenced_legacy_key_count = 0`
- `canonicalizable_referenced_row_count = 0`

当前状态：已完成，见 `.tmp/authenticated-notice-attachment-key-audit-20260410-153039/summary.json`。

### Phase 6：清理未引用 legacy objects

仅在前几步全部通过后，才删除未引用 legacy objects。

当前 repo 已提供 cleanup runner：

- `uv run --package campus-ingestion-worker python -m campus_ingestion_worker.cleanup_authenticated_notice_source_attachment_keys --unreferenced-inventory-path <unreferenced-legacy-keys.jsonl> --output-dir <cleanup-evidence-dir>`

本地 evidence 目录固定产出：

- `deleted-objects.jsonl`
- `already-absent-objects.jsonl`
- `summary.json`

当前状态：已完成。2026-04-10 本地真实 cleanup 已删除 `2399` 个 legacy objects，且 post-cleanup audit 已确认 `legacy_key_count = 0`。

固定禁止：

- 在 copy / ref rewrite / verification 完成前提前删旧 key
- 边迁移边顺手改 bucket 结构
- 把 derived bucket 的 operations prefix 当成污染一起“清理”

## 验收标准

这份重组方案完成后，至少应满足：

1. authenticated notice 新写入 attachment source bytes 不再使用 donor blob key
2. 当前仍被 source-truth 引用的 legacy attachment object 全部已有 canonical 副本
3. canonical key 可按 content hash 稳定回放，不依赖 `notice_id`
4. source-truth / provider observation 已能回链 canonical key
5. replay / projection 不再因为 donor key 消失而失败
6. 未引用 legacy objects 有完整 inventory 和删除证据

当前状态：以上 6 条均已满足。

## 非目标

- 当前不重做 `campus-rag-derived` bucket 结构
- 当前不重写 `notice` source-truth unit
- 当前不把 attachment bytes 迁入 Postgres
- 当前不把这条迁移和 embedding / Qdrant / alias publish 绑在一起

## 相关文档

- `docs/decisions/adr-0002-local-minio-conventions.md`
- `docs/architecture/data-plane-architecture.md`
- `docs/architecture/authenticated-notice-source-truth-contract.md`
- `docs/architecture/authenticated-notice-source-architecture.md`
- `docs/plans/internal-notice-policy-regulation-consumption-implementation.md`
- `docs/runbooks/authenticated-notice-source-truth-replay-runbook.md`

## 外部参考

- AWS S3 object keys
  - https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-keys.html
- AWS S3 prefixes
  - https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-prefixes.html
- AWS data lake layer definitions
  - https://docs.aws.amazon.com/prescriptive-guidance/latest/defining-bucket-names-data-lakes/data-layer-definitions.html
