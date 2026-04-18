---
phase: "A"
name: "Shared Contract And Boundary Freeze"
created: 2026-04-19
status: active
---

# Phase A Context

## Goal

冻结 repo 级 shared file asset loader 的抽象边界、contract 命名、terminal semantics 与 provenance 语义。

## Current Truth

- repo-level data plane chain 已固定为 `raw asset -> provider output -> source truth -> declared projections -> canonical document artifacts -> document-units -> chunks -> index`
- `authenticated_notice` 当前在 source projection 内同时做 attachment classification、native extraction 与 terminal outcome 判定
- `.doc` normalizer 目前只在 worker app 壳中存在，不是 `packages/ingestion-core` 的 shared capability
- `official_web` 已有 page-level source-truth / projection path；它不是 generic file loader 的 source unit
- user 当前目标是“彻底统一 loader”，但自然语义更接近统一 shared file asset contract，而不是把全 repo source-specific path 全部压成单一 parser backend

## Guardrails

- shared loader 的 canonical owner 固定在 `packages/ingestion-core`
- 不把 `official_web` page-level projection 并入 generic file loader
- 不把 `authenticated_notice` notice-level source-truth contract 改写成 file-level source unit
- 不在 `ingestion-core` 手写 legacy Office binary parser
- 不用单一 black-box parser 覆盖 OCR/manual-review/reference-only semantics
- 不触碰 query-serving、release、panel/chatbot/evals 或 auth owner recovery

## Entry

- `docs/plans/shared-file-asset-loader-contract.md`
