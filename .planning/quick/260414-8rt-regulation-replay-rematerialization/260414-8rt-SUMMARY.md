# Quick Task 260414-8rt Summary

**Description:** 完成 regulation lane 的定向 replay/rematerialization，并把 ADR-0040 的 title/version identity 真正落到本地 regulation target  
**Mode:** quick-full-research  
**Status:** completed

## Outcome

- 已完成 `355282` 的隔离 replay：
  - `document_id` 使用 `regulation_work_title`
  - target `title` 使用 `regulation_display_title`
  - canonical markdown 标题继续保留 `中央民族大学关于学生使用人工智能的指导意见（2026版）`
- 已完成 Cohort A vetted notice-id 白名单的 formal local current-scope refresh：
  - target count 维持 `10`
  - 没有 manual-review / hold 泄漏进 `regulations/institutional_regulations`
  - 本地 target rows 现已补齐 `regulation_work_title / regulation_display_title / source_title_literal` 等 replay 后 metadata
- 本轮只写本地 MinIO / 本地 Postgres：
  - no embedding
  - no Qdrant
  - no release / alias

## Key Verification

- `355282`
  - `target_document_id = institutional_regulation:muc:中央民族大学关于学生使用人工智能的指导意见:089bcf7907da`
  - `target_title = 中央民族大学关于学生使用人工智能的指导意见 / 2026版`
  - `canonical_heading = 中央民族大学关于学生使用人工智能的指导意见（2026版）`
- Cohort A formal refresh
  - `promotion_candidate_count = 10`
  - `materialized_document_count = 10`
  - `before_target_count = 10`
  - `after_target_count = 10`

## Residual Work

- regulation lane 剩余的前向工作已不再是 replay/rematerialization 本身，而是：
  - 后续 admitted regulation family 的继续导入
  - target collection 的下游 chunk / serving / release 策略
  - `351119` 这类 file-release-backed owner body 缺失样本的恢复
