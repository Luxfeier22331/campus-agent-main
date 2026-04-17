# Quick Task 260414-regulation-effective-date-and-355282-materialization Summary

**Description:** 收口 regulation lane 的 effective_date 语义，并对 `355282` 做隔离 materialization 验证  
**Mode:** quick-full-research  
**Status:** completed

## Outcome

- 已完成 promotion metadata 语义收口：
  - `effective_date` 已从 `required_promotion_metadata` 移出
  - `source_notice_release_time` 明确保留为 notice-issued provenance metadata
  - `effective_date` 继续保留，但仅在 owner text 明确给出时写入
- 已完成 `355282` 的 isolated materialization：
  - target document 成功进入 `regulations/institutional_regulations`
  - `semantic_owner_kind=attachment_document`
  - `source_notice_release_time=2026-03-27 15:15`
  - `effective_date=null`
- 当前 regulation lane 的真实 blocker 仍只剩：
  - `351119 / 关于《<中央民族大学差旅费管理办法>（民大校发〔2025〕104号）》发布实施的通知`

## Residual Observation

- isolated replay 中 `355282` 的 source rows 与 target row 当前都还是 `is_current=false`
- 这说明 currentness posture 还在更上游的 authenticated-notice import/projection 线，不是本轮 regulation materialization 引入的新问题
