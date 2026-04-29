---
phase: "C"
name: "Shared Normalization And Extraction Substrate"
created: 2026-04-19
updated: 2026-04-19
status: ready
---

# Phase C Context

**Gathered:** 2026-04-19
**Status:** Ready for planning

<domain>
## Phase Boundary

在 `packages/ingestion-core` 落 shared file asset substrate，把 Phase B 已冻结的 family decisions 变成 package-owned implementation seams。

本 phase 只负责 substrate，不负责 source migration。`authenticated_notice` 仍是首个 consumer，但真正迁线在 Phase D。

</domain>

<decisions>
## Implementation Decisions

### Shared contract shape
- **D-01:** shared substrate 的 canonical owner 固定为 `packages/ingestion-core`，不把 parser truth 留在 `apps/ingestion-worker` 或 source-specific module。
- **D-02:** contract nouns 以 Phase A/B 已冻结 vocabulary 为准：asset descriptor、normalization outcome、extraction outcome、terminal outcome、artifact provenance。
- **D-03:** Phase C 优先做 admitted families 的 concrete substrate，不做“支持任意文件格式”的泛化抽象。

### Legacy Office adapter
- **D-04:** `.doc/.xls` 统一走 conversion-first seam；worker 里的 `normalize_authenticated_notice_legacy_office_attachment.py` 只保留为 runtime shell/harness。
- **D-05:** package-level substrate 必须显式承接 conversion request / normalized artifact refs / provenance，不以 local path 作为长期 truth。
- **D-06:** 允许 Phase C 先以 `JODConverter + LibreOffice` contract 为目标 shape 落 adapter seam；`Collabora Online REST` 继续保留为 future hardening replacement，不在本 phase reopen。

### Modern OOXML adapter
- **D-07:** `authenticated_notice_source_projections.py` 内现有 `_extract_docx_text_blocks()` 与 `_extract_xlsx_text_blocks()` 是 Phase C 的 extraction seed，但 forward truth 需要迁到 shared module。
- **D-08:** `docx` 保留 paragraph / heading / table oriented deterministic extraction；`xlsx` 保留 workbook / sheet / shared strings / formula-cached-value aware extraction。
- **D-09:** 不引入 `openpyxl`、`xlrd` 或 OCR-first fallback 作为 OOXML shared substrate 默认路径。

### PDF / image routing
- **D-10:** `raw_asset_typing.py` + `online_ocr_routing.py` + `online_ocr_compare.py` 已形成 Phase C 的 routing substrate seed；shared substrate 只需要把它们收口成 reusable family routing module。
- **D-11:** `semantic_image` 在 shared substrate 中继续保持 non-canonical；可以保留 multimodal adapter seam，但不能重新进入 canonical OCR/document parsing path。
- **D-12:** spatial / map-like image 的 fail-close 必须保持 repo-owned terminal semantics，不能为了“多命中一点”回退成 OCR success。

### Migration posture
- **D-13:** Phase C 不改 `authenticated_notice_import.py`、`authenticated_notice_source_projections.py` 的 consumer wiring，只提供后续可接线的 shared API。
- **D-14:** Phase C 的 API 设计必须以 Phase D `authenticated_notice` migration 为首个 consumer，但不要为了 future cross-scope adoption 引入兼容层或双路径。

### the agent's Discretion
- module/file naming 的最终细分
- package-level dataclass/protocol 边界的精确拆分
- focused test file 的组织方式

</decisions>

<specifics>
## Specific Ideas

- 优先把“当前已存在但 owner 错了”的实现搬到正确层，而不是重写全套解析逻辑。
- thin worker shell + package-owned substrate 是这次 phase 的理想切分：worker 保留 CLI/runtime wiring，contract/adapter/provenance 下沉到 `packages/ingestion-core`。
- Phase D consumer 最先要吃到的是：legacy Office normalization seam、OOXML deterministic extraction seam、PDF/image routing seam、统一 terminal outcomes。

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Repo architecture and workstream truth
- `docs/architecture/system/file-asset-loader-architecture.md` — shared file asset loader 的 canonical family matrix、deployment posture 与 fail-close 边界
- `docs/architecture/system/data-plane-architecture.md` — shared file asset loader 在 data-plane chain 中的位置与 source-truth guardrails
- `docs/architecture/domains/authenticated-notice/architecture.md` — `authenticated_notice` attachment boundary 与 Phase D migration owner split
- `docs/plans/archive/completed/shared-file-asset-loader-contract.md` — 这条 workstream 的 phase ordering 与 scope
- `.planning/workstreams/shared-file-asset-loader-contract/REQUIREMENTS.md` — workstream 目标、范围、success criteria
- `.planning/workstreams/shared-file-asset-loader-contract/STATE.md` — 当前已推进到 Phase C 的 planning truth

### Prior phase decisions
- `.planning/workstreams/shared-file-asset-loader-contract/phases/phase-a-shared-contract-and-boundary-freeze/CONTEXT.md` — Phase A 冻结的 owner、guardrails、family tranche 与 provider posture
- `.planning/workstreams/shared-file-asset-loader-contract/phases/phase-b-bounded-backend-evaluation/DECISION-PACKAGE.md` — Phase B benchmark-backed backend decisions
- `.planning/workstreams/shared-file-asset-loader-contract/phases/phase-b-bounded-backend-evaluation/BENCHMARK-EVIDENCE.md` — Phase B synthetic evidence

### Current code truth to refactor around
- `packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_source_projections.py` — 当前混合 attachment classification、OOXML extraction、OCR / terminal outcomes 的 source-specific module
- `packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_import.py` — 当前 source import path，Phase D 将接 shared substrate
- `packages/ingestion-core/src/campus_ingestion_core/raw_asset_typing.py` — shared routing 的 typed metadata seed
- `packages/ingestion-core/src/campus_ingestion_core/online_ocr_routing.py` — Phase B 已冻结的 PDF/image routing seed
- `packages/ingestion-core/src/campus_ingestion_core/online_ocr_compare.py` — dual-run compare / routing evidence seed
- `apps/ingestion-worker/src/campus_ingestion_worker/normalize_authenticated_notice_legacy_office_attachment.py` — 当前 worker-side legacy Office conversion harness

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `authenticated_notice_source_projections.py::_extract_docx_text_blocks` / `_extract_xlsx_text_blocks`: 已有 deterministic OOXML extraction seed，可迁入 shared module
- `normalize_authenticated_notice_legacy_office_attachment.py`: 已有 `.doc/.xls -> .docx/.xlsx` normalization harness 与 provenance summary shape
- `raw_asset_typing.py` + `online_ocr_routing.py`: 已能表达 PDF/image canonical / deferred routing
- `online_ocr_compare.py`: 已有 provider compare artifacts、adjudication payload 与 summary format，可复用到 shared routing diagnostics

### Established Patterns
- object-store artifact refs、registry rows、document-units 继续使用 repo-owned artifacts/registry patterns，不引入 app-local temp semantics
- thin runtime shell + package-level capability 已是 repo 对 shared ingestion capability 的正确 owner split
- `authenticated_notice` 当前测试覆盖较强，适合作为 Phase C 不回归的 consumer-side evidence source

### Integration Points
- Phase C substrate 的首个 integration point 是 `authenticated_notice` attachment path，但真正接线推迟到 Phase D
- shared routing / extraction 产物后续需要喂给 import/source-projection paths，因此 API 不能依赖 raw local path 或 source-specific bundle schema

</code_context>

<deferred>
## Deferred Ideas

- `authenticated_notice` attachment path 的实际接线迁移 —— Phase D
- `official_web` 或其他 source channel adoption —— Phase E
- `Collabora Online REST` replacement、expanded semantic-image benchmark corpus —— future hardening

</deferred>

---

*Phase: phase-c-shared-normalization-and-extraction-substrate*
*Context gathered: 2026-04-19*
