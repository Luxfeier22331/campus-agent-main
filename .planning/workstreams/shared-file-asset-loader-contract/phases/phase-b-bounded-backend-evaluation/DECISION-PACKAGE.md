---
phase: "B"
artifact: "decision-package"
created: 2026-04-19
updated: 2026-04-19
status: draft
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
- scoring result:
  - `.doc` service-contract and fail-close evidence: strong synthetic support
  - `.xls` future conversion-first route: still incomplete
- routing rule:
  - always conversion-first
- operator assumptions:
  - do not assume host-global `soffice` or `java`
- known limitations:
  - current `.xls` evidence is migration-pressure evidence, not final-route evidence
- deferred to:
  - `Phase C`: actual service adapter implementation
  - `future hardening`: stronger conversion backend replacement
- current disposition:
  - `fallback-only` for current code truth
  - recommended `admit` target for future conversion-first route, but not yet final

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
- scoring result:
  - PDF `MinerU primary`: passes current synthetic evidence
  - PDF `Paddle` fallback: passes current synthetic evidence
  - simple image `Paddle primary`: passes current synthetic evidence
  - document image `MinerU primary`: passes current synthetic evidence
  - spatial image canonical OCR route: correctly fail-closes
  - semantic-image multimodal trigger: still lacks direct repo test evidence
- routing rule:
  - PDF `MinerU primary`, `Paddle fallback-only`
  - simple image `Paddle primary`
  - document image `MinerU primary`
  - spatial / map-like `manual_review_required`
  - semantic image `multimodal enrichment only`
- operator assumptions:
  - both provider lanes may be dual-run in compare / routing paths
- known limitations:
  - semantic-image multimodal trigger is still research-backed, not test-backed
- deferred to:
  - `Phase C`: routing module implementation
  - `future hardening`: semantic-image multimodal evidence expansion
- current disposition:
  - `admit` for PDF primary/fallback and simple/document image routes
  - `reject` for spatial-image canonical OCR route
  - semantic-image route remains draft

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

## What Still Must Close Before Phase B Can Finish

- direct repo evidence for `semantic-image -> multimodal enrichment only`
- stronger end-to-end evidence for future `.xls` conversion-first route
- explicit defer table for what is left to `Phase C` / `Phase D`

## What Is Deferred To Phase C Or Later

### Deferred To Phase C

- shared contract module implementation
- conversion service client / adapter code
- OOXML adapter code
- routing module code

### Deferred To Phase D

- authenticated notice source migration

### Deferred To Future Hardening

- stronger conversion backend replacement such as `Collabora Online REST`
- post-migration cross-scope adoption

## Closeout Rule

Phase B may be marked complete only when this document is updated from `draft` to a benchmark-backed final decision package.
