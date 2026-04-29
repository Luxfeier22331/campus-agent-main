from __future__ import annotations

import unittest

from campus_ingestion_core.authenticated_notice_browser_url_backfill import (
    backfill_authenticated_notice_browser_urls,
)


class AuthenticatedNoticeBrowserUrlBackfillTest(unittest.TestCase):
    def test_backfills_portal_print_browser_urls_from_bundle_notice_type(self) -> None:
        records = [
            {
                "notice_id": 351117,
                "notice": {
                    "notice_id": 351117,
                    "notice_title": "通知标题",
                    "notice_link": None,
                    "notice_link_state": 0,
                    "notice_source": 0,
                    "categories": [
                        {
                            "notice_id": 351117,
                            "notice_type": "9980",
                            "notice_type_name": "学术信息",
                        }
                    ],
                },
            }
        ]

        result = backfill_authenticated_notice_browser_urls(
            bundle_records=records,
            source_home_url="https://my.muc.edu.cn/page/11",
        )

        self.assertEqual(result.summary["records_seen"], 1)
        self.assertEqual(result.summary["backfilled_count"], 1)
        notice = result.bundle_records[0]["notice"]
        self.assertEqual(
            notice["portal_print_url"],
            "https://my.muc.edu.cn/#/print?type=9980&notice_id=351117&show_type=1",
        )
        self.assertEqual(notice["notice_browser_url"], notice["portal_print_url"])
        self.assertEqual(notice["notice_browser_url_source"], "portal_print_route")

    def test_reports_missing_notice_type_and_preserves_api_notice_link(self) -> None:
        records = [
            {
                "notice_id": 1,
                "notice": {
                    "notice_id": 1,
                    "notice_link": "https://external.example.edu/news/1",
                    "notice_link_state": 0,
                    "notice_source": 1,
                    "categories": [],
                },
            },
            {
                "notice_id": 2,
                "notice": {
                    "notice_id": 2,
                    "notice_link": None,
                    "notice_link_state": 0,
                    "notice_source": 0,
                    "categories": [],
                },
            },
        ]

        result = backfill_authenticated_notice_browser_urls(
            bundle_records=records,
            source_home_url="https://my.muc.edu.cn",
        )

        self.assertEqual(result.summary["missing_notice_type_count"], 2)
        self.assertEqual(result.summary["unavailable_count"], 1)
        self.assertEqual(
            result.bundle_records[0]["notice"]["notice_browser_url"],
            "https://external.example.edu/news/1",
        )
        self.assertIsNone(result.bundle_records[0]["notice"]["portal_print_url"])
        self.assertEqual(
            result.bundle_records[0]["notice"]["notice_browser_url_source"],
            "api_notice_link",
        )
        self.assertEqual(
            result.bundle_records[1]["notice"]["notice_browser_url_source"],
            "unavailable",
        )


if __name__ == "__main__":
    unittest.main()
