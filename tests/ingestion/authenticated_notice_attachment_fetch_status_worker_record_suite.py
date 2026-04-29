from __future__ import annotations

from .authenticated_notice_attachment_fetch_status_worker_test_support import *


class AuthenticatedNoticeAttachmentFetchStatusWorkerRecordTest(unittest.TestCase):
    def test_record_main_builds_records_from_bundle_and_upserts_status_store(self) -> None:
        store = InMemoryAuthenticatedNoticeAttachmentFetchStatusStore()
        with (
            patch(
                "campus_ingestion_worker.record_authenticated_notice_attachment_fetch_status.load_worker_env"
            ),
            patch(
                "campus_ingestion_worker.record_authenticated_notice_attachment_fetch_status.load_authenticated_notice_bundle_payload",
                return_value=_bundle_with_missing_attachment(),
            ),
            patch(
                "campus_ingestion_worker.record_authenticated_notice_attachment_fetch_status.build_authenticated_notice_attachment_fetch_status_store_from_env",
                return_value=store,
            ) as build_store,
            patch("sys.stdout", new_callable=io.StringIO) as stdout,
        ):
            record_worker.main(
                [
                    "--bundle-path",
                    "/tmp/notices-bundle.json",
                    "--site-id",
                    "muc_internal_portal",
                    "--observed-at",
                    "2026-04-04T01:23:45.000Z",
                ]
            )

        build_store.assert_called_once()
        records = store.list_by_notice_ids(
            site_id="muc_internal_portal",
            notice_ids=("186977",),
        )
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0].fetch_status, FETCH_STATUS_TERMINAL_UNAVAILABLE)
        self.assertEqual(records[0].terminal_reason, TERMINAL_REASON_HTTP_404)
        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["record_count"], 1)
        self.assertEqual(payload["status_counts"], {"terminal_unavailable": 1})
        self.assertEqual(payload["selected_notice_ids"], ["186977"])

    def test_show_main_lists_records_by_notice_ids(self) -> None:
        store = InMemoryAuthenticatedNoticeAttachmentFetchStatusStore()
        store.upsert_many(
            record_worker.build_attachment_fetch_status_records_from_bundle_records(
                bundle_records=_bundle_with_missing_attachment(),
                site_id="muc_internal_portal",
                observed_at="2026-04-04T01:23:45.000Z",
            )
        )
        with (
            patch(
                "campus_ingestion_worker.show_authenticated_notice_attachment_fetch_status.load_worker_env"
            ),
            patch(
                "campus_ingestion_worker.show_authenticated_notice_attachment_fetch_status.build_authenticated_notice_attachment_fetch_status_store_from_env",
                return_value=store,
            ),
            patch("sys.stdout", new_callable=io.StringIO) as stdout,
        ):
            show_worker.main(
                [
                    "--site-id",
                    "muc_internal_portal",
                    "--notice-id",
                    "186977",
                ]
            )

        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["record_count"], 1)
        self.assertEqual(payload["status_counts"], {"terminal_unavailable": 1})
        self.assertEqual(payload["records"][0]["notice_id"], "186977")
        self.assertEqual(payload["records"][0]["terminal_reason"], "http_404")

    def test_coverage_report_flags_missing_and_extra_fetch_status_rows(self) -> None:
        report = build_attachment_fetch_status_coverage_report(
            inventory_entries=(
                _inventory_entry("186977", attachment_ref_count=2),
                _inventory_entry("355119", attachment_ref_count=1),
            ),
            fetch_status_records=(
                _fetch_status_record("186977", "attachment-0001"),
                _fetch_status_record("999999", "attachment-0001"),
            ),
        )

        self.assertEqual(report.source_notice_count, 2)
        self.assertEqual(report.source_attachment_ref_count, 3)
        self.assertEqual(report.fetch_status_record_count, 2)
        self.assertEqual(
            report.missing_fetch_status_attachment_refs,
            (
                "muc_internal_portal:186977:attachment-0002",
                "muc_internal_portal:355119:attachment-0001",
            ),
        )
        self.assertEqual(
            report.extra_fetch_status_attachment_refs,
            ("muc_internal_portal:999999:attachment-0001",),
        )
        self.assertEqual(report.status_counts, {"terminal_unavailable": 2})

    def test_check_main_reports_fetch_status_coverage(self) -> None:
        inventory_store = _FakeInventoryStore(
            (
                _inventory_entry("186977", attachment_ref_count=2),
                _inventory_entry("355119", attachment_ref_count=1),
            )
        )
        fetch_status_store = InMemoryAuthenticatedNoticeAttachmentFetchStatusStore(
            (_fetch_status_record("186977", "attachment-0001"),)
        )
        with (
            patch(
                "campus_ingestion_worker.check_authenticated_notice_attachment_fetch_status.load_worker_env"
            ),
            patch(
                "campus_ingestion_worker.check_authenticated_notice_attachment_fetch_status.build_authenticated_notice_source_truth_inventory_store_from_env",
                return_value=inventory_store,
            ),
            patch(
                "campus_ingestion_worker.check_authenticated_notice_attachment_fetch_status.build_authenticated_notice_attachment_fetch_status_store_from_env",
                return_value=fetch_status_store,
            ),
            patch("sys.stdout", new_callable=io.StringIO) as stdout,
        ):
            check_worker.main(
                [
                    "--corpus",
                    "campus_notices",
                    "--collection",
                    "internal_notice",
                    "--site-id",
                    "muc_internal_portal",
                ]
            )

        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["source_attachment_ref_count"], 3)
        self.assertEqual(payload["fetch_status_record_count"], 1)
        self.assertEqual(
            payload["missing_fetch_status_attachment_refs"],
            [
                "muc_internal_portal:186977:attachment-0002",
                "muc_internal_portal:355119:attachment-0001",
            ],
        )
