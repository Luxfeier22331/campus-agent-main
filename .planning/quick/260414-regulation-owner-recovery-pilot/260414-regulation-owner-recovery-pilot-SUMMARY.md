# Quick Task 260414-regulation-owner-recovery-pilot Summary

**Description:** 验证 attachment/file-release backed regulation notice 的离线 owner recovery 可行性  
**Mode:** quick-full-research  
**Status:** completed

## Outcome

- 已确认真正缺口是 `attachment_document` provenance 传播，不是 promotion 分类逻辑本身：
  - 旧实现未把 `attachment_content_sha256` 从 attachment projection 计划传到 promotion manifest
  - promotion 对旧快照也缺少从 `source-truth/attachment-refs.jsonl` 的回填
- 已完成修复：
  - `build_authenticated_notice_attachment_projection_plans()` 现在会保留 `attachment_content_sha256`
  - `internal_notice_regulation_promotion` 对旧 inventory/source snapshot 会从 canonical attachment refs 回填 `source_attachment_sha256`
- fresh pilot 结果：
  - `355282 / 关于发布《中央民族大学关于学生使用人工智能的指导意见（2026版）》的通知`
    - owner child `notice_attachment:muc_internal_portal:355282:attachment-0001`
    - 已恢复为 `promote_candidate`
    - parent notice 继续停在 `hold_in_internal_notice`
  - `351119 / 关于《<中央民族大学差旅费管理办法>（民大校发〔2025〕104号）》发布实施的通知`
    - 仍 blocked
    - blocker 继续是 `file_release_backed_regulation_body_missing`

## Follow-up Truth

- regulation lane 的 owner-body recovery frontier 已从 `351119 + 355282` 收缩为只剩 `351119`
- `355282` 后续可以进入受控的 regulation target materialization，但当前仍不触碰 chunk prep、embedding、Qdrant、release 或 alias publish
