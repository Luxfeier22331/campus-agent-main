---
phase: "A"
name: "Shared Contract And Boundary Freeze"
created: 2026-04-19
updated: 2026-04-19
status: completed
---

# Phase A Context

## Goal

冻结 repo 级 shared file asset loader 的抽象边界、contract 命名、terminal semantics 与 provenance 语义。

## Current Truth

- repo-level data plane chain 已固定为 `raw asset -> provider output -> source truth -> declared projections -> canonical document artifacts -> document-units -> chunks -> index`
- `authenticated_notice` 当前在 source projection 内同时做 attachment classification、native extraction 与 terminal outcome 判定
- `.doc` normalizer 目前只在 worker app 壳中存在，不是 `packages/ingestion-core` 的 shared capability
- `.xls` 当前仍由 `xlrd` 支撑，`.xlsx` 当前仍走 source-specific 自写解析；这是待收口的 current code truth，不是 forward contract 必须保留的承诺
- `official_web` 已有 page-level source-truth / projection path；它不是 generic file loader 的 source unit
- user 当前目标是“彻底统一 loader”，但自然语义更接近统一 shared file asset contract，而不是把全 repo source-specific path 全部压成单一 parser backend
- user 已明确：`.xls` 应与 `.doc` 同 phase 处理，`.xlsx` 应与 `.docx` 同 phase 处理；因此 Office family 需要拆成 legacy binary Office 与 modern OOXML 两个 tranche，而不是把 spreadsheet 单独后移
- repo 架构现已明确：复杂 PDF 主 lane 倾向 `MinerU`，普通图片 OCR 主 lane 倾向 `Paddle`；语义图片允许单独走 multimodal enrichment
- repo 架构现已明确：legacy binary Office 默认 production posture 是 self-hosted LibreOffice-family conversion service；第一实现优先 `JODConverter + LibreOffice`，后续可替换成 `Collabora Online REST`
- `Docling` 与 `OpenDataLoader` 当前都不再是默认主干候选：前者资源成本过高，后者只适合作为 born-digital PDF 补充或 benchmark lane

## Guardrails

- shared loader 的 canonical owner 固定在 `packages/ingestion-core`
- 不把 `official_web` page-level projection 并入 generic file loader
- 不把 `authenticated_notice` notice-level source-truth contract 改写成 file-level source unit
- 不在 `ingestion-core` 手写 legacy Office binary parser
- 不把现有 `xlrd` / OOXML source-specific parser 误当成必须延续的 product contract
- 不用单一 black-box parser 覆盖 OCR/manual-review/reference-only semantics
- 不把 remote API 与 self-hosted service 混成 asset family 分类规则
- 不把多模态图像理解误当成 document image 的默认 OCR/parser
- 不把外部 conversion SaaS 视为 legacy Office 的默认长期姿态
- 不触碰 query-serving、release、panel/chatbot/evals 或 auth owner recovery

## Entry

- `docs/plans/archive/completed/shared-file-asset-loader-contract.md`
