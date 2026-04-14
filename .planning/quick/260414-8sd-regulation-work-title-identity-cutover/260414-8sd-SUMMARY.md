# Quick Task 260414-8sd Summary

**Description:** 切换 regulation target 到 work-title identity，并把 projected/materialized title 收口到 display_title  
**Mode:** quick-full-research  
**Status:** completed

## Outcome

- `regulations/institutional_regulations` 的 current execution 现已切到：
  - `document_id <- regulation_work_title + issuing_org + semantic_scope`
  - projected/materialized `title <- regulation_display_title`
- `regulation_title_normalized` 与 `source_title_literal` 继续保留为 source-facing title metadata。
- canonical markdown 标题仍保留原题名，不强制改写成斜杠显示格式。

## Verified Behaviour

- `中央民族大学关于学生使用人工智能的指导意见（2026版）`
  - `document_id` 使用 `中央民族大学关于学生使用人工智能的指导意见`
  - `title` 显示为 `中央民族大学关于学生使用人工智能的指导意见 / 2026版`
  - canonical markdown 标题仍为 `中央民族大学关于学生使用人工智能的指导意见（2026版）`
- `中央民族大学实验室安全管理规定（2026年修订）`
  - target metadata `title` 显示为 `中央民族大学实验室安全管理规定 / 2026年修订`

## Remaining Work

- 这次没有做 replay / rematerialization。
- 下一步如要让现有 target rows 全部统一到新 identity，需要单独开 regulation-lane replay/rematerialization quick task。
