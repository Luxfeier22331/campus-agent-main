---
phase: "A"
name: "Shared Contract And Boundary Freeze"
created: 2026-04-19
updated: 2026-04-19
status: completed
---

# Phase A Spec

## Ambiguity Report

- Goal Clarity: `0.90`
- Boundary Clarity: `0.88`
- Constraint Clarity: `0.86`
- Acceptance Criteria: `0.90`
- Ambiguity: `0.11`

Phase A 当前已经足够清晰，可以直接进入 `SPEC -> CONTEXT -> PLAN` 收口，不需要继续开放式追问。

## In Scope

- 冻结 repo 级 shared file asset loader 的 canonical owner、layer boundary 与 vocabulary
- 冻结 admitted asset families：legacy binary Office、modern OOXML、PDF、image、text-like / HTML file asset
- 冻结 `MinerU / Paddle / multimodal enrichment / LibreOffice-family conversion service` 的默认 posture
- 冻结 source-specific boundary：`official_web` page-level source-truth 与 `authenticated_notice_portal` notice-level source-truth 不并入 shared loader
- 冻结 repo-owned terminal outcomes 与 provenance expectations

## Out Of Scope

- 不实现 parser / converter 代码
  - 理由：Phase A 只冻结 contract，不落 substrate
- 不打开任何 query-serving、release、embedding 或 alias publish
  - 理由：这是 loader/data-plane boundary phase，不是 serving phase
- 不把 `official_web` 或 `authenticated_notice` 的 source unit 改写成 file unit
  - 理由：source-truth ownership 已由既有 supporting architecture 冻结
- 不把 `Docling`、`OpenDataLoader` 或外部 conversion SaaS 升格成默认主干
  - 理由：当前架构判断已经明确它们不是 repo 默认路线

## Requirements

1. Shared owner and layer must be explicit.
Current state:
  repo 内 file-like asset handling 仍散落在 source-specific path 和 worker wrapper 中。
Target state:
  `packages/ingestion-core` 被明确冻结为 shared file asset loader 的 canonical owner；source channel 继续只拥有 source unit 与 relation truth。
Acceptance criteria:
  - [ ] 架构与 phase 文档明确写出 `packages/ingestion-core` 是 shared file asset loader owner。
  - [ ] 文档明确写出 `official_web` 继续拥有 page-level source-truth，`authenticated_notice_portal` 继续拥有 notice-level source-truth。

2. Shared contract vocabulary must be frozen.
Current state:
  repo 还没有一组跨 source 的 canonical nouns 来表达 file asset handling。
Target state:
  文档明确冻结 `AssetDescriptor`、`NormalizationOutcome`、`ExtractionOutcome`、`TerminalOutcome`、`ArtifactProvenance` 这组 shared nouns。
Acceptance criteria:
  - [ ] Phase A artifacts 明确列出 shared nouns。
  - [ ] 文档明确要求结果区分 normalization、extraction、terminal outcome 和 provenance，而不是单一 success/failure 黑盒。

3. Asset family matrix must be fixed.
Current state:
  Office/PDF/image 的 family boundary 仍容易被 source-specific 历史实现反向定义。
Target state:
  legacy binary Office（`.doc/.xls`）、modern OOXML（`.docx/.xlsx`）、PDF、image、text-like / HTML file asset 被明确冻结为 initial admitted families。
Acceptance criteria:
  - [ ] 文档明确写出 `.doc` 与 `.xls` 同 tranche，`.docx` 与 `.xlsx` 同 tranche。
  - [ ] 文档明确写出 text-like / HTML file asset 不进入 OCR lane。

4. Legacy binary Office posture must be fixed to conversion-first and fail-close.
Current state:
  `.doc` 只有局部 worker wrapper，`.xls` 仍带有 source-specific legacy dependency。
Target state:
  legacy binary Office 只允许先走 LibreOffice-family conversion service，再进入 admitted OOXML extraction；失败时显式 `fail-close`。
Acceptance criteria:
  - [ ] 文档明确禁止在 `ingestion-core` 内手写 legacy binary parser。
  - [ ] 文档明确写出默认 production posture 是 self-hosted LibreOffice-family conversion service。
  - [ ] 文档明确写出不允许把 in-process `soffice --convert-to` 当长期生产形态。

5. Modern OOXML posture must be fixed to deterministic structured extraction.
Current state:
  `.docx/.xlsx` 的 forward contract 仍容易被现有局部 parser 路径绑架。
Target state:
  modern OOXML family 明确走 deterministic structured extraction，优先保留 `docx` 文档结构和 `xlsx` workbook/sheet/table 结构。
Acceptance criteria:
  - [ ] 文档明确写出 `docx` 保留 heading / paragraph / list / table / hyperlink / embedded-image refs。
  - [ ] 文档明确写出 `xlsx` 保留 workbook / sheet / table range / headers / merged cells / formula / displayed value。

6. PDF and image lanes must be split by document complexity, not by parser inertia.
Current state:
  “统一 loader” 仍容易被误解成单一 parser 统治全部 PDF/image。
Target state:
  复杂 PDF 走 `MinerU` 主 lane；简单图片 OCR 走 `Paddle` 主 lane；语义图片只补 multimodal enrichment。
Acceptance criteria:
  - [ ] 文档明确写出 `MinerU` 是复杂 PDF 主候选 lane。
  - [ ] 文档明确写出 `Paddle` 是普通图片 / 简单 OCR 主 lane，而不是 PDF 默认总主路由。
  - [ ] 文档明确写出 multimodal 只用于 `semantic image` enrichment，不替代 document image OCR/layout parser。

7. Non-default tools must be explicitly de-ranked.
Current state:
  `Docling`、`OpenDataLoader`、`Apache OpenOffice` 仍可能被误认为默认主干候选。
Target state:
  这些工具的定位被明确写成非默认主干，只能作为补充、benchmark 或 rejected baseline。
Acceptance criteria:
  - [ ] 文档明确写出 `Docling` 不作为默认全量 parser lane。
  - [ ] 文档明确写出 `OpenDataLoader` 不作为统一资产主干。
  - [ ] 文档明确写出 `Apache OpenOffice` 不作为 legacy Office conversion 基座。

8. Phase A must end with planning truth synchronized to architecture truth.
Current state:
  架构文档与 workstream planning artifact 之间仍可能存在旧的 backend 假设。
Target state:
  `SPEC.md`、`CONTEXT.md`、`PLAN.md`、`STATE.md` 与新的 supporting architecture 保持一致。
Acceptance criteria:
  - [ ] Phase A 目录下存在可被 downstream planning 直接消费的 `SPEC.md`。
  - [ ] `CONTEXT.md` 与 `PLAN.md` 不再把 `Docling spike` 写成默认方向。
  - [ ] `STATE.md` 的 current slice 与 backend posture 和架构文档一致。
