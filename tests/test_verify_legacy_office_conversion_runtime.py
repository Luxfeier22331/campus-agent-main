from __future__ import annotations

import unittest

from scripts.verify_legacy_office_conversion_runtime import (
    LegacyOfficeRuntimeVerificationError,
    select_legacy_office_source_keys,
)


class VerifyLegacyOfficeConversionRuntimeTest(unittest.TestCase):
    def test_select_legacy_office_source_keys_discovers_doc_and_xls_from_source_keys(self) -> None:
        selection = select_legacy_office_source_keys(
            [
                "authenticated_notice_portal/attachment-001/2020/sha256/a/capture/example.docx",
                "authenticated_notice_portal/attachment-002/2020/sha256/b/capture/real-sample.xls",
                "authenticated_notice_portal/attachment-003/2020/sha256/c/capture/real-plan.doc",
            ]
        )

        self.assertEqual(
            selection["doc"],
            "authenticated_notice_portal/attachment-003/2020/sha256/c/capture/real-plan.doc",
        )
        self.assertEqual(
            selection["xls"],
            "authenticated_notice_portal/attachment-002/2020/sha256/b/capture/real-sample.xls",
        )

    def test_select_legacy_office_source_keys_respects_explicit_overrides(self) -> None:
        selection = select_legacy_office_source_keys(
            [],
            doc_object_key="authenticated_notice_portal/attachment-doc/2021/sha256/doc/capture/custom.doc",
            xls_object_key="authenticated_notice_portal/attachment-xls/2021/sha256/xls/capture/custom.xls",
        )

        self.assertEqual(
            selection["doc"],
            "authenticated_notice_portal/attachment-doc/2021/sha256/doc/capture/custom.doc",
        )
        self.assertEqual(
            selection["xls"],
            "authenticated_notice_portal/attachment-xls/2021/sha256/xls/capture/custom.xls",
        )

    def test_select_legacy_office_source_keys_fails_closed_when_bucket_scan_lacks_xls(self) -> None:
        with self.assertRaises(LegacyOfficeRuntimeVerificationError):
            select_legacy_office_source_keys(
                [
                    "authenticated_notice_portal/attachment-001/2020/sha256/a/capture/example.doc",
                ]
            )


if __name__ == "__main__":
    unittest.main()
