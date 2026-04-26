from __future__ import annotations

from .authenticated_notice_attachment_fetch_status_worker_test_support import *


class AuthenticatedNoticeAttachmentFetchStatusWorkerReferenceTest(unittest.TestCase):
    def test_reference_only_explanation_report_separates_terminal_inline_and_action_required(
        self,
    ) -> None:
        report = build_reference_only_attachment_explanation_report(
            inventory_entries=(
                _inventory_entry(
                    "186977",
                    attachment_ref_count=2,
                    projected_attachment_ref_ids=("attachment-0001",),
                ),
                _inventory_entry("355119", attachment_ref_count=1),
                _inventory_entry("355120", attachment_ref_count=1),
            ),
            attachment_refs_by_key={
                "authenticated_notice_portal/186977/attachment-refs.jsonl": (
                    _attachment_ref("186977", "attachment-0001", object_key="doc.docx"),
                    _attachment_ref(
                        "186977",
                        "attachment-0002",
                        object_key=None,
                        content_sha256=None,
                    ),
                ),
                "authenticated_notice_portal/355119/attachment-refs.jsonl": (
                    _attachment_ref(
                        "355119",
                        "attachment-0001",
                        object_key="inline.png",
                        resource_role="inline_image",
                        content_kind="image",
                    ),
                ),
                "authenticated_notice_portal/355120/attachment-refs.jsonl": (
                    _attachment_ref(
                        "355120",
                        "attachment-0001",
                        object_key=None,
                        content_sha256=None,
                    ),
                ),
            },
            fetch_status_records=(
                _fetch_status_record("186977", "attachment-0002"),
                _collected_fetch_status_record("355119", "attachment-0001"),
            ),
        )

        self.assertEqual(report.reference_only_attachment_count, 3)
        self.assertEqual(report.action_required_count, 1)
        self.assertEqual(report.reason_counts["terminal_unavailable"], 1)
        self.assertEqual(report.reason_counts["object_backed_inline_image_reference_only"], 1)
        self.assertEqual(report.reason_counts["missing_object_key"], 1)
        self.assertEqual(
            [(row.notice_id, row.attachment_ref_id, row.reason) for row in report.rows],
            [
                ("186977", "attachment-0002", "terminal_unavailable"),
                (
                    "355119",
                    "attachment-0001",
                    "object_backed_inline_image_reference_only",
                ),
                ("355120", "attachment-0001", "missing_object_key"),
            ],
        )

    def test_reference_only_explanation_report_ignores_entries_without_reference_only_inventory(
        self,
    ) -> None:
        report = build_reference_only_attachment_explanation_report(
            inventory_entries=(
                _inventory_entry(
                    "355121",
                    attachment_ref_count=1,
                    reference_only_count=0,
                ),
            ),
            attachment_refs_by_key={
                "authenticated_notice_portal/355121/attachment-refs.jsonl": (
                    _attachment_ref(
                        "355121",
                        "attachment-0001",
                        object_key=None,
                        content_sha256=None,
                    ),
                ),
            },
            fetch_status_records=(),
        )

        self.assertEqual(report.reference_only_attachment_count, 0)
        self.assertEqual(report.action_required_count, 0)
        self.assertEqual(report.rows, ())

    def test_reference_only_explanation_report_excludes_unsupported_binary_terminal_outcomes(
        self,
    ) -> None:
        report = build_reference_only_attachment_explanation_report(
            inventory_entries=(
                _inventory_entry(
                    "355493",
                    attachment_ref_count=2,
                    reference_only_count=1,
                    terminal_attachment_outcomes=(
                        {
                            "attachment_ref_id": "attachment-0002",
                            "classification": "unsupported_binary",
                            "terminal_outcome": "unsupported_binary",
                        },
                    ),
                ),
            ),
            attachment_refs_by_key={
                "authenticated_notice_portal/355493/attachment-refs.jsonl": (
                    _attachment_ref(
                        "355493",
                        "attachment-0001",
                        object_key=None,
                        content_sha256=None,
                    ),
                    _attachment_ref(
                        "355493",
                        "attachment-0002",
                        object_key="objects/355493/materials.zip",
                        content_sha256="b" * 64,
                    ),
                ),
            },
            fetch_status_records=(),
        )

        self.assertEqual(report.reference_only_attachment_count, 1)
        self.assertEqual(
            [(row.notice_id, row.attachment_ref_id) for row in report.rows],
            [("355493", "attachment-0001")],
        )

    def test_check_reference_only_main_reports_action_required_rows(self) -> None:
        inventory_store = _FakeInventoryStore(
            (
                _inventory_entry(
                    "186977",
                    attachment_ref_count=1,
                    projected_attachment_ref_ids=(),
                ),
                _inventory_entry(
                    "355119",
                    attachment_ref_count=1,
                    projected_attachment_ref_ids=(),
                ),
            )
        )
        fetch_status_store = InMemoryAuthenticatedNoticeAttachmentFetchStatusStore(
            (_fetch_status_record("186977", "attachment-0001"),)
        )
        object_store = _FakeSourceTruthObjectStore(
            {
                "authenticated_notice_portal/186977/attachment-refs.jsonl": (
                    _attachment_ref(
                        "186977",
                        "attachment-0001",
                        object_key=None,
                        content_sha256=None,
                    ),
                ),
                "authenticated_notice_portal/355119/attachment-refs.jsonl": (
                    _attachment_ref(
                        "355119",
                        "attachment-0001",
                        object_key=None,
                        content_sha256=None,
                    ),
                ),
            }
        )
        with (
            patch(
                "campus_ingestion_worker.check_authenticated_notice_reference_only_attachments.load_worker_env"
            ),
            patch(
                "campus_ingestion_worker.check_authenticated_notice_reference_only_attachments.build_authenticated_notice_source_truth_inventory_store_from_env",
                return_value=inventory_store,
            ),
            patch(
                "campus_ingestion_worker.check_authenticated_notice_reference_only_attachments.build_authenticated_notice_attachment_fetch_status_store_from_env",
                return_value=fetch_status_store,
            ),
            patch(
                "campus_ingestion_worker.check_authenticated_notice_reference_only_attachments.build_source_truth_object_store",
                return_value=object_store,
            ),
            patch("sys.stdout", new_callable=io.StringIO) as stdout,
        ):
            check_reference_only_worker.main(
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
        self.assertEqual(payload["reference_only_attachment_count"], 2)
        self.assertEqual(payload["action_required_count"], 1)
        self.assertEqual(payload["reason_counts"]["terminal_unavailable"], 1)
        self.assertEqual(payload["reason_counts"]["missing_object_key"], 1)
        self.assertEqual(payload["rows"][0]["reason"], "terminal_unavailable")
        self.assertEqual(payload["rows"][1]["reason"], "missing_object_key")
