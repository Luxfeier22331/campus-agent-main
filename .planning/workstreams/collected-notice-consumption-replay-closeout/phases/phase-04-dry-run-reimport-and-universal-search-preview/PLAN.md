---
doc_type: plan
status: completed
created: 2026-04-29
updated: 2026-04-29
---

<!-- markdownlint-disable MD013 -->

# Phase 4 Plan: Dry-Run Reimport And Universal Search Preview

## Goal

用当前已采集对象做 no-write reimport preview，并证明全量可检索层可以覆盖 valid captured notices。

## Tasks

1. 从 verified run/object refs 生成 reimport plan。
2. dry-run 构建 source-truth / document holding preview。
3. dry-run 构建 searchable notice projection/read-model preview。
4. 输出 searchable coverage report。
5. 输出 invalid/defer/requires-multimodal report。

## Acceptance

- dry-run 不写 DB 和对象存储。
- 每条 valid captured notice 都有 searchable unit。
- searchable unit 有 title、date、source URL、body/search text、attachment refs、OCR/multimodal status 和 provenance。

## Completion

- Implemented read-only reimport preview:
  - `packages/ingestion-core/src/campus_ingestion_core/collected_notice_reimport_preview.py`
  - `apps/ingestion-worker/src/campus_ingestion_worker/preview_collected_notice_reimport.py`
- Added focused tests:
  - `tests/ingestion/test_collected_notice_reimport_preview.py`
  - `tests/ingestion/test_preview_collected_notice_reimport_worker.py`
- Generated evidence:
  - `../../evidence/phase-04-dry-run-reimport-and-universal-search-preview/reimport-plan.dry-run.json`
  - `../../evidence/phase-04-dry-run-reimport-and-universal-search-preview/source-truth-preview.json`
  - `../../evidence/phase-04-dry-run-reimport-and-universal-search-preview/searchable-notice-preview.json`
  - `../../evidence/phase-04-dry-run-reimport-and-universal-search-preview/searchable-coverage-report.json`
  - `../../evidence/phase-04-dry-run-reimport-and-universal-search-preview/invalid-defer-requires-multimodal-report.json`
