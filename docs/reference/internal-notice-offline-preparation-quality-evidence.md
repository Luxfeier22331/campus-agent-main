---
doc_type: reference
status: active
created: 2026-04-06
updated: 2026-04-06
---

# Internal Notice Offline Preparation Quality Evidence

## 文档边界

本文记录 `campus_notices/internal_notice` 在 2026-04-06 的一次真实离线质量验收结果。

它回答的是：

- 当前 repo-owned `internal_notice` scope 是否已经通过 preparation quality acceptance
- 当前失败主要集中在哪些 lane 和失败类型
- 哪些问题是结构性 blocker，哪些问题只是观察指标

它不替代：

- `docs/reference/internal-notice-offline-preparation-quality-acceptance.md` 的验收标准
- `docs/reference/internal-notice-offline-preparation-strategy.md` 的 lane strategy

## 执行方式

本次验收通过 repo 内只读 validator 执行：

```bash
uv run --package campus-ingestion-worker python -m campus_ingestion_worker.validate_internal_notice_chunking \
  --sample-dir /tmp/internal_notice_chunk_samples_20260406
```

输入范围：

- `selection_mode=current_scope`
- `corpus=campus_notices`
- `collection=internal_notice`
- 未向 Postgres、对象存储 derived truth、embedding provider 或 Qdrant 写入任何数据

## Verdict

本次结果固定为：

- `failed`

因此当前 `internal_notice` 只能写成：

- `structurally scannable but not quality accepted`

不能写成：

- `internal_notice offline preparation accepted`

## Repo Remediation Status

截至 2026-04-06，针对这份证据里最明确的实现级 blocker，repo 已经补上两项 remediation：

- derived attachment artifact key 现在按完整 `document_id` 派生稳定目录 identity；不同 notice 下同名 `attachment-0001` 不再共享同一路径
- `attachment_ocr_required` lane 已改成结构化 materialization：OCR child document 会额外落 `layout-elements.jsonl`，并把正文拆成 `section_text` / `table_unit` 等结构化单元，canonical markdown 与最终 document units 不再直接承接 raw html table markup

这两项只能说明：

- repo implementation 已朝正确方向修复

它们还不等于：

- 历史 current scope 已重新跑完 validator
- 本文上面的 `failed` verdict 已被自动推翻

因此在新的真实 replay + validator evidence 产出之前，本文仍保留这次 run 的历史失败结论。

## Summary

本次 run 的 machine-readable summary 如下：

- `registry_record_count=6962`
- `selected_record_count=6962`
- `validated_document_count=6961`
- `total_units=118569`
- `total_chunks=42273`

lane 分布：

- `notice_body`: `6694` docs / `41173` chunks
- `attachment_ocr_required`: `265` docs / `1094` chunks
- `attachment_text_extractable`: `2` docs / `6` chunks

结构观察：

- `split_reason=token_guardrail`: `2033`
- `notice_body_token_guardrail_chunk_count=779`

这些指标本身不直接构成 blocker；真正 blocker 在下文。

## Blocking Findings

### 1. Derived attachment identity mismatch

存在 1 条 attachment child document 无法通过 chunk build：

- `document_id=notice_attachment:muc_internal_portal:353901:attachment-0001`
- `artifact_key=campus_notices/documents/internal_notice/关于两校区通勤班车新增班次的通知-附件-1-1-jpg--attachment-0001/source-faithful/2025/document-units.jsonl`
- validator 读到的 `structured doc_id` 实际是 `notice_attachment:muc_internal_portal:354270:attachment-0001`

这不是质量观感问题，而是 derived artifact identity truth 被污染，必须先修。

### 2. OCR attachment cleanup 仍大量泄漏 raw markup

- `markup_leak_chunk_count=724`

当前失败样本清楚表明，OCR attachment 的 `attachment_body` 里仍残留：

- `<div ...>`
- `<table ...>`
- `<tr><td ...>`

这说明当前 attachment cleanup 还没有把 OCR / layout extraction 结果收敛成 repo 期望的 clean text / structured text truth。

### 3. OCR lane 仍存在 header-dominant 与 noise-suspect chunks

- `header_dominant_ocr_chunk_count=130`
- `noisy_ocr_chunk_count=31`

这说明 OCR lane 里仍有一批 chunk：

- 标题 header 已经明显压过正文
- 正文仍带脏表格片段、截断片段或低信息密度内容

这类问题必须在 OCR attachment lane 内收口，不能通过进一步缩小 `notice_body` budget 来“均摊”。

### 4. Notice body 只有少量 fragmentation，但仍未清零

- `notice_body_fragmentation_count=5`

这说明 parent notice body 不是当前主瓶颈，但仍存在少量过切样本，需要和 attachment 问题分开处理。

## Non-Blocking Observations

以下结果说明当前 lane separation 方向是对的：

- `missing_title_chunk_count=0`
- `missing_contextualization_count=0`
- `missing_lane_metadata_count=0`
- `missing_attachment_lineage_count=0`
- `attachment_without_body_count=0`
- `replacement_character_chunk_count=0`

这意味着：

- title / contextualization / lane metadata / attachment lineage 传播已经基本稳定
- 当前主要缺口不是 metadata completeness
- 当前主要缺口是 OCR attachment cleanup 与少量 derived artifact identity corruption

## Sample Evidence

本次 run 导出的 sample buckets 包含：

- `notice-body`
- `attachment-text`
- `attachment-ocr`
- `notice-body-fragmentation`
- `ocr-noise-suspect`
- `html-leak-or-markup-leak`

关键样本结论：

- `notice-body-fragmentation` 样本显示正文主链路总体可读，fragmentation 只在少量样本上出现
- `ocr-noise-suspect` 样本显示 OCR attachment 直接把 HTML table 片段带进 chunk text
- `html-leak-or-markup-leak` 样本进一步证明 cleanup 尚未把 `<div>` / `<table>` 这类 raw markup 清掉

本次本机 sample export 输出目录为：

- `/tmp/internal_notice_chunk_samples_20260406`

## Current Closeout

截至 2026-04-06，这次验收可收口的结论是：

1. `internal_notice` 不可进入 embedding / Qdrant / release。
2. parent notice body 质量整体可保，但不能拿它来掩盖 attachment lane 的真实问题。
3. 下一步必须优先修两类问题：
   - derived attachment `document-units.jsonl` identity mismatch
   - OCR attachment cleanup / semantic normalization

只有在上述 blocker 清零后，才应再次运行质量验收并更新本证据文档。
