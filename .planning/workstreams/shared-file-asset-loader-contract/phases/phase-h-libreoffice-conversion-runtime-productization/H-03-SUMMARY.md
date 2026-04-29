# H-03 Summary

- worker/env/docs/operator truth 已统一到 `LEGACY_OFFICE_CONVERSION_*` runtime contract，`doctor_env ingestion` 现把 legacy Office conversion seam 视为 canonical readiness。
- repo 已新增 `scripts.verify_legacy_office_conversion_runtime`，可直接从 authenticated notice source bucket 选取真实 `.doc/.xls` 样本并生成 evidence bundle。
- 真实资产 closeout 已落盘到 `.tmp/phase-h-libreoffice-runtime-productization/`：
  - `.doc`: `authenticated_notice_portal/attachment-014d8b2665dc/2021/sha256/014d8b2665dc366392b29d4823f0245b067cd5d9adea614a832621e005d07a48/capture/2021年中央民族大学新任辅导员专题网络培训教学计划.doc`
  - `.xls`: `authenticated_notice_portal/attachment-0040899867e0/2020/sha256/0040899867e08c39c9388b4647989c5d34c88da6815cf03a23d6e69b6f30519a/capture/19-20-2公外期末考试安排表20.9.3.xls`
- 收口验证已通过：
  - `LEGACY_OFFICE_CONVERSION_BASE_URL=http://127.0.0.1:8091 LEGACY_OFFICE_CONVERSION_INTERNAL_SHARED_SECRET=change-me uv run --all-packages python -m scripts.doctor_env ingestion --json`
  - `uv run --all-packages campus-ingestion-normalize-authenticated-notice-legacy-office-attachment --help`
  - `uv run --all-packages python -m scripts.verify_legacy_office_conversion_runtime --help`
  - `LEGACY_OFFICE_CONVERSION_BASE_URL=http://127.0.0.1:8091 LEGACY_OFFICE_CONVERSION_INTERNAL_SHARED_SECRET=change-me uv run --all-packages python -m scripts.verify_legacy_office_conversion_runtime --output-dir .tmp/phase-h-libreoffice-runtime-productization --json`
  - `uv run --all-packages python -m unittest tests.ingestion.test_legacy_office_conversion_client tests.ingestion.test_file_asset_substrate tests.ingestion.test_normalize_authenticated_notice_legacy_office_attachment_worker tests.test_doctor_env tests.test_verify_legacy_office_conversion_runtime`
  - 结果：`38 tests OK`
