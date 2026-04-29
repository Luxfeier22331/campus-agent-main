---
phase: "B"
artifact: "benchmark-evidence"
created: 2026-04-19
updated: 2026-04-19
status: final
---

# Phase B Benchmark Evidence

## Purpose

这份文档记录 Phase B 当前已经落下的 sample-by-sample benchmark evidence。

当前 evidence 仍以 repo-owned synthetic tests 为主，不等于 live corpus benchmark 全部完成；但它已经足以把 Phase B 从“只有研究建议”推进到“有可复查 evidence 的 final decision package”。

## Verification Commands

已执行：

```bash
uv run --all-packages python -m unittest \
  tests.ingestion.test_normalize_authenticated_notice_legacy_office_attachment_worker \
  tests.ingestion.test_online_ocr_compare \
  tests.ingestion.test_authenticated_notice_source_projections
```

结果：

- `Ran 46 tests in 4.883s`
- `OK`

已执行：

```bash
uv run --all-packages python -m unittest \
  tests.ingestion.test_normalize_authenticated_notice_legacy_office_attachment_worker \
  tests.ingestion.test_online_ocr_routing \
  tests.ingestion.test_online_ocr_compare
```

结果：

- `Ran 17 tests in 0.063s`
- `OK`

已执行：

```bash
uv run --all-packages python -m unittest \
  tests.ingestion.test_process_raw_ingestion_job.ProcessRawIngestionJobTest.test_source_truth_only_routes_pdf_through_mineru_primary_and_persists_raw_zip_sidecar \
  tests.ingestion.test_process_raw_ingestion_job.ProcessRawIngestionJobTest.test_source_truth_only_falls_back_to_paddle_when_mineru_primary_fails_for_pdf \
  tests.ingestion.test_process_raw_ingestion_job.ProcessRawIngestionJobTest.test_source_truth_only_dual_runs_generic_image_and_promotes_simple_table_to_paddle \
  tests.ingestion.test_process_raw_ingestion_job.ProcessRawIngestionJobTest.test_source_truth_only_dual_runs_generic_image_and_promotes_complex_table_to_mineru \
  tests.ingestion.test_process_raw_ingestion_job.ProcessRawIngestionJobTest.test_source_truth_only_dual_runs_generic_image_and_fail_closes_spatial_image
```

结果：

- `Ran 5 tests in 0.022s`
- `OK`

## Evaluation Records

### Legacy Binary Office

#### Sample `legacy-doc-normalizer-001`

- family: `legacy-binary-office`
- source:
  - [`tests/ingestion/test_normalize_authenticated_notice_legacy_office_attachment_worker.py`](/home/reptilian/code/campus-agent/tests/ingestion/test_normalize_authenticated_notice_legacy_office_attachment_worker.py)
  - `test_normalize_invokes_soffice_and_returns_provenance_summary`
- route:
  - `soffice` conversion with provenance summary
- result:
  - normalized `.docx` produced
  - source and normalized hashes recorded
  - normalizer name/version recorded
- reading:
  - supports required conversion-contract surface

#### Sample `legacy-doc-normalizer-002`

- family: `legacy-binary-office`
- source:
  - [`tests/ingestion/test_normalize_authenticated_notice_legacy_office_attachment_worker.py`](/home/reptilian/code/campus-agent/tests/ingestion/test_normalize_authenticated_notice_legacy_office_attachment_worker.py)
  - `test_normalize_requires_soffice`
- route:
  - missing conversion dependency
- result:
  - explicit `RuntimeError`
- reading:
  - supports fail-close requirement

#### Sample `legacy-xls-current-code-001`

- family: `legacy-binary-office`
- source:
  - [`tests/ingestion/test_authenticated_notice_source_projections.py`](/home/reptilian/code/campus-agent/tests/ingestion/test_authenticated_notice_source_projections.py)
  - `test_rebuild_authenticated_notice_source_projections_materializes_downloaded_xls_attachment`
- route:
  - current source-specific `.xls` extraction lane
- result:
  - synthetic spreadsheet child materialized under patched extractor
- reading:
  - evidence of migration pressure only, not proof of the future conversion-first route

#### Sample `legacy-xls-normalizer-002`

- family: `legacy-binary-office`
- source:
  - [`tests/ingestion/test_normalize_authenticated_notice_legacy_office_attachment_worker.py`](/home/reptilian/code/campus-agent/tests/ingestion/test_normalize_authenticated_notice_legacy_office_attachment_worker.py)
  - `test_normalize_xls_invokes_soffice_and_returns_provenance_summary`
- route:
  - `soffice` conversion with provenance summary
- result:
  - normalized `.xlsx` produced
  - source and normalized hashes recorded
  - normalizer name/version recorded
- reading:
  - supports future `.xls -> .xlsx -> deterministic extraction` conversion-first contract

### Modern OOXML

#### Sample `modern-docx-001`

- family: `modern-ooxml`
- source:
  - [`tests/ingestion/test_authenticated_notice_source_projections.py`](/home/reptilian/code/campus-agent/tests/ingestion/test_authenticated_notice_source_projections.py)
  - `test_rebuild_authenticated_notice_source_projections_replaces_scope_and_materializes_attachment_children`
- route:
  - downloaded `.docx` attachment materialization
- result:
  - text-extractable child materialized
  - scope replacement remains consistent
- reading:
  - supports `docx` deterministic structured extraction

#### Sample `modern-xlsx-001`

- family: `modern-ooxml`
- source:
  - [`tests/ingestion/test_authenticated_notice_source_projections.py`](/home/reptilian/code/campus-agent/tests/ingestion/test_authenticated_notice_source_projections.py)
  - `test_rebuild_authenticated_notice_source_projections_materializes_downloaded_xlsx_attachment`
- route:
  - downloaded `.xlsx` attachment materialization
- result:
  - extracted markdown contains `姓名`, `张三`, `2026001`
  - route is text-extractable, not OCR
- reading:
  - supports `xlsx` deterministic structured extraction

### PDF

#### Sample `pdf-authenticated-notice-001`

- family: `pdf`
- source:
  - [`tests/ingestion/test_authenticated_notice_source_projections.py`](/home/reptilian/code/campus-agent/tests/ingestion/test_authenticated_notice_source_projections.py)
  - `test_rebuild_authenticated_notice_source_projections_routes_downloaded_pdf_attachments_to_ocr`
- route:
  - downloaded PDF attachment to OCR lane
- result:
  - OCR lane engaged for `supplement.pdf`
  - units carry `extraction_class=ocr_required`
- reading:
  - supports OCR/layout-aware PDF path

#### Sample `pdf-authenticated-notice-002`

- family: `pdf`
- source:
  - [`tests/ingestion/test_authenticated_notice_source_projections.py`](/home/reptilian/code/campus-agent/tests/ingestion/test_authenticated_notice_source_projections.py)
  - `test_rebuild_authenticated_notice_source_projections_reuses_ocr_result_for_shared_pdf_payloads`
- route:
  - repeated shared PDF payload
- result:
  - OCR result for shared `supplement.pdf` reused once
- reading:
  - supports provenance-aware OCR artifact reuse

#### Sample `pdf-raw-ingestion-001`

- family: `pdf`
- source:
  - [`tests/ingestion/test_process_raw_ingestion_job.py`](/home/reptilian/code/campus-agent/tests/ingestion/test_process_raw_ingestion_job.py)
  - `test_source_truth_only_routes_pdf_through_mineru_primary_and_persists_raw_zip_sidecar`
- route:
  - canonical raw-ingestion PDF lane
- result:
  - `MinerU` called
  - no Paddle call
  - raw zip sidecar persisted
  - layout rows attributed to `mineru_api`
- reading:
  - supports `MinerU primary`

#### Sample `pdf-raw-ingestion-002`

- family: `pdf`
- source:
  - [`tests/ingestion/test_process_raw_ingestion_job.py`](/home/reptilian/code/campus-agent/tests/ingestion/test_process_raw_ingestion_job.py)
  - `test_source_truth_only_falls_back_to_paddle_when_mineru_primary_fails_for_pdf`
- route:
  - primary failure fallback
- result:
  - `MinerU` attempted
  - Paddle called once
  - no raw zip sidecar persisted
  - layout rows attributed to `paddleocr_async`
- reading:
  - supports `Paddle fallback-only`

### Image Routing

#### Sample `image-routing-simple-001`

- family: `image`
- source:
  - [`tests/ingestion/test_online_ocr_compare.py`](/home/reptilian/code/campus-agent/tests/ingestion/test_online_ocr_compare.py)
  - `test_compare_online_ocr_refines_simple_table_image_and_recommends_paddle`
- evaluator class: `simple-image`
- result:
  - refined subkind `simple_table_image`
  - provider `paddleocr_async_jobs`
- reading:
  - supports `Paddle primary`

#### Sample `image-routing-complex-001`

- family: `image`
- source:
  - [`tests/ingestion/test_online_ocr_compare.py`](/home/reptilian/code/campus-agent/tests/ingestion/test_online_ocr_compare.py)
  - `test_compare_online_ocr_refines_complex_table_image_and_recommends_mineru`
- evaluator class: `document-image`
- result:
  - refined subkind `complex_table_image`
  - provider `mineru_api`
- reading:
  - supports `MinerU primary`

#### Sample `image-routing-spatial-001`

- family: `image`
- source:
  - [`tests/ingestion/test_online_ocr_compare.py`](/home/reptilian/code/campus-agent/tests/ingestion/test_online_ocr_compare.py)
  - `test_compare_online_ocr_refines_spatial_image_and_marks_it_deferred`
- evaluator class: `spatial-or-map-like`
- result:
  - refined subkind `spatial_image`
  - `canonical_allowed=false`
- reading:
  - supports fail-close / deferred route

#### Sample `semantic-routing-001`

- family: `image`
- source:
  - [`tests/ingestion/test_online_ocr_routing.py`](/home/reptilian/code/campus-agent/tests/ingestion/test_online_ocr_routing.py)
  - `test_select_online_ocr_routing_defers_semantic_images_from_canonical_ocr`
- evaluator class: `semantic-image`
- result:
  - route id `semantic_image_deferred`
  - `canonical_allowed=false`
- reading:
  - supports direct repo evidence that semantic-image assets must stay out of canonical OCR/document parsing lanes

#### Sample `image-raw-ingestion-simple-002`

- family: `image`
- source:
  - [`tests/ingestion/test_process_raw_ingestion_job.py`](/home/reptilian/code/campus-agent/tests/ingestion/test_process_raw_ingestion_job.py)
  - `test_source_truth_only_dual_runs_generic_image_and_promotes_simple_table_to_paddle`
- evaluator class: `simple-image`
- result:
  - both providers run
  - refined subkind `simple_table_image`
  - routing decision persisted
- reading:
  - supports `Paddle primary`

#### Sample `image-raw-ingestion-complex-002`

- family: `image`
- source:
  - [`tests/ingestion/test_process_raw_ingestion_job.py`](/home/reptilian/code/campus-agent/tests/ingestion/test_process_raw_ingestion_job.py)
  - `test_source_truth_only_dual_runs_generic_image_and_promotes_complex_table_to_mineru`
- evaluator class: `document-image`
- result:
  - both providers run
  - refined subkind `complex_table_image`
  - layout rows attributed to `mineru_api`
- reading:
  - supports `MinerU primary`

#### Sample `image-raw-ingestion-spatial-002`

- family: `image`
- source:
  - [`tests/ingestion/test_process_raw_ingestion_job.py`](/home/reptilian/code/campus-agent/tests/ingestion/test_process_raw_ingestion_job.py)
  - `test_source_truth_only_dual_runs_generic_image_and_fail_closes_spatial_image`
- evaluator class: `spatial-or-map-like`
- result:
  - both providers run
  - refined subkind `spatial_image`
  - no canonical provider artifacts persisted
- reading:
  - supports fail-close / reject canonical OCR route

### Authenticated Notice Inline Image Context

#### Sample `auth-inline-spatial-001`

- family: `image`
- source:
  - [`tests/ingestion/test_authenticated_notice_source_projections.py`](/home/reptilian/code/campus-agent/tests/ingestion/test_authenticated_notice_source_projections.py)
  - `test_rebuild_authenticated_notice_source_projections_routes_spatial_inline_images_to_manual_review`
- evaluator class: `spatial-or-map-like`
- result:
  - `manual_review_attachment_count=1`
  - no OCR call
- reading:
  - supports `manual_review_required`

#### Sample `auth-inline-schedule-001`

- family: `image`
- source:
  - [`tests/ingestion/test_authenticated_notice_source_projections.py`](/home/reptilian/code/campus-agent/tests/ingestion/test_authenticated_notice_source_projections.py)
  - `test_classify_attachment_ref_routes_operational_schedule_inline_images_to_manual_review`
- evaluator class: `document-image with operational schedule semantics`
- result:
  - classified as `manual_review_required`
- reading:
  - supports fail-close over false OCR success

#### Sample `auth-inline-scoring-table-001`

- family: `image`
- source:
  - [`tests/ingestion/test_authenticated_notice_source_projections.py`](/home/reptilian/code/campus-agent/tests/ingestion/test_authenticated_notice_source_projections.py)
  - `test_rebuild_authenticated_notice_source_projections_keeps_scoring_table_inline_images_in_ocr_lane`
  - `test_classify_attachment_ref_keeps_scoring_table_inline_images_in_ocr_lane`
- evaluator class: `document-image`
- result:
  - scoring table remains in OCR lane
  - OCR client called
- reading:
  - supports admitted document-image route

#### Sample `auth-inline-mobile-ui-001`

- family: `image`
- source:
  - [`tests/ingestion/test_authenticated_notice_source_projections.py`](/home/reptilian/code/campus-agent/tests/ingestion/test_authenticated_notice_source_projections.py)
  - `test_rebuild_authenticated_notice_source_projections_routes_mobile_ui_screenshots_to_reference_only_when_body_already_carries_the_instruction`
  - `test_rebuild_authenticated_notice_source_projections_routes_compact_mobile_ui_screenshots_to_reference_only_when_body_already_carries_the_instruction`
- evaluator class: non-canonical contextual UI screenshot
- result:
  - `reference_only_attachment_count=2`
  - no OCR call
- reading:
  - supports narrow routing, not broad OCR admission

#### Sample `auth-inline-semantic-hero-001`

- family: `image`
- source:
  - [`tests/ingestion/test_authenticated_notice_source_projections.py`](/home/reptilian/code/campus-agent/tests/ingestion/test_authenticated_notice_source_projections.py)
  - `test_rebuild_authenticated_notice_source_projections_routes_intro_poster_inline_images_to_reference_only`
  - `test_rebuild_authenticated_notice_source_projections_routes_social_practice_hero_images_to_reference_only`
- evaluator class: `semantic-image`
- result:
  - `reference_only_attachment_count=2`
  - no OCR call
- reading:
  - supports authenticated-notice-backed semantic visuals staying auxiliary/reference-only instead of entering canonical OCR

## Current Reading Of The Evidence

- legacy `.doc` normalization contract has strong synthetic evidence for provenance + fail-close
- `.xls` now has repo-owned conversion-first synthetic evidence via `.xls -> .xlsx` provenance-preserving normalization
- `docx`, `xlsx`, PDF primary/fallback, simple-image, complex-image, and spatial-image routing all now have repo-owned synthetic evidence
- semantic-image now has direct repo evidence for canonical exclusion from OCR/document parsing lanes; live multimodal enrichment remains a later implementation concern, not a Phase B closeout blocker
