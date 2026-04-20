---
workstream: shared-file-asset-loader-contract
created: 2026-04-19
updated: 2026-04-20
---

# Project State

## Current Position

**Status:** Completed
**Current Phase:** Complete
**Current Phase Name:** Closed Out After Phase I
**Current Plan:** `<none>`
**Total Phases:** 9
**Total Plans in Phase:** 0
**Progress:** 9/9 phases complete
**Last Activity:** 2026-04-20
**Last Activity Description:** Completed `Phase I`: fixed real-sample DOCX heading extraction and XLSX forward-fill semantics, added repo-owned OOXML verification script, generated fresh Phase I evidence, and closed the workstream at `9/9 phases complete`.

## Current Slice

- Phase A-H closeout truth 继续成立
- `Phase I` 已完成：
  - `file_asset_ooxml.py` 已冻结 repo-owned `build_ooxml_layout_elements_bytes(...)`
  - `docx` 现在会把真实样本中的标题与 section-like 行提升为 headings，而不是全部降级成 plain paragraphs
  - `xlsx` continuation handling 已明确只回填 leading repeated cells，不再把 interior blanks 误补成前一行值
  - `file_asset_text_extractable.py` 已提供 shared dispatcher `build_text_extractable_layout_elements_bytes(...)`
  - `authenticated_notice_source_projections.py` 已优先消费 structured rows，并持久化 `layout_elements_bytes`
  - `scripts.verify_ooxml_structured_normalization.py` 已新增为 repo-owned real-sample verification command
  - `.tmp/phase-i-ooxml-structured-normalization/` 已生成 fresh evidence bundle：
    - `OOXML-STRUCTURED-NORMALIZATION-SUMMARY.md`
    - `OOXML-STRUCTURED-QUALITY-VALIDATION.md`
    - `ooxml-structured-normalization-report.json`
- 这条 workstream 现已 completed；未来只有在 admitted asset families、canonical parser lane 或 deferred cross-scope adoption 被重新提升为 active implementation 时才会 reopen

## Blockers

- 无；这条 workstream 已完成，后续只有在新的 admitted family / canonical lane 改写 / deferred cross-scope adoption 被重新 admission 时才会 reopen

## Verification

- `uv run --all-packages python -m unittest tests.ingestion.test_legacy_office_conversion_client tests.ingestion.test_file_asset_substrate tests.ingestion.test_normalize_authenticated_notice_legacy_office_attachment_worker`
  - `24 tests OK`
- `docker build -f apps/legacy-office-conversion-service/Dockerfile --target unit-tests -t campus-legacy-office-conversion:test /home/reptilian/code/campus-agent`
  - `exit 0`
- `docker compose -f infra/local/docker-compose.legacy-office-conversion.yml up -d --build`
  - runtime booted successfully
- `curl -sS http://127.0.0.1:8091/healthz`
  - `{"status":"ok","engine_name":"jodconverter+libreoffice","engine_version":"LibreOffice 7.3.7.2 30(Build:2)"}`
- `curl -sS http://127.0.0.1:8091/readyz`
  - `{"engine_name":"jodconverter+libreoffice","engine_version":"LibreOffice 7.3.7.2 30(Build:2)","status":"ready"}`
- `LEGACY_OFFICE_CONVERSION_BASE_URL=http://127.0.0.1:8091 LEGACY_OFFICE_CONVERSION_INTERNAL_SHARED_SECRET=change-me uv run --all-packages python -m scripts.doctor_env ingestion --json`
  - `overall_ready=true`
- `uv run --all-packages campus-ingestion-normalize-authenticated-notice-legacy-office-attachment --help`
  - `exit 0`
- `LEGACY_OFFICE_CONVERSION_BASE_URL=http://127.0.0.1:8091 LEGACY_OFFICE_CONVERSION_INTERNAL_SHARED_SECRET=change-me uv run --all-packages python -m scripts.verify_legacy_office_conversion_runtime --output-dir .tmp/phase-h-libreoffice-runtime-productization --json`
  - real `.doc` + `.xls` evidence generated successfully
- `uv run --all-packages python -m unittest tests.ingestion.test_legacy_office_conversion_client tests.ingestion.test_file_asset_substrate tests.ingestion.test_normalize_authenticated_notice_legacy_office_attachment_worker tests.test_doctor_env tests.test_verify_legacy_office_conversion_runtime`
  - `38 tests OK`
- `docker compose -f infra/local/docker-compose.legacy-office-conversion.yml down`
  - service shutdown succeeded
- `uv run --all-packages python -m unittest tests.ingestion.test_file_asset_substrate`
  - `15 tests OK`
- `uv run --all-packages python -m unittest tests.ingestion.test_authenticated_notice_source_projections`
  - `37 tests OK`
- `uv run --all-packages python -m unittest tests.ingestion.test_authenticated_notice_import tests.ingestion.test_import_authenticated_notice_export_worker`
  - `12 tests OK`
- `uv run --all-packages python -m unittest tests.test_verify_ooxml_structured_normalization tests.ingestion.test_file_asset_substrate tests.ingestion.test_authenticated_notice_source_projections tests.ingestion.test_authenticated_notice_import tests.ingestion.test_import_authenticated_notice_export_worker`
  - `69 tests OK`
- `uv run --all-packages python -m scripts.verify_ooxml_structured_normalization --json`
  - fresh Phase I real-sample evidence generated successfully
- `git diff --check -- .planning/WORKSTREAMS.md .planning/workstreams/shared-file-asset-loader-contract/STATE.md .planning/workstreams/shared-file-asset-loader-contract/ROADMAP.md .planning/workstreams/shared-file-asset-loader-contract/phases/phase-i-ooxml-structured-normalization-contract/CONTEXT.md .planning/workstreams/shared-file-asset-loader-contract/phases/phase-i-ooxml-structured-normalization-contract/SUMMARY.md docs/plans/shared-file-asset-loader-contract.md docs/architecture/file-asset-loader-architecture.md scripts/verify_ooxml_structured_normalization.py tests/test_verify_ooxml_structured_normalization.py packages/ingestion-core/src/campus_ingestion_core/file_asset_ooxml.py packages/ingestion-core/src/campus_ingestion_core/file_asset_text_extractable.py packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_source_projections.py tests/ingestion/test_file_asset_substrate.py tests/ingestion/test_authenticated_notice_source_projections.py`
  - `pass`

## Session Continuity

**Stopped At:** workstream 已在 `Phase I` 完成收口；当前不再有 active phase，后续只会在新的 admitted family / canonical lane 变更或 deferred adoption 被重新 admission 时另行恢复
**Resume File:** `<none>`
