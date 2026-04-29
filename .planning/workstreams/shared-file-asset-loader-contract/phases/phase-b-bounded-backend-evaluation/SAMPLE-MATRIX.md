---
phase: "B"
artifact: "sample-matrix"
created: 2026-04-19
updated: 2026-04-19
status: active
---

# Phase B Sample Matrix

## Purpose

这份 sample matrix 定义 Phase B 最小 benchmark corpus，避免 Phase B 被临时样本替代。

## Coverage Rules

- 每个 admitted family 都必须有最小覆盖样本
- 优先来自 repo 当前真实 source channels
- 所有样本都必须记录 provenance
- Phase B 不改 source truth，只定义 benchmark 需要什么样的样本

## Minimum Matrix

### Legacy Binary Office

#### `.doc`

- sample 1:
  - plain-text notice attachment
  - focus: conversion success/failure, paragraph fidelity
- sample 2:
  - table-heavy legacy attachment
  - focus: table survival after normalization

#### `.xls`

- sample 1:
  - simple sheet with strings and numbers
  - focus: workbook / sheet fidelity
- sample 2:
  - merged-cell and formula-heavy sheet
  - focus: merged cells, formula/cached value retention

### Modern OOXML

#### `.docx`

- sample 1:
  - heading/list/table-rich document
  - focus: block structure retention
- sample 2:
  - hyperlink/image-ref containing document
  - focus: supplementary package relations

#### `.xlsx`

- sample 1:
  - workbook with shared strings and multiple sheets
  - focus: workbook / sheet graph
- sample 2:
  - workbook with formulas, merged cells, displayed values
  - focus: SpreadsheetML semantic fidelity

### PDF

#### born-digital PDF

- sample 1:
  - multi-page text/table PDF
  - focus: read order and table fidelity

#### scanned/layout-heavy PDF

- sample 1:
  - scan or multi-column sample
  - focus: OCR + layout recovery

### Image

#### document image

- sample 1:
  - table / notice screenshot
  - focus: `MinerU` suitability as primary lane

#### simple image

- sample 1:
  - simple OCR-dominant image
  - focus: `Paddle` suitability as primary lane

#### semantic image

- sample 1:
  - chart / diagram / photo-like explanation image
  - focus: multimodal trigger correctness

## Provenance Fields Required Per Sample

- source channel
- source unit id or attachment relation id
- original object ref
- file family
- file extension
- expected terminal family
- benchmark focus

## Current Preferred Sample Sources

- first wave:
  - `authenticated_notice` attachments
- later if needed:
  - other file-like assets already admitted by repo source channels

## Closeout Rule

Phase B cannot be closed until each family above has at least one accepted benchmark record with provenance and outcome notes.
