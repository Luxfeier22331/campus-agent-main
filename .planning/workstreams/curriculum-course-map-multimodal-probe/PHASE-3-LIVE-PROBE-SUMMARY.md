---
doc_type: summary
status: completed
created: 2026-04-22
updated: 2026-04-22
---

# Phase 3 Live Probe Summary

## Outcome

`curriculum_plan` 的课程地图多模态 probe 已在当前 prompt runtime 上完成新的 live admission evidence。
本 phase 的最终结论是：

- `课程地图 / 拓扑图` query 继续 `fail-close`
- 当前 recommendation 升级为 `bounded_candidate_for_follow_up`
- 当前 probe 仍只输出离线 artifact，不直接进入 source-truth parser、document-units materialization、chunking 或 query-opening
- 下一步进入 `Phase 4`，决定是否按 bounded 方式开启 follow-up

## Evidence

- real source inventory 已完成真实 bucket 复核：
  - `inventory_count=43`
  - `distinct_pages=40`
  - `distinct_documents=34`
- 执行器硬化后的单样本 smoke artifact：
  - `.tmp/evals/course-map-probe-smoke/run-one-chat-completions-executor-hardened/probe-report.json`
  - `run_count=1`
  - `gold_pass_rate=1.0`
- fixed sample-set `1-run` artifact：
  - `.tmp/evals/course-map-probe-live/run-full-fixed-set-chat-completions-1/probe-report.json`
  - `selected_sample_count=12`
  - `gold_pass_rate=1.0`
- fixed sample-set `3-run` artifact：
  - `.tmp/evals/course-map-probe-live/run-full-fixed-set-chat-completions-3/probe-report.json`
  - `repeatability_pass_rate=0.9167`
  - `repeatability_overall_score=0.9082`
  - `gold_pass_rate=1.0`
  - `recommendation=bounded_candidate_for_follow_up`
- runtime diagnostics artifact（保留为 `/responses` incident record）：
  - `.tmp/evals/curriculum-course-map-runtime-diagnostics-20260421T205558Z/report.json`

## Prompt Runtime Findings

在同一 gateway `https://codex.gbro.site/v1` 上，以下请求行为已经被证实：

- text-only `/responses` 请求返回 `200`
- trivial multimodal `ok` 请求返回 `200`
- multimodal + `json_schema` structured extraction 请求返回稳定 `502`
- multimodal plain-JSON extraction 请求同样返回稳定 `502`
- candidate alt models `gpt-4.1` / `gpt-4o` / `gpt-4o-mini` / `gpt-5.4-mini` 在同类 extraction 请求上同样返回稳定 `502`
- `chat_completions + gpt-5.4` 可对真实课程地图图像完成 bounded extraction，并通过 fixed sample-set `1-run + 3-run` rerun

这说明当前 blocker 不在：

- source bucket 可达性
- PDF render / crop
- split-manifest page ownership
- layout-elements course-map inventory 过滤
- 单纯的 multimodal input 能力

当前 runtime 结论是：

- `/responses` path 仍不适合真实课程地图视觉结构抽取
- `chat_completions` path 可用，但存在真实 gateway 抖动，需要重试与 resume
- 在本次 `3-run` live artifact 中，记录到一次 `ReadTimeout`、一次 `ReadError`、一次 `520`；均通过执行器重试或 `--resume` 收口

## Code-Level Adjustments

- probe inventory 只保留课程地图候选 image rows，并跳过无法映射到 split-manifest document 的无关 image rows
- probe 执行器现已支持 `prompt_transport`、bounded page concurrency、request retry、checkpoint resume 与 page-level metrics/progress artifacts
- `chat_completions` 已成为本 workstream 的真实可用 extraction transport
- Cloudflare `52x` / network read failures 已纳入 retryable path；中断后的 `--resume` 也已在真实 `3-run` artifact 上验证通过

## Residual Variance

- `page 349` 的 map title 在三轮之间存在局部波动：
  - `run1=法学（民族实验班）课程地图`
  - `run2/run3=课程地图`
- 该页的 title_jaccard 仅 `0.3333`，导致其 repeatability overall_score=`0.6969`
- 但该页 stable surface 仍满足当前 gold gate：`title_recall=1.0`、`node_recall=1.0`、`edge_recall=0.5`
- 因此它被归入 `Phase 4` follow-up，而不是回滚本次 bounded admission

## Closeout

`Phase 3` 已完成。
当前允许进入 `Phase 4` 的前提已经满足：

- 已有真实可用的 multimodal extraction transport
- 已产出 fixed sample-set `1-run + 3-run` repeatability / gold / admission artifact
- bounded admission 结论已经明确，但产品 truth 仍保持 fail-close，直到 `Phase 4` 明确 follow-up scope
