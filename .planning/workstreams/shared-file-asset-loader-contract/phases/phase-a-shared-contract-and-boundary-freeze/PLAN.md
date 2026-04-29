---
doc_type: phase_plan
phase: "A"
phase_name: "Shared Contract And Boundary Freeze"
status: completed
created: 2026-04-19
updated: 2026-04-19
---

# Phase A Plan

## Objective

把“彻底统一 loader”收口为 repo 可执行的 shared file asset contract，而不是停留在“换一个通用 parser”的口号层。

## Why This Phase Exists

当前 repo 真正的问题不是缺某个单点 parser，而是 file asset handling contract 没有 shared owner，而且 planning truth 还残留旧的 backend 假设：

- `authenticated_notice_source_projections.py` 把 attachment classification、native extraction、terminal outcome 和 source-specific projection 混在一起
- `.doc` normalizer 只在 worker app 壳中存在，不是 package-level capability
- `official_web` page-level source-truth 与 file asset extraction 属于不同抽象层，但当前“统一 loader”这个提法容易把两层混掉
- workstream state 里仍残留 `Docling spike` 一类已被当前架构判断否定的默认方向

因此第一阶段必须先同步架构真相、冻结边界，再把剩余未知项交给下一阶段 research。

## External References

- MinerU docs:
  - https://mineru.net/doc/docs/index_en/
- PaddleOCR-VL:
  - https://www.paddleocr.ai/v3.3.1/en/version3.x/algorithm/PaddleOCR-VL/PaddleOCR-VL.html
- Collabora document conversion:
  - https://www.collaboraonline.com/document-conversion/
- JODConverter:
  - https://jodconverter.github.io/jodconverter/latest/
- OpenDataLoader docs:
  - https://opendataloader.org/docs

## Decisions To Freeze

1. shared loader 统一的是 `file-like asset` contract，不是 source-specific source unit。
2. canonical owner 固定为 `packages/ingestion-core`；`apps/*` 只保留 worker/runtime shell。
3. shared contract 至少要显式覆盖：
   - `AssetDescriptor`
   - `NormalizationOutcome`
   - `ExtractionOutcome`
   - `TerminalOutcome`
   - `ArtifactProvenance`
4. legacy binary Office（`.doc/.xls`）只允许通过 explicit normalizer 或显式 terminal contract 接入，不在 `ingestion-core` 内手写二进制 parser。
5. modern OOXML（`.docx/.xlsx`）在同一 tranche 内处理，不按 word / spreadsheet 再拆成独立 reopen lane。
6. 现有 source-specific `.xlsx` 提取路径不构成 forward contract；forward choice 由 modern OOXML tranche benchmark 决定。
7. 复杂 PDF 主 lane 倾向 `MinerU`；普通图片 / 简单 OCR 主 lane 倾向 `Paddle`；多模态只作为 `semantic image` enrichment。
8. legacy binary Office 默认 production posture 是 self-hosted LibreOffice-family conversion service；第一实现优先 `JODConverter + LibreOffice`，后续可演进到 `Collabora Online REST`。
9. OCR、manual review、reference-only、unsupported-binary 继续是 repo-owned semantics，不交给第三方 parser 黑盒决定。
10. `official_web` page-level projection、`authenticated_notice` notice-level source-truth、以及 downstream promotion/materialization 继续留在各自 source-specific boundary。
11. `Docling`、`OpenDataLoader`、`Apache OpenOffice` 当前都不进入 repo 默认主干。

## Execution Slices

### Slice 1: Sync Planning Truth To Architecture Truth

- 把 `STATE.md`、`CONTEXT.md`、`PLAN.md` 与新的 supporting architecture 对齐
- 去掉已过时的默认方向：
  - `Docling spike`
  - “单一 parser 统一全部 PDF/image”
  - “外部 conversion SaaS 可作为 legacy Office 默认姿态”
- 补上 Phase A 的 `SPEC.md`

### Slice 2: Freeze Canonical Vocabulary

- 定义 shared loader 的 canonical nouns：
  - `asset_family`
  - `normalized_family`
  - `extraction_family`
  - `terminal_outcome`
  - `provenance_ref`
- 明确哪些字段属于 shared contract，哪些仍属于 source-specific projection

### Slice 3: Freeze Asset Family Matrix

- 给出 repo 当前 first-class file families：
  - legacy binary Office（`.doc` / `.xls`）
  - modern OOXML document family（`.docx` / `.xlsx`）
  - PDF
  - image
  - text-like file
  - HTML file asset
- 明确每类默认去向：
  - deterministic native extraction
  - explicit normalization then extraction
  - document parsing / OCR lane
  - semantic-image multimodal enrichment
  - fail-close

### Slice 4: Freeze Backend And Deployment Rules

- 先冻结 backend 选择原则，而不是先绑定具体库：
  - legacy binary Office 优先 self-hosted LibreOffice-family conversion service，再进入 OOXML deterministic extraction
  - modern admitted structured formats 优先保持结构保真
  - 复杂 PDF 优先 `MinerU`
  - 普通图片 / 简单 OCR 优先 `Paddle`
  - semantic image 只补 multimodal enrichment
  - `.xls` 与 `.doc` 同 phase benchmark / decision，不单独后移
  - `.xlsx` 与 `.docx` 同 phase benchmark / decision，不单独后移
  - source-specific page builder 不纳入 shared backend
  - `Docling` / `OpenDataLoader` 不作为默认 trunk backend

### Slice 5: Freeze Migration Boundary

- 首个迁移目标固定为 `authenticated_notice` attachment path
- `official_web` 当前只评估 file-like subpaths，不改 page-level source-truth
- 迁移顺序固定为：
  - shared substrate 先落
  - source-specific code path 后迁

### Slice 6: Freeze Sample And Verification Matrix

- 样本矩阵至少覆盖：
  - `.doc`
  - `.xls`
  - `.docx`
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

## Proposed Write Set For Phase A

- `.planning/workstreams/shared-file-asset-loader-contract/STATE.md`
- `.planning/workstreams/shared-file-asset-loader-contract/phases/phase-a-shared-contract-and-boundary-freeze/SPEC.md`
- `.planning/workstreams/shared-file-asset-loader-contract/phases/phase-a-shared-contract-and-boundary-freeze/CONTEXT.md`
- `.planning/workstreams/shared-file-asset-loader-contract/phases/phase-a-shared-contract-and-boundary-freeze/PLAN.md`

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
- 已明确 admitted family tranches 与 legacy binary Office / modern OOXML / PDF / image families 的 canonical 路径
- 已明确 remote API / self-hosted / multimodal enrichment 只是 shared contract 下的具体 posture，不再属于开放 gray area
- 下一阶段可以直接进入 bounded backend evaluation，而不是继续反复讨论 scope
