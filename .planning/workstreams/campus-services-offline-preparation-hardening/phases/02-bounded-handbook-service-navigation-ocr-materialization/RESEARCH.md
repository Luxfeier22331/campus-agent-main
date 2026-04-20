---
phase: "02"
artifact: "research"
created: 2026-04-20
updated: 2026-04-20
status: completed
---

# Phase 02 Research

## Purpose

把 `Bounded Handbook Service Navigation Hybrid Materialization`
建立在两类事实之上：

- 官方当前支持的 image/vision、structured outputs 与 page rendering 能力边界
- repo 当前 raw/replay 汇合点与真实缺口

## Official References Consulted

- OpenAI Images and Vision guide:
  - https://platform.openai.com/docs/guides/images-vision
- OpenAI Structured Outputs guide:
  - https://platform.openai.com/docs/guides/structured-outputs
- OpenAI PDF files guide:
  - https://platform.openai.com/docs/guides/pdf-files
- OpenAI model page for `gpt-5.4`:
  - https://platform.openai.com/docs/models/gpt-5.4
- PyMuPDF image rendering recipes:
  - https://pymupdf.readthedocs.io/en/latest/recipes-images.html
- PyMuPDF page API:
  - https://pymupdf.readthedocs.io/en/latest/page.html

## Repo Pattern Readings

- `.planning/workstreams/campus-services-offline-preparation-hardening/REQUIREMENTS.md`
- `.planning/workstreams/campus-services-offline-preparation-hardening/phases/01.1-bounded-service-navigation-multimodal-probe-and-admission/SUMMARY.md`
- `docs/architecture/file-asset-loader-architecture.md`
- `docs/reference/student-handbook-normalization-strategy.md`
- `configs/ingestion/regulations/student_handbook/source-projections.v1.json`
- `packages/ingestion-core/src/campus_ingestion_core/handbook_source_projections.py`
- `packages/ingestion-core/src/campus_ingestion_core/raw_ingestion.py`
- `packages/ingestion-core/src/campus_ingestion_core/local_rebuild.py`
- `packages/shared/src/campus_shared/prompt_runtime.py`
- `packages/ingestion-core/pyproject.toml`
- `tests/ingestion/test_rebuild_local_data.py`
- `tests/ingestion/test_provider_result_replay_rebuild.py`
- `tests/ingestion/test_processing_pipeline.py`

## Official Capability Findings

### OpenAI Image Inputs Fit The Bounded Slice

- OpenAI 官方文档确认同一请求可以携带多张图片输入，这正适合 `252-255` 页的 bounded page set。
- 官方文档同时提供图片细节等级控制；这条线属于中文小字、流程框密集布局，默认应按高细节页面读取来设计。
- `gpt-5.4` 的官方模型页与 repo 当前 `.env` 一致：
  - `PROMPT_RUNTIME_PROVIDER=openai-responses`
  - `PROMPT_RUNTIME_MODEL=gpt-5.4`

结论：

- 这条线不需要为 Phase 2 另造模型/runtime 选型；
  repo 当前 prompt runtime 默认模型足以支撑 bounded hybrid extraction。

### Structured Outputs Matches The Needed Guardrails

- OpenAI 官方 Structured Outputs 文档确认 strict JSON schema 可以约束输出形状。
- 文档强调 object schema 应关闭开放属性，并把字段语义保持清晰、收敛。

结论：

- `flow heading -> steps -> next_step_ids` 这类有限 graph schema
  符合官方推荐的受限 structured output 用法。
- 这也意味着当前 phase 不应把 collector 做成自由问答式视觉查询器。

### PDF Input Is Not The Right Execution Contract Here

- OpenAI 官方 PDF guide 明确说明 PDF 输入会同时带来 extracted text 和 page images。

结论：

- 这对 Phase 01.1 的 admission 是混淆因素，所以 admission 已正确采用 per-page PNG。
- 对 Phase 2 生产物化，同样更适合显式控制：
  - 从真实 raw PDF 渲染 declared pages
  - 仅把这些 page PNG 交给 multimodal lane
- 这样才能维持“只恢复 flowchart body / edges”的 bounded contract，
  而不是隐式重新引入另一条 PDF text extraction lane。

### PyMuPDF Is The Relevant Page Rendering Dependency

- PyMuPDF 官方文档直接提供 `Page.get_pixmap()` 与 page/image rendering recipes，
  适合把指定 PDF 页渲染成 PNG。

结论：

- Phase 2 的关键输入是“受限页范围 rasterization”，不是 PDF subset merge/split。
- 因此 PyMuPDF 比 `pypdf` 更贴近这个 phase 的直接需求。
- 这是一个官方文档支持下的实现推断，不是 repo 现成 truth。

## Repo Fit Findings

### Owner Seam Should Stay In `ingestion-core`

- `build_handbook_projection_import_documents(...)` 已是 raw ingestion 与 replay rebuild 的汇合点。
- 这意味着 Phase 2 的 hybrid logic 应作为 projection-local helper 挂在 `ingestion-core`，
  而不是散落到 app shell 或 prompt runtime 层。

结论：

- 正确 owner seam 是：
  - `packages/ingestion-core`
  - 以 handbook-derived projection materialization 为中心

### Replay Path Has A Real Raw-Asset Gap

- `local_rebuild.py` 当前为 replay 构造的 synthetic `RawAssetRecord`
  把 `object_key` 设成了 `provider_response_key`。
- 对 replay canonical cleanup 来说这还能工作，
  但对 “从真实 raw PDF 渲染 page PNG” 的 hybrid lane 来说不成立。

结论：

- Phase 2 不能只在 raw ingestion 路径实现 hybrid extraction。
- replay rebuild 必须补上真实 raw object key resolution，
  否则 raw/replay 两条路径会产生不同的 materialization truth。

### Existing Prompt Runtime Already Covers The Schema Plumbing

- `packages/shared/src/campus_shared/prompt_runtime.py`
  已有 Responses API structured-output executor。

结论：

- Phase 2 不需要 repo-wide prompt-runtime 重构。
- 新增的应是 projection-local schema、message builder 和 result normalization helper。

### Dependency Gap Is Real But Bounded

- `packages/ingestion-core/pyproject.toml` 当前已有 `pillow`，
  但没有 `pymupdf` 或 `pypdf`。

结论：

- 如果 Phase 2 走 page rasterization，新增依赖的正确候选是 `pymupdf`。
- 这属于 bounded implementation dependency，不应被扩写成 repo-wide parser platform work。

## Decisions Carried Into Planning

1. Phase 2 继续保持 projection-local bounded lane，不扩成 repo-wide multimodal parser。
2. raw ingestion 与 provider-response replay 必须共用同一套 hybrid materialization helper。
3. hybrid lane 的视觉输入必须来自真实 raw PDF 的 declared pages rasterization。
4. OCR `provider-response.jsonl` 与 `layout-elements.jsonl` 继续是 provenance base，不被多模态替代。
5. 需要新增一个 target-local multimodal structured artifact，作为 `canonical.md` / `document-units.jsonl` 的直接上游。
   - 计划中冻结为 `flow-graph.json`
6. title-only 或无有效 step graph 的结果必须 fail-close，
   不能静默回退成“只保留标题的成功文档”。

## Conclusions For Phase 02

1. 官方能力与 repo 当前 runtime 兼容，Phase 2 的问题不是模型不可用，而是 owner seam 和 raw-asset resolution 未收口。
2. 正确实现方向是：
   - 精确 projection dispatch
   - raw PDF declared-page rendering
   - strict-schema multimodal graph extraction
   - target-local artifact materialization
   - replay/raw 统一
3. 这条线仍然只服务于 handbook-derived `service_navigation_document`，
   不改变 source-truth、query-serving 或 repo-wide parser topology。
