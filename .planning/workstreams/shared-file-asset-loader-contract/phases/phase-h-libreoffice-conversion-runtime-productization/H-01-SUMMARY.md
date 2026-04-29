# H-01 Summary

- `packages/ingestion-core` 已新增 `legacy_office_conversion_client.py`，把 legacy Office canonical caller seam 冻结为 internal HTTP client。
- `file_asset_legacy_office.py` 与 `normalize_authenticated_notice_legacy_office_attachment.py` 已切到 service-backed path，不再直接 shell out 到 `soffice --convert-to`。
- 回归验证已通过：
  - `uv run --all-packages python -m unittest tests.ingestion.test_legacy_office_conversion_client tests.ingestion.test_file_asset_substrate tests.ingestion.test_normalize_authenticated_notice_legacy_office_attachment_worker`
  - 结果：`24 tests OK`
