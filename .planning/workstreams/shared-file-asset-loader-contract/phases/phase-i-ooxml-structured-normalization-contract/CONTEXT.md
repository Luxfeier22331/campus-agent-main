---
phase: I
workstream: shared-file-asset-loader-contract
status: completed
created: 2026-04-20
updated: 2026-04-20
---

# Phase I Context

## Objective

Introduce a repo-owned post-extraction structured normalization contract for modern OOXML (`.docx` / `.xlsx`) inside the shared file asset loader.

## Why This Phase Exists

- Real-asset verification proved the current OOXML extractors are source-faithful and consumable.
- The same evidence also showed that shared loader truth still stops at `ExtractionOutcome.text_blocks`.
- `xlsx` continuation rows, header promotion, merged-cell semantics, and retrieval-grade structural consumption still require downstream guesswork.
- This is a shared loader contract gap, not a legacy Office conversion-runtime gap and not a collection-specific cleanup task.

## Evidence Anchors

- `.tmp/phase-h-libreoffice-runtime-productization-recheck/OOXML-EXTRACTION-SUMMARY.md`
- `.tmp/phase-h-libreoffice-runtime-productization-recheck/ooxml-extraction-report.json`
- `.tmp/phase-h-libreoffice-runtime-productization-recheck/OOXML-QUALITY-VALIDATION.md`

## Phase Status

- Phase added
- Plan drafted and executed
- `docx/xlsx` OOXML structured normalizer 已落到代码真相
- `authenticated_notice_source_projections.py` 已优先消费 structured layout rows
- real-sample OOXML recheck 已通过；详见 `SUMMARY.md`
