# Quick Task 260414-9vu Verification

## Commands

1. `uv run --all-packages python -m unittest tests.ingestion.test_authenticated_notice_file_release_owner_recovery`
2. `uv run --all-packages python -m unittest tests.ingestion.test_authenticated_notice_file_release_owner_recovery tests.ingestion.test_authenticated_notice_import.AuthenticatedNoticeImportTest.test_import_authenticated_notice_export_preserves_file_release_owner_expectation_in_inventory_snapshot tests.ingestion.test_internal_notice_regulation_promotion.InternalNoticeRegulationPromotionTest.test_build_manifest_fail_closes_file_release_backed_wrapper_notice_without_recovered_owner_document`

## Result

- command 1：`Ran 5 tests ... OK`
- command 2：`Ran 7 tests ... OK`
- command 2 用于确认新增 readiness contract 没有改坏现有 `owner_expectation + fail-close` 真相
