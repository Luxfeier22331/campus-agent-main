---
doc_type: phase_plan
phase: "C"
phase_name: "Shared Normalization And Extraction Substrate"
status: completed
created: 2026-04-19
updated: 2026-04-19
---

# Phase C Plan

## Objective

在 `packages/ingestion-core` 落 package-level shared normalization / extraction substrate，让 admitted file asset families 进入统一 contract，并为 Phase D `authenticated_notice` migration 提供直接可接的 shared API。

## Why This Phase Exists

Phase B 已经关闭 backend selection，但 repo 代码真相仍是 source-specific / app-specific owner：

- `authenticated_notice_source_projections.py` 仍混合 attachment classification、OOXML extraction、OCR / terminal outcomes
- legacy Office normalization 目前仍只存在于 worker shell
- PDF / image routing 虽已有 shared seeds，但还未收口成 package-level substrate entry

如果 Phase C 不先把这些能力迁到正确 owner，Phase D 很容易退化成“边迁移边继续 patch current module”。

## Locked Inputs

- legacy binary Office：
  - `JODConverter + LibreOffice`
  - conversion-first
- modern OOXML：
  - `docx`: `python-docx`
  - `xlsx`: repo-owned SpreadsheetML ZIP/XML adapter
- PDF / image：
  - PDF: `MinerU primary`, `Paddle fallback-only`
  - document image: `MinerU primary`
  - simple image: `Paddle primary`
  - spatial / map-like: fail-close
  - semantic image: non-canonical, multimodal enrichment only

## Execution Slices

### Slice 1: Land Shared Contract Surface

- add package-level contract module for:
  - asset descriptor
  - normalization outcome
  - extraction outcome
  - terminal outcome
  - artifact provenance
- keep contract bounded to admitted families; do not generalize to universal file parser
- define family entrypoints that Phase D can call without depending on source-specific schema

### Slice 2: Extract Legacy Office Normalization Seam

- move conversion contract truth into `packages/ingestion-core`
- keep worker CLI as thin shell delegating to package-level normalizer
- make `.doc` and `.xls` share one normalization request/result surface
- preserve source hash, normalized hash, normalizer name/version, failure detail

### Slice 3: Extract Modern OOXML Adapters

- move `docx` deterministic extraction out of `authenticated_notice_source_projections.py`
- move `xlsx` deterministic extraction out of `authenticated_notice_source_projections.py`
- preserve current verified semantics:
  - `docx`: paragraph / heading / table-oriented text blocks
  - `xlsx`: workbook / sheet / row text blocks, shared strings, formula/cached value awareness
- prohibit new `openpyxl` / `xlrd` dependency introduction

### Slice 4: Land Shared PDF/Image Routing Substrate

- consolidate `raw_asset_typing.py`, `online_ocr_routing.py`, and current OCR compare artifacts into a reusable routing module
- ensure terminal semantics remain explicit:
  - canonical admitted
  - fallback-only
  - manual review required
  - reference-only / deferred
- preserve `semantic_image` exclusion and spatial fail-close

### Slice 5: Normalize Provenance And Artifact Refs

- make normalization / extraction return repo-owned artifact refs rather than app-local temp assumptions
- standardize engine/version/source-hash/warnings/failure-reason shape across families
- ensure Phase D can materialize child documents without reverse-engineering provider payload paths

### Slice 6: Verification

- add focused package tests for:
  - legacy Office normalization seam
  - `docx` adapter
  - `xlsx` adapter
  - PDF/image routing substrate
- rerun high-signal consumer regressions for authenticated notice to prove no semantic regression before migration

## Proposed Write Set

- new package-level substrate modules under `packages/ingestion-core/src/campus_ingestion_core/`
- thin worker delegation update in `apps/ingestion-worker/src/campus_ingestion_worker/normalize_authenticated_notice_legacy_office_attachment.py`
- focused ingestion tests for shared substrate
- minimal planning/state sync under this workstream

## Exit Rule

Phase C completes only when:

- package-level shared substrate exists for admitted families
- worker/source-specific modules no longer own forward parser truth
- Phase D can migrate `authenticated_notice` by wiring to existing shared APIs rather than creating more adapters
