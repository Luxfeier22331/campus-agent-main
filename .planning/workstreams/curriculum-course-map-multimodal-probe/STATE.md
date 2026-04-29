---
workstream: curriculum-course-map-multimodal-probe
created: 2026-04-22
updated: 2026-04-25
---

# Project State

## Current Position
**Status:** Completed
**Current Phase:** Complete
**Current Phase Name:** Closed Out After Phase 5
**Current Plan:** `<none>`
**Total Phases:** 5
**Total Plans in Phase:** 0
**Progress:** 5/5 phases complete
**Last Activity:** 2026-04-25
**Last Activity Description:** 已完成 `Responses + gpt-5.5` 缺失课程地图补全；缺失 22 个培养方案全部 materialize，最终 docs reader asset 覆盖为 46/46 个培养方案、79/79 个课程地图块，`curriculum_plan` RAG/query 课程地图问题继续 fail-close。

## Current Slice

- 已完成：
  - `packages/ingestion-core/src/campus_ingestion_core/curriculum_course_map_multimodal_probe.py`
  - `apps/ingestion-worker/src/campus_ingestion_worker/probe_curriculum_course_maps.py`
  - `configs/ingestion/curriculum/curriculum_plan/course-map-probe-samples.v1.json`
  - `configs/ingestion/curriculum/curriculum_plan/course-map-probe-gold.v1.json`
  - `tests/ingestion/test_curriculum_course_map_multimodal_probe.py`
  - `tests/ingestion/test_probe_curriculum_course_maps_worker.py`
  - `.planning/workstreams/curriculum-course-map-multimodal-probe/PHASE-3-LIVE-PROBE-SUMMARY.md`
  - `.planning/workstreams/curriculum-course-map-multimodal-probe/PHASE-5-RESPONSES-GPT55-MATERIALIZATION-SUMMARY.md`
  - `packages/ingestion-core/src/campus_ingestion_core/curriculum_course_map_docs_surface.py`
  - `tests/ingestion/test_curriculum_course_map_docs_surface.py`
- Phase 4 routing 已完成：
  - 课程地图只进入公开文档站 reader asset surface
  - 不进入 canonical document-units、chunking、embedding、retrieval alias 或 query-serving
  - 文档站展示体验继续由 `curriculum-course-map-docs-presentation-refinement` deferred workstream 承接
- Phase 5 materialization 已完成：
  - 修复 `/responses` multimodal payload：chat-style `text/image_url` 转为 Responses `input_text/input_image`
  - 修复当前 gateway 对 system message plain string 的兼容要求
  - 修复 provider layout 宽度超过 PDF aspect 推断宽度时的裁剪失真
  - 修复 course-map reader asset purge 只删除 `reader-assets/course-maps.json` 与 `reader-assets/course-maps/`，避免误删其他 reader assets
  - 使用 `Responses + gpt-5.5` 对缺失 22 个培养方案完成补齐
- 当前 forward truth：
  - `课程地图` query 继续 fail-close
  - 课程地图 reader asset 写入 `reader-assets/course-maps.json` 与配套 `reader-assets/course-maps/*.png`
  - probe/materialization 不写 source-truth、document-units、chunks、embedding 或 retrieval serving
  - `Responses + gpt-5.5` 在当前 gateway 上已可用于真实课程地图视觉结构抽取
  - `chat_completions + gpt-5.4` fixed sample-set `1-run + 3-run` artifact 继续作为历史 admission evidence
  - 当前 admission 结论已经收口为 docs-only materialization accepted
  - `page 349` 仍存在局部 title instability：`run1=法学（民族实验班）课程地图`，`run2/run3=课程地图`；该波动已被写入 follow-up scope，而不是阻止本次 bounded admission
  - 产品 query truth 继续 fail-close

## Blockers

- 当前没有执行器、runtime 或 coverage blocker
- 剩余展示质量工作不在本 workstream 内；由 deferred `curriculum-course-map-docs-presentation-refinement` 恢复后处理

## Verification

- `uv run --all-packages python -m unittest tests.ingestion.test_curriculum_course_map_multimodal_probe tests.ingestion.test_probe_curriculum_course_maps_worker`
  - `pass`
- `uv run --all-packages python -m unittest tests.ingestion.test_curriculum_course_map_multimodal_probe`
  - `pass`
- `.tmp/evals/course-map-probe-smoke/run-one-chat-completions/probe-report.json`
  - `gpt-5.4 + chat_completions` 单样本 live smoke 已通过，`gold_pass_rate=1.0`
- `.tmp/evals/course-map-probe-smoke/run-one-chat-completions-executor-hardened/probe-report.json`
  - 执行器硬化后的单样本 live smoke 继续通过，`gold_pass_rate=1.0`
- `.tmp/evals/course-map-probe-live/run-full-fixed-set-chat-completions-1/probe-report.json`
  - fixed sample-set `1-run` live rerun 已通过，`gold_pass_rate=1.0`
- `.tmp/evals/course-map-probe-live/run-full-fixed-set-chat-completions-3/probe-report.json`
  - fixed sample-set `3-run` live rerun 已通过，`repeatability_pass_rate=0.9167`、`gold_pass_rate=1.0`、`recommendation=bounded_candidate_for_follow_up`
- `.tmp/evals/course-map-probe-live/run-full-fixed-set-chat-completions-3/page-metrics.jsonl`
  - 记录到一次 `ReadTimeout`、一次 `ReadError`、一次 `520`；均通过重试或 `--resume` 收口
- `.tmp/evals/curriculum-course-map-runtime-diagnostics-20260421T205558Z/report.json`
  - 保留为旧 `/responses` payload shape 失败证据；该结论已被 2026-04-25 payload 修复替代
- `.tmp/materialize-missing-course-maps-responses-gpt55-20260425-run4/materialization-report.json`
  - `source_document_count=22`
  - `materialized_document_count=22`
  - 最终覆盖核对：`inventory_docs=46`、`published_docs=46`、`missing_docs=0`、`published_blocks=79`
- `pnpm --filter public-docs sync:real-docs`
  - pass
  - local generated course-map assets: `46` data modules、`46` public image directories、`79` public PNG images
- `pnpm --filter public-docs lint:generated`
  - pass，`Validated generated public docs for 120 files.`
- `pnpm --filter public-docs test`
  - pass，`34 tests`
- `pnpm --filter public-docs typecheck`
  - pass
- `pnpm --filter public-docs build`
  - pass
- `uv run --all-packages python -m unittest tests.ingestion.test_curriculum_course_map_multimodal_probe tests.ingestion.test_curriculum_course_map_docs_surface tests.ingestion.test_materialize_curriculum_course_map_docs_surface_worker`
  - pass，`26 tests`
- Playwright local smoke on `http://127.0.0.1:5177`
  - `英语本科人才培养方案`：2 个 course-map shell、98 个 route card、2 张课程地图图片，无 console warnings/errors
  - `工商管理类本科人才培养方案`：5 个 course-map shell、164 个 route card、5 张课程地图图片，无 console warnings/errors

## Session Continuity

**Stopped At:** 本 workstream 已完成；如果后续继续打磨课程地图展示，请恢复 `curriculum-course-map-docs-presentation-refinement`，不要重新打开本 probe/materialization workstream。
**Resume File:** `apps/public-docs/src/components/CourseMapSection.tsx`
