# Quick Task 260414-bsz Summary

**Description:** 修复 `355282` 的 source projection 缺口并将其正式并入 local regulation target  
**Mode:** quick-full  
**Status:** completed

## Outcome

- 已修复 `355282` 的 local source-truth 缺口：
  - parent source row 曾存在
  - 但 `attachment-refs.jsonl` 为空
  - 现已从 frozen filtered bundle + frozen object-store source bytes 完成 bounded repair
- 已完成 `355282` 的 targeted source projection rebuild：
  - source rows 现为
    - `notice:muc_internal_portal:355282`
    - `notice_attachment:muc_internal_portal:355282:attachment-0001`
- 已完成 accepted notice set + `355282` 的 filtered formal materialization：
  - `before_target_count = 10`
  - `after_target_count = 11`

## Materialized Truth

- 新进入 current target 的 regulation 为：
  - `中央民族大学关于学生使用人工智能的指导意见 / 2026版`
- target identity/current metadata：
  - `document_id = institutional_regulation:muc:中央民族大学关于学生使用人工智能的指导意见:089bcf7907da`
  - `semantic_owner_kind = attachment_document`
  - `source_notice_release_time = 2026-03-27 15:15`
  - `effective_date = null`

## Boundary

- 本轮只写 local source/object-store/local Postgres
- 没有写：
  - embeddings
  - Qdrant
  - release manifests
  - aliases
