---
phase: "11"
name: "Image/OCR Default-On For WeChat Notice"
status: completed
created: 2026-04-28
updated: 2026-04-30
---

# Phase 11 Plan

## Goal

让公众号通知的 inline images 默认进入 OCR/multimodal 派生处理，避免图片承载
班次、地点或流程信息时被静默丢失。

## Scope

- Inline image refs enter multimodal candidate posture by default.
- OCR/multimodal outputs are derived projection artifacts, not source-truth fields.
- Pending OCR keeps read-model/query serving non-queryable.
- Drain results reproject notice rows and rebuild read model.

## Verification

- Multimodal attempt store records each image attempt.
- Runtime smoke requires pending multimodal rows to have source image refs and at
  least one attempt.
