---
workstream: shared-file-asset-loader-contract
created: 2026-04-19
updated: 2026-04-19
---

# Project State

## Current Position

**Status:** In Progress
**Current Phase:** A
**Current Phase Name:** Shared Contract And Boundary Freeze
**Current Plan:** `.planning/workstreams/shared-file-asset-loader-contract/phases/phase-a-shared-contract-and-boundary-freeze/PLAN.md`
**Total Phases:** 6
**Total Plans in Phase:** N/A
**Progress:** 0/6 phases complete
**Last Activity:** 2026-04-19
**Last Activity Description:** Reassigned current loader/unification ownership from `authenticated-notice-regulation-consumption` to this repo-level workstream and set it as the active GSD workstream.

## Current Slice

- 当前先冻结 shared file asset loader 的 package-level contract，不先大改实现
- current focus 是把 `typing -> normalization -> extraction -> terminal outcome -> provenance` 收口成 repo 级 shared truth
- `official_web` page-level projection 继续留在 source-specific path，不并入 generic file loader
- `authenticated_notice` attachment path 是首个迁移目标，但本 workstream 不处理 auth owner recovery、release、query-serving 或 panel/chatbot/evals
- backend 方向当前只做 bounded evaluation：
  - legacy Office normalizer: LibreOffice CLI
  - modern OOXML / PDF candidate: Docling spike
  - OCR family: 保留 repo-owned OCR lane semantics

## Blockers

- 目前没有 repo-level blocker
- 真正待裁决的是 shared contract 的边界与 backend family decision，而不是单个 `.doc` 支持细节

## Verification

- 已确认本地代码真相：
  - `authenticated_notice_source_projections.py` 当前仍混合 attachment classification、native extraction 与 terminal outcomes
  - `.doc` normalizer 目前只存在于 worker app 壳，不是 package-level shared capability
  - `official_web` 已有独立 page-level projection path，不应被 generic file loader 吃掉
- 已核对外部官方资料：
  - Unstructured partitioning
  - Docling supported formats
  - Apache Tika supported formats
  - LibreOffice `--convert-to`
  - openpyxl optimized mode
  - xlrd 2.x scope

## Session Continuity

**Stopped At:** Phase A planning completed at the workstream level. Next session should freeze the canonical contract and sample matrix before benchmarking backend combinations.
**Resume File:** `.planning/workstreams/shared-file-asset-loader-contract/phases/phase-a-shared-contract-and-boundary-freeze/PLAN.md`
