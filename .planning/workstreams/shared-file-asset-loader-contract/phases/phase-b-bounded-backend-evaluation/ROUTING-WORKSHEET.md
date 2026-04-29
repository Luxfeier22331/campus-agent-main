---
phase: "B"
artifact: "routing-worksheet"
created: 2026-04-19
updated: 2026-04-19
status: active
---

# Phase B Routing Worksheet

## Purpose

这份 worksheet 把 RESEARCH.md 里的定性路由规则转成 evaluator-facing 记录模板。

## Route Classes

### `simple-image`

must satisfy all:

- dominant value is OCR text, not visual semantics
- no table-heavy layout expectation
- no strict reading-order expectation
- no multi-block document structure requirement

default recommendation:

- `Paddle primary`

### `document-image`

mark as `document-image` when any is true:

- table extraction matters
- reading order matters
- multiple layout blocks matter
- output must preserve document-like structure

default recommendation:

- `MinerU primary`

### `semantic-image`

mark as `semantic-image` only when all are true:

- image value comes mainly from visual relations rather than OCR text itself
- asset does not carry canonical document parsing responsibility
- multimodal output can remain auxiliary enrichment

default recommendation:

- multimodal enrichment only

### `spatial-or-map-like`

mark when:

- image value is spatial / navigational / map-like
- neither OCR-first nor layout-first parsing yields reliable canonical text truth

default recommendation:

- `manual_review_required`

## PDF Notes

### `MinerU primary`

default for:

- born-digital PDF requiring layout sensitivity
- scanned PDF
- multi-column PDF
- table-heavy PDF

### `Paddle fallback-only`

use only when:

- acting as salvage / fallback lane
- or running a lightweight OCR probe
- and not serving as the canonical default route

## Legacy Office Conversion Trust Check

mark normalized output as `structure-trustworthy` only when:

- expected normalized artifact exists
- output extension and package shape are correct
- extracted block structure is materially recoverable
- no unexplained conversion corruption is observed

otherwise:

- fail-close

## Per-Sample Worksheet Fields

- sample id
- source family
- evaluator class:
  - `simple-image`
  - `document-image`
  - `semantic-image`
  - `spatial-or-map-like`
  - `born-digital-pdf`
  - `scanned-or-layout-heavy-pdf`
  - `legacy-binary-office`
  - `modern-ooxml`
- reason for class
- primary route
- fallback route if any
- structure-trustworthy: `yes/no`
- recommended terminal outcome if route fails
- notes
