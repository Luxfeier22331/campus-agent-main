---
doc_type: plan
status: planned
created: 2026-04-29
updated: 2026-04-29
---

<!-- markdownlint-disable MD013 -->

# Phase 5 Plan: Multimodal OCR Consumption Readiness

## Goal

让图片、PDF、Office 附件中的正文信息进入 searchable path 或明确 pending/failed，不再查询时临时补抓。
本 phase 还负责把当前分散的 schedule image OCR、internal notice multimodal、WeChat multimodal
attempt 口径统一成 notice 侧的多模态消费 ledger / attempt / normalized-output contract。

## Tasks

1. 生成 multimodal candidate inventory。
2. 设计统一 `notice_multimodal_consumption` ledger / attempt / normalized-output contract。
3. 将现有分散状态映射到统一 contract：
   - `internal_notice_schedule_image_ocr_attempt`
   - `internal_notice_multimodal_attempt`
   - `wechat_public_notice_multimodal_attempt`
   - source projection 中的 OCR / multimodal required metadata
4. 对 schedule/status/regulation 高价值媒体建立优先级。
5. 定义 OCR attempt 的 provider/model/object refs/provenance。
6. dry-run 生成 OCR batch manifest。
7. 将 OCR 结果 merge 到 searchable preview。
8. 输出仍缺关键视觉内容的 gap report。

## Acceptance

- 所有需要 OCR 的通知都有 pending/done/failed/skip 状态。
- schedule、internal notice、WeChat 的 OCR / 多模态状态都能投影到统一 ledger 口径。
- normalized output 至少区分 raw provider response、plain text、layout/table artifact 与 searchable merge input。
- 高价值 schedule/status/regulation 媒体不得无理由 skip。
- OCR 文本进入 searchable preview 时带 provenance。
