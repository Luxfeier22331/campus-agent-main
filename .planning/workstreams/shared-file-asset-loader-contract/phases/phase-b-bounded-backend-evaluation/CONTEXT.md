---
phase: "B"
name: "Bounded Backend Evaluation"
created: 2026-04-19
updated: 2026-04-19
status: active
---

# Phase B Context

## Goal

在 Phase A 已冻结的 contract posture 内，用真实样本收口 shared file asset loader 的 backend choices、routing threshold 与 operator contract。

## Current Truth

- Phase A 已完成：`packages/ingestion-core` 是 canonical owner，source-specific page/notice truth 不并入 shared loader
- admitted families 已冻结为：legacy binary Office（`.doc/.xls`）、modern OOXML（`.docx/.xlsx`）、PDF、image、text-like / HTML file asset
- legacy binary Office 的默认 production posture 已冻结为 self-hosted LibreOffice-family conversion service；第一实现优先 `JODConverter + LibreOffice`，后续 stronger option 是 `Collabora Online REST`
- complex PDF 主 lane 倾向 `MinerU`
- simple OCR / generic image 主 lane 倾向 `Paddle`
- multimodal lane 只允许用于 `semantic image` enrichment
- `Docling`、`OpenDataLoader`、`Apache OpenOffice` 当前都不是 trunk default
- repo 当前代码真相仍处于 source-specific 分散状态：
  - `.doc` normalizer 只在 worker app 壳中存在
  - `.xls` 仍直接依赖 `xlrd`
  - `.xlsx` 仍走 source-specific 自写 XML 解析
  - `authenticated_notice` attachment path 仍混合 classification、extraction 与 terminal semantics
- user 已明确：不应再以历史 canonical lane 或遗留依赖为技术选型依据；`openpyxl/xlrd` 应尽快退出 forward design

## Guardrails

- Phase B 只做 bounded backend evaluation，不提前实现 substrate
- 不把 remote API 与 self-hosted service 混成 asset family 规则
- 不把 parser “支持格式列表”误当成 shared contract 质量证明
- 不因为已有局部 `.xls/.xlsx` 代码而维持遗留依赖
- 不把 multimodal 扩成所有 image/document 的默认入口
- 不重开 `official_web` page-level source-truth 与 `authenticated_notice_portal` notice-level source-truth 边界
- 不触碰 query-serving、retrieval、release、panel/chatbot/evals

## Entry

- `docs/plans/shared-file-asset-loader-contract.md`
