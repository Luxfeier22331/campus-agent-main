---
doc_type: reference
status: historical
created: 2026-04-06
updated: 2026-04-12
---

# Internal Notice Offline Preparation Quality Snapshot

## 文档边界

本文只保留 `campus_notices/internal_notice` 四次离线 preparation / release 验收的历史快照。

本文回答的是：

- `2026-04-06` 到 `2026-04-11` 之间，`internal_notice` 离线质量是如何从失败走到 replay/preparation/promote/unpublished release 的
- 各轮历史证据各自证明了什么
- 哪些结论后来迁移到了 active acceptance / strategy / runbook

本文不负责：

- 充当当前 active quality 入口
- 长期维护每轮 sample 目录、artifact 清单和逐条排障过程

当前应优先阅读：

- `internal-notice-offline-preparation-quality-acceptance.md`
- `internal-notice-offline-preparation-strategy.md`
- `docs/runbooks/authenticated-notice-source-truth-replay-runbook.md`
- `docs/runbooks/internal-notice-policy-regulation-promotion-runbook.md`

## Historical Timeline

### 2026-04-06 Current-Scope Failure

这轮历史结果固定为 `failed`。

当时最关键的 blocker 是：

- derived attachment identity mismatch
- OCR attachment cleanup 仍大量泄漏 raw markup
- OCR lane 仍存在 header-dominant / noisy chunks
- parent notice body 只有少量 fragmentation，但不是主瓶颈

这轮历史意义是：

- 证明 `internal_notice` 当时仍不能进入 embedding / Qdrant / release
- 明确后续修复重点必须落在 attachment identity 与 OCR lane cleanup，而不是 parent body 主链路

### 2026-04-09 Replay Pilot

这轮 replay pilot staged evidence 固定为 `passed`。

关键历史数值：

- `selected_scope = 9 notices / 20 staged documents`
- `validated_document_count = 20`
- `total_chunks = 102`
- `header_dominant_ocr_chunk_count = 0`
- `noisy_ocr_chunk_count = 0`
- `markup_leak_chunk_count = 0`

这轮历史意义是：

- 验证了 bounded replay pilot 的 staged chunk quality 可接受
- 证明 attachment title builder 和 manifest-based validator 修复已经开始生效
- 但它仍然不是 current-scope canonical preparation accepted

### 2026-04-10 Local Postgres Full Current-Scope Replay And Preparation

这轮 local Postgres evidence 固定为：

- current-scope replay：`verified`
- preparation validation：`passed`

关键历史数值：

- inventory：`20 notices / 21 documents`
- `manual_review_required_attachment_count = 5`
- `materialized_ocr_attachment_document_count = 0`
- current-scope preparation quality：`accepted`

这轮历史意义是：

- accepted current scope 已在 local Postgres + local MinIO 上完成 full replay + preparation 验证
- 选课通知里的操作指引类 inline image 已转入 `manual_review_required`，不再错误进入 OCR lane
- 但这仍然不是 release / alias publish 完成

### 2026-04-11 Local Promote And Unpublished Release

这轮历史结果固定为：

- promote：`done`
- unpublished release：`passed`

关键历史数值：

- `promotion_id = promotion-0001`
- `copied_document_count = 21`
- `raw_asset_synced_count = 20`
- `release_id = r20260411_090101`
- `physical_collection_name = internal_notice__r20260411_090101`
- `document_count = 21`
- `point_count = 213`
- `published_at = null`

额外留下的一条运行面历史结论：

- 当时这条 WSL shell 上的 Qdrant / provider release 路径对代理变量敏感，正确做法是显式把大小写代理变量全部置空，而不是只 `unset`

这轮历史意义是：

- current-scope replay 已 promote 到 canonical registry scope
- `internal_notice` 已完成一次 unpublished offline release
- 但 alias 未发布，query-serving 也未开放

## Historical Evolution Summary

这四轮历史证据共同说明：

1. `internal_notice` 的离线质量问题先暴露在 attachment identity 与 OCR lane cleanup。
2. bounded replay pilot 先证明了修复方向正确。
3. local Postgres full current-scope replay + preparation 随后证明 accepted current scope 可以完整重放并通过 preparation validator。
4. promote + unpublished release 最终证明 release chain 已经跑通到未发布物理 collection。

## Superseded By

这些历史证据后来被 active 文档接管：

- 验收标准：`internal-notice-offline-preparation-quality-acceptance.md`
- lane 策略：`internal-notice-offline-preparation-strategy.md`
- 执行步骤：相关 replay / promotion runbooks

因此本文现在只保留追溯价值，不再作为 active quality 入口。
