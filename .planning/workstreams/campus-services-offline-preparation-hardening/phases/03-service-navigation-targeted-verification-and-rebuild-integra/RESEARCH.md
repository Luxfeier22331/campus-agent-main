---
phase: "03"
artifact: "research"
created: 2026-04-20
updated: 2026-04-20
status: completed
---

# Phase 03 Research

## Purpose

确认 `Phase 03` 的重点应当放在：

- bounded verification
- rebuild integration closeout
- planning truth 收口

而不是再次扩写 hybrid extraction 能力。

## Official References Consulted

- OpenAI Images and Vision guide:
  - https://platform.openai.com/docs/guides/images-vision
- OpenAI Structured Outputs guide:
  - https://platform.openai.com/docs/guides/structured-outputs
- PyMuPDF image rendering recipes:
  - https://pymupdf.readthedocs.io/en/latest/recipes-images.html

## Repo Pattern Readings

- `.planning/workstreams/campus-services-offline-preparation-hardening/STATE.md`
- `.planning/workstreams/campus-services-offline-preparation-hardening/ROADMAP.md`
- `.planning/workstreams/campus-services-offline-preparation-hardening/phases/02-bounded-handbook-service-navigation-ocr-materialization/SUMMARY.md`
- `configs/ingestion/regulations/student_rules/source-projections.v1.json`
- `packages/ingestion-core/src/campus_ingestion_core/handbook_service_navigation_hybrid_materialization.py`
- `packages/ingestion-core/src/campus_ingestion_core/handbook_source_projections.py`
- `packages/ingestion-core/src/campus_ingestion_core/raw_ingestion.py`
- `packages/ingestion-core/src/campus_ingestion_core/local_rebuild.py`
- `tests/ingestion/test_handbook_service_navigation_hybrid_materialization.py`
- `tests/ingestion/test_provider_result_replay_rebuild.py`
- `tests/ingestion/test_rebuild_local_data.py`

## Official Findings

### Structured Outputs Still Need Explicit Failure Semantics

- OpenAI 官方文档确认 strict JSON schema 可以收紧输出结构。
- 但这只保证“形状受约束”，不自动保证“语义上足够可消费”。

结论：

- `Phase 03` 不应把“通过 schema”当作 closeout 证据。
- 仍需保留并验证 repo 内的 fail-close 条件：
  - title-only / empty graph 失败
  - page mapping 不一致失败
  - 悬空 `next_step_ids` 失败

这是基于官方 structured outputs 文档做出的实现推断。

### Multiple Image Inputs Keep The Bounded Page Contract Stable

- OpenAI 官方 images/vision guide 继续支持单请求多图输入。

结论：

- `252-255` 页作为固定 page set 的 contract 仍成立。
- `Phase 03` 的重点不是重新讨论模型输入可行性，而是验证 selector 没有静默扩大。

### PyMuPDF Rendering Remains A Page-local Primitive, Not A New Parser Plane

- PyMuPDF 官方文档把 `get_pixmap()` 定位为 page rendering 原语。

结论：

- 当前 lane 仍然是“declared-page rasterization + bounded multimodal extraction”。
- `Phase 03` 的验证应围绕：
  - 是否只渲染声明页
  - raw / replay 是否共用同一 declared-page contract

## Repo Fit Findings

### The Main Remaining Risk Is Scope Drift, Not Missing Core Capability

- `Phase 02` 已把核心能力落在 projection-local helper 中。
- 当前 targeted tests 已证明：
  - hybrid helper 本身可物化 `flow-graph.json`
  - replay 缺失真实 raw asset 会 fail-close
  - rebuild_local_data 的清理路径没有回退

结论：

- `Phase 03` 的首要任务是把这些点提升为正式 verification matrix，
  而不是再新增新的 extraction path。

### Rebuild Integration Needs Explicit Non-Expansion Evidence

- replay 路径现在会在 handbook projections 内 selectively 要求真实 raw asset；
  这个要求必须只命中 bounded hybrid projection。

结论：

- `Phase 03` 需要显式验证：
  - 非目标 projection 不会被误绑到 raw-PDF hard dependency
  - rebuild / replay 不会把 handbook 其他 projection 一起带入 hybrid lane

### Planning Truth Is Behind Code Truth

- repo 代码和 targeted tests 已前进到 `Phase 02` 完成态，
  但当前 workstream `STATE.md` / `ROADMAP.md` 仍停在 `Phase 2 planned`。

结论：

- `Phase 03` 同时承担 planning catch-up 作用：
  - 把 `Phase 02` summary 落盘
  - 把 next resume point 切到 `Phase 03`
  - 为 `Phase 04` 留下干净的 planning closeout 输入

## Conclusions For Phase 03

1. 当前无需继续扩展 hybrid extraction 能力；官方资料没有要求新的 runtime/platform 调整。
2. 本 phase 的正确范围是：
   - selector non-expansion verification
   - raw/replay convergence verification
   - rebuild integration closeout
   - planning truth catch-up
3. 只要这些点被正式收口，后续 `Phase 04` 就可以专注于 closeout 和 follow-up routing。
