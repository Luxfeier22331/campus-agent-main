---
doc_type: phase_summary
workstream: curriculum-course-map-multimodal-probe
phase: 5
created: 2026-04-25
---

# Phase 5: Responses GPT-5.5 Materialization Summary

## Outcome

`Responses + gpt-5.5` 已用于补齐公开文档站缺失的 `curriculum_plan` 课程地图 reader assets。

最终覆盖：

- inventory docs: `46`
- inventory course-map entries: `79`
- published docs: `46`
- missing docs: `0`
- published blocks: `79`

补齐范围：

- source documents processed in this phase: `22`
- materialized documents: `22`
- artifact: `.tmp/materialize-missing-course-maps-responses-gpt55-20260425-run4/materialization-report.json`

## Scope Decision

课程地图只进入公开文档站 reader asset surface。

本 phase 不打开：

- `curriculum_plan` RAG / query-serving 课程地图回答
- canonical document-units 写回
- chunking / embedding / retrieval alias
- source-truth schema expansion

## Implementation Notes

- Responses payload 已改为 Responses-native multimodal content shape：`input_text` / `input_image`。
- system message 在当前 gateway 上保持 plain string，避免旧 array content shape 触发稳定 `502`。
- 非 JSON provider body 即使 HTTP status 为 `200` 也按 retryable provider failure 处理。
- Provider layout `bbox` 可超过 PDF aspect 推断宽度；render 现在用 layout-derived page width 参与 canvas projection，避免右侧课程地图裁剪失真。
- Reader asset materialization purge 只清理 `reader-assets/course-maps.json` 与 `reader-assets/course-maps/`，不再删除整个 `reader-assets/`。

## Verification

- `pnpm --filter public-docs sync:real-docs`
  - pass
  - local generated course-map assets: `46` data modules, `46` public image directories, `79` public PNG images
- `pnpm --filter public-docs lint:generated`
  - pass, `Validated generated public docs for 120 files.`
- `pnpm --filter public-docs test`
  - pass, `34 tests`
- `pnpm --filter public-docs typecheck`
  - pass
- `pnpm --filter public-docs build`
  - pass
- `uv run --all-packages python -m unittest tests.ingestion.test_curriculum_course_map_multimodal_probe tests.ingestion.test_curriculum_course_map_docs_surface tests.ingestion.test_materialize_curriculum_course_map_docs_surface_worker`
  - pass, `26 tests`
- local Playwright smoke on `http://127.0.0.1:5177`
  - `英语本科人才培养方案`: `2` course-map shells, `98` route cards, `2` images, no console warnings/errors
  - `工商管理类本科人才培养方案`: `5` course-map shells, `164` route cards, `5` images, no console warnings/errors

## Follow-up Boundary

展示质量继续由 deferred `curriculum-course-map-docs-presentation-refinement` 承接。
本 workstream 只有在课程地图被重新 admission 为 RAG/query-serving、source-truth canonical 或新的 multimodal extraction contract 时才恢复。
