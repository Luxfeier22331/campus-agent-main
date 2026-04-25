---
doc_type: roadmap
status: completed
created: 2026-04-22
updated: 2026-04-25
---

# Roadmap: Curriculum Course Map Multimodal Probe

## Overview

这条 workstream 负责把 `curriculum_plan` 课程地图页从 bounded multimodal probe 收口到 docs-only
reader asset materialization。

当前完成态：

- 课程地图进入公开文档站的 reader asset 消费面。
- `curriculum_plan` 的 RAG / query-serving 课程地图问题继续 fail-close。
- 课程地图展示体验继续由 `curriculum-course-map-docs-presentation-refinement` deferred workstream 承接。

## Phases

- [x] **Phase 1: Probe Contract And Evidence Set Freeze** — 冻结 source artifact key、sample-set、gold-set、schema 和 admission rubric。
- [x] **Phase 2: Probe Executor And Verification Scaffold** — 在 `packages/ingestion-core` 落地 inventory、render/crop、Responses API schema、repeatability/gold scorer、artifact output 与 `apps/ingestion-worker` CLI，并补 targeted unittest。
- [x] **Phase 3: Live Probe Execution And Admission Decision** — 已完成 `/responses` transport 失败诊断、`chat_completions + gpt-5.4` 单样本 smoke、fixed sample-set `1-run + 3-run` live rerun，并收口新的 admission artifact：`repeatability_pass_rate=0.9167`、`gold_pass_rate=1.0`、`recommendation=bounded_candidate_for_follow_up`。局部已知波动点为 `page 349` 的 map title 不稳定，但不阻断本次 bounded admission。
- [x] **Phase 4: Docs-only Materialization Routing** — 明确课程地图只进入 docs reader asset surface，不进入 source-truth canonical、chunking、embedding 或 RAG/query-serving；缺失补全只写 `reader-assets/course-maps.json` 与配套图片。
- [x] **Phase 5: Responses GPT-5.5 Missing Coverage Backfill** — 修复 Responses multimodal payload、provider canvas width 与 reader-assets purge scope，使用 `Responses + gpt-5.5` 补齐缺失 22 个培养方案；最终对象覆盖为 46/46 个培养方案、79/79 个课程地图块，并同步到 `apps/public-docs` 本地 reader assets。
