---
doc_type: roadmap
status: active
created: 2026-04-22
updated: 2026-04-22
---

# Roadmap: Curriculum Course Map Multimodal Probe

## Overview

这条 workstream 只评估 `curriculum_plan` 课程地图页是否值得在后续被 admission 为 bounded multimodal lane。
当前阶段先把 probe 执行框架、固定样本、固定 gold 和 admission rubric 落地；产品 runtime 仍保持 fail-close。

## Phases

- [x] **Phase 1: Probe Contract And Evidence Set Freeze** — 冻结 source artifact key、sample-set、gold-set、schema 和 admission rubric。
- [x] **Phase 2: Probe Executor And Verification Scaffold** — 在 `packages/ingestion-core` 落地 inventory、render/crop、Responses API schema、repeatability/gold scorer、artifact output 与 `apps/ingestion-worker` CLI，并补 targeted unittest。
- [x] **Phase 3: Live Probe Execution And Admission Decision** — 已完成 `/responses` transport 失败诊断、`chat_completions + gpt-5.4` 单样本 smoke、fixed sample-set `1-run + 3-run` live rerun，并收口新的 admission artifact：`repeatability_pass_rate=0.9167`、`gold_pass_rate=1.0`、`recommendation=bounded_candidate_for_follow_up`。局部已知波动点为 `page 349` 的 map title 不稳定，但不阻断本次 bounded admission。
- [ ] **Phase 4: Follow-up Routing After Admission Decision** — 基于新的 bounded admission 结论，决定是否进入 bounded source-truth/materialization/query-opening follow-up，并明确 `page 349` title instability 的后续处置方式。
