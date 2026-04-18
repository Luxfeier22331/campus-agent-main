---
doc_type: phase_plan
phase: "A"
phase_name: "Shared Contract And Boundary Freeze"
status: planned
created: 2026-04-19
updated: 2026-04-19
---

# Phase A Plan

## Objective

把“彻底统一 loader”收口为 repo 可执行的 shared file asset contract，而不是停留在“换一个通用 parser”的口号层。

## Why This Phase Exists

当前 repo 真正的问题不是缺某个单点 parser，而是 file asset handling contract 没有 shared owner：

- `authenticated_notice_source_projections.py` 把 attachment classification、native extraction、terminal outcome 和 source-specific projection 混在一起
- `.doc` normalizer 只在 worker app 壳中存在，不是 package-level capability
- `official_web` page-level source-truth 与 file asset extraction 属于不同抽象层，但当前“统一 loader”这个提法容易把两层混掉

因此第一阶段必须先冻结边界，再决定 backend。

## External References

- Unstructured partitioning:
  - https://docs.unstructured.io/open-source/core-functionality/partitioning
- Docling supported formats:
  - https://docling-project.github.io/docling/usage/supported_formats/
- Apache Tika supported formats:
  - https://tika.apache.org/3.2.1/formats.html
- LibreOffice CLI conversion:
  - https://help.libreoffice.org/latest/zh-CN/text/shared/guide/start_parameters.html
- openpyxl optimized mode:
  - https://openpyxl.readthedocs.io/en/3.1/optimized.html
- xlrd changes:
  - https://xlrd.readthedocs.io/en/latest/changes.html

## Decisions To Freeze

1. shared loader 统一的是 `file-like asset` contract，不是 source-specific source unit。
2. canonical owner 固定为 `packages/ingestion-core`；`apps/*` 只保留 worker/runtime shell。
3. shared contract 至少要显式覆盖：
   - `AssetDescriptor`
   - `NormalizationOutcome`
   - `ExtractionOutcome`
   - `TerminalOutcome`
   - `ArtifactProvenance`
4. legacy Office 只允许通过 explicit normalizer 接入，不在 `ingestion-core` 内手写二进制 parser。
5. OCR、manual review、reference-only、unsupported-binary 继续是 repo-owned semantics，不交给第三方 parser 黑盒决定。
6. `official_web` page-level projection、`authenticated_notice` notice-level source-truth、以及 downstream promotion/materialization 继续留在各自 source-specific boundary。

## Execution Slices

### Slice 1: Freeze Canonical Vocabulary

- 定义 shared loader 的 canonical nouns：
  - `asset_family`
  - `normalized_family`
  - `extraction_family`
  - `terminal_outcome`
  - `provenance_ref`
- 明确哪些字段属于 shared contract，哪些仍属于 source-specific projection

### Slice 2: Freeze Asset Family Matrix

- 给出 repo 当前 first-class file families：
  - legacy Office binary
  - OOXML Office
  - PDF
  - image
  - text-like file
  - HTML file asset
- 明确每类默认去向：
  - native extraction
  - explicit normalization then extraction
  - OCR/manual-review lane
  - fail-close

### Slice 3: Freeze Backend Selection Rules

- 先冻结 backend 选择原则，而不是先绑定具体库：
  - legacy Office normalizer 优先显式转换
  - modern structured formats 优先保持结构保真
  - OCR families 优先保留当前 lane semantics
  - source-specific page builder 不纳入 shared backend

### Slice 4: Freeze Migration Boundary

- 首个迁移目标固定为 `authenticated_notice` attachment path
- `official_web` 当前只评估 file-like subpaths，不改 page-level source-truth
- 迁移顺序固定为：
  - shared substrate 先落
  - source-specific code path 后迁

### Slice 5: Freeze Sample And Verification Matrix

- 样本矩阵至少覆盖：
  - `.doc`
  - `.docx`
  - `.xls`
  - `.xlsx`
  - text PDF
  - scanned PDF
  - image
- 验证项至少覆盖：
  - structure retention
  - table fidelity
  - provenance completeness
  - terminal outcome correctness
  - object-store artifact refs

## Proposed Write Set For Later Phases

- `packages/ingestion-core/src/campus_ingestion_core/raw_asset_typing.py`
- `packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_source_projections.py`
- new shared loader modules under `packages/ingestion-core/src/campus_ingestion_core/`
- worker thin wrappers under `apps/ingestion-worker/src/campus_ingestion_worker/`
- targeted tests under `tests/ingestion/`
- related docs / runbooks as needed

## Exit Rule

Phase A 完成后，repo 应达到：

- “统一 loader” 的目标和边界不再含糊
- 已明确 shared loader 统一什么、不统一什么
- 已明确 legacy / modern / OCR families 的 canonical 路径
- 下一阶段可以直接进入 bounded backend evaluation，而不是继续反复讨论 scope
