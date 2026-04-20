---
phase: "B"
artifact: "decision-package"
created: 2026-04-19
updated: 2026-04-19
status: final
---

# Phase B Decision Package

## Purpose

这是 Phase B 的 canonical closeout artifact。

Phase B 最终是否可以关闭，以这份文档是否完成为准，而不是以零散 quick notes 或单独研究段落为准。

## Required Closeout Fields

每个 family 的最终记录都必须包含：

- chosen route
- rejected defaults
- sample coverage
- scoring result
- routing rule
- operator assumptions
- known limitations
- deferred to:
  - `Phase C`
  - `Phase D`
  - `future hardening`
- final disposition:
  - `admit`
  - `fallback-only`
  - `reject`

## Current Recommended Decisions

### Legacy Binary Office

- recommended route:
  - dedicated conversion service
  - `JODConverter + LibreOffice`
  - normalized OOXML
  - deterministic extraction
- rejected defaults:
  - worker-local `soffice --convert-to`
  - external conversion SaaS default
  - `Apache OpenOffice`
- sample coverage:
  - `legacy-doc-normalizer-001`
  - `legacy-doc-normalizer-002`
  - `legacy-xls-current-code-001`
  - `legacy-xls-normalizer-002`
- scoring result:
  - `.doc` service-contract and fail-close evidence: strong synthetic support
  - `.xls` conversion-first route now has matching provenance-preserving synthetic support
- routing rule:
  - always conversion-first
- operator assumptions:
  - do not assume host-global `soffice` or `java`
- known limitations:
  - evidence is still synthetic; package-level shared conversion adapter remains Phase C work
- deferred to:
  - `Phase C`: actual service adapter implementation
  - `future hardening`: stronger conversion backend replacement
- current disposition:
  - `admit`

### Modern OOXML

- `docx`
  - `python-docx` as primary structured reader
  - package relations helper for hyperlink / embedded-image refs
- `xlsx`
  - repo-owned SpreadsheetML ZIP/XML adapter
- rejected defaults:
  - `openpyxl`
  - `xlrd`
  - OCR-first fallback
  - universal parser
- sample coverage:
  - `modern-docx-001`
  - `modern-xlsx-001`
- scoring result:
  - `docx` and `xlsx` both have passing synthetic structured-extraction evidence
- routing rule:
  - deterministic structured extraction only
- operator assumptions:
  - no OCR dependence
- known limitations:
  - current evidence is synthetic, not live fixture corpus
- deferred to:
  - `Phase C`: shared adapter implementation
- current disposition:
  - `admit`

### PDF / Image Routing

- PDF:
  - `MinerU primary`
  - `Paddle fallback-only`
- document image:
  - `MinerU primary`
- simple image:
  - `Paddle primary`
- semantic image:
  - multimodal enrichment only
- sample coverage:
  - `pdf-authenticated-notice-001`
  - `pdf-authenticated-notice-002`
  - `pdf-raw-ingestion-001`
  - `pdf-raw-ingestion-002`
  - `image-routing-simple-001`
  - `image-routing-complex-001`
  - `image-routing-spatial-001`
  - `image-raw-ingestion-simple-002`
  - `image-raw-ingestion-complex-002`
  - `image-raw-ingestion-spatial-002`
  - `auth-inline-spatial-001`
  - `auth-inline-schedule-001`
  - `auth-inline-scoring-table-001`
  - `auth-inline-mobile-ui-001`
  - `semantic-routing-001`
  - `auth-inline-semantic-hero-001`
- scoring result:
  - PDF `MinerU primary`: passes current synthetic evidence
  - PDF `Paddle` fallback: passes current synthetic evidence
  - simple image `Paddle primary`: passes current synthetic evidence
  - document image `MinerU primary`: passes current synthetic evidence
  - spatial image canonical OCR route: correctly fail-closes
  - semantic-image trigger now has direct repo evidence that it must stay out of canonical OCR/document parsing lanes
- routing rule:
  - PDF `MinerU primary`, `Paddle fallback-only`
  - simple image `Paddle primary`
  - document image `MinerU primary`
  - spatial / map-like `manual_review_required`
  - semantic image excluded from canonical OCR and reserved for `multimodal enrichment only`
- operator assumptions:
  - both provider lanes may be dual-run in compare / routing paths
- known limitations:
  - current repo evidence covers semantic-image exclusion threshold; a live multimodal adapter is still deferred to later implementation
- deferred to:
  - `Phase C`: routing module implementation and multimodal adapter seam
  - `future hardening`: semantic-image benchmark corpus expansion
- current disposition:
  - `admit` for PDF primary/fallback, simple/document image routes, and semantic-image exclusion threshold
  - `reject` for spatial-image canonical OCR route

### Terminal Semantics

- preserve existing repo-owned terminal outcomes
- do not rename them in Phase C
- do not let provider private success state override them

## What Is Already Closed In Phase B

- candidate set boundaries
- default rejected routes
- evaluation rubric structure
- minimum sample matrix structure
- evaluator-facing routing worksheet

## Phase B Closeout Result

- bounded benchmark evidence is sufficient to freeze all admitted family entry decisions
- remaining work is implementation/deployment follow-up, not backend selection reopen

## What Is Deferred To Phase C Or Later

### Deferred To Phase C

- shared contract module implementation
- conversion service client / adapter code
- OOXML adapter code
- routing module code
- multimodal adapter seam

### Deferred To Phase D

- authenticated notice source migration

### Deferred To Future Hardening

- stronger conversion backend replacement such as `Collabora Online REST`
- post-migration cross-scope adoption

## Closeout Rule

Phase B is now benchmark-backed and may be marked complete.
