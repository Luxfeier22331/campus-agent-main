# Quick Task 260414-bsz Verification

## Commands

1. `uv run --all-packages python -m unittest tests.ingestion.test_authenticated_notice_source_projections.AuthenticatedNoticeSourceProjectionsTest.test_rebuild_authenticated_notice_source_projections_notice_id_filter_keeps_unselected_scope_rows tests.ingestion.test_rebuild_authenticated_notice_source_projections_worker`
2. `uv run --all-packages python -m unittest tests.ingestion.test_authenticated_notice_source_projections.AuthenticatedNoticeSourceProjectionsTest.test_rebuild_authenticated_notice_source_projections_replaces_scope_and_materializes_attachment_children tests.ingestion.test_authenticated_notice_source_projections.AuthenticatedNoticeSourceProjectionsTest.test_rebuild_authenticated_notice_source_projections_reuses_ocr_result_for_shared_pdf_payloads`
3. `uv run --all-packages python .planning/quick/260414-bsz-regulation-355282-formal-local-target/formalize_355282_local.py`

## Results

### 1. Targeted source projection rebuild tests

- passed
- filtered `--notice-id` rebuild 当前保持 non-destructive：
  - 不会 whole-scope refresh `campus_notices/internal_notice`
  - 会保留未选中的 scope rows

### 2. Attachment projection regression tests

- passed
- attachment child materialization 与 shared OCR reuse 继续正常

### 3. Local formalization script

- passed
- `before_target_count = 10`
- `after_target_count = 11`
- `355282` source rows after projection:
  - `notice:muc_internal_portal:355282`
  - `notice_attachment:muc_internal_portal:355282:attachment-0001`
- 新 target row：
  - `institutional_regulation:muc:中央民族大学关于学生使用人工智能的指导意见:089bcf7907da`
  - `title = 中央民族大学关于学生使用人工智能的指导意见 / 2026版`
