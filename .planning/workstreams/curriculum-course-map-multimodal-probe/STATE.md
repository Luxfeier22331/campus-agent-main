---
workstream: curriculum-course-map-multimodal-probe
created: 2026-04-22
updated: 2026-04-22
---

# Project State

## Current Position
**Status:** Active
**Current Phase:** Phase 4
**Current Phase Name:** Follow-up Routing After Admission Decision
**Current Plan:** `<none>`
**Total Phases:** 4
**Total Plans in Phase:** 0
**Progress:** 3/4 phases complete
**Last Activity:** 2026-04-22
**Last Activity Description:** 已完成 `chat_completions + gpt-5.4` fixed sample-set live rerun；`3-run` artifact 收口为 `repeatability_pass_rate=0.9167`、`gold_pass_rate=1.0`、`recommendation=bounded_candidate_for_follow_up`，但产品 truth 仍保持 fail-close，等待 follow-up routing 明确。

## Current Slice

- 已完成：
  - `packages/ingestion-core/src/campus_ingestion_core/curriculum_course_map_multimodal_probe.py`
  - `apps/ingestion-worker/src/campus_ingestion_worker/probe_curriculum_course_maps.py`
  - `configs/ingestion/curriculum/curriculum_plan/course-map-probe-samples.v1.json`
  - `configs/ingestion/curriculum/curriculum_plan/course-map-probe-gold.v1.json`
  - `tests/ingestion/test_curriculum_course_map_multimodal_probe.py`
  - `tests/ingestion/test_probe_curriculum_course_maps_worker.py`
  - `.planning/workstreams/curriculum-course-map-multimodal-probe/PHASE-3-LIVE-PROBE-SUMMARY.md`
- 当前 forward truth：
  - `课程地图` query 继续 fail-close
  - probe 只输出离线 artifact，不写 source-truth、document-units、chunks 或 retrieval serving
  - `responses` transport 在当前 gateway 上仍不适合真实课程地图视觉结构抽取
  - `chat_completions` transport 已完成 fixed sample-set `1-run + 3-run` live rerun，并在真实 bucket / 真实 gateway 上产出新的 repeatability / gold / admission artifact
  - 当前 admission 结论已经升级为 `bounded_candidate_for_follow_up`
  - `page 349` 仍存在局部 title instability：`run1=法学（民族实验班）课程地图`，`run2/run3=课程地图`；该波动已被写入 follow-up scope，而不是阻止本次 bounded admission
  - 在 follow-up routing 明确之前，产品 truth 继续 fail-close

## Blockers

- 当前没有执行器或 runtime blocker
- 当前待完成事项：
  - 把 `bounded_candidate_for_follow_up` 收口为明确的 Phase 4 follow-up routing，决定是否进入 bounded source-truth / materialization / query-opening 设计
  - 明确 `page 349` title instability 是否需要在 follow-up 中追加 prompt/schema 约束或局部后处理规范

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
  - 仍保留为 `/responses` transport 失败证据

## Session Continuity

**Stopped At:** 已完成 fixed sample-set live rerun 并拿到新的 bounded admission 结论；下一次应直接进入 Phase 4 follow-up routing，而不是重复 transport 诊断
**Resume File:** `packages/ingestion-core/src/campus_ingestion_core/curriculum_course_map_multimodal_probe.py`
