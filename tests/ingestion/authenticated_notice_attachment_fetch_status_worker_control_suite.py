from __future__ import annotations

from .authenticated_notice_attachment_fetch_status_worker_test_support import *


class AuthenticatedNoticeAttachmentFetchStatusWorkerControlTest(unittest.TestCase):
    def test_live_historical_reconcile_report_flags_owner_expectation_mismatches(
        self,
    ) -> None:
        build_report = getattr(
            fetch_status_module,
            "build_authenticated_notice_live_historical_reconcile_report",
            None,
        )
        self.assertIsNotNone(build_report)

        report = build_report(
            inventory_entries=(
                _inventory_entry(
                    "186977",
                    attachment_ref_count=0,
                    owner_expectations=(
                        {
                            "owner_kind": "attachment_document",
                            "relation_type": "attachment_ref",
                            "owner_title_hint": "报名表",
                            "evidence_text": "附件：报名表",
                        },
                    ),
                ),
                _inventory_entry("355119", attachment_ref_count=1),
            ),
            fetch_status_records=(
                _fetch_status_record("355119", "attachment-0001"),
                _fetch_status_record("999999", "attachment-0001"),
            ),
        )

        self.assertEqual(report.source_notice_count, 2)
        self.assertEqual(report.source_attachment_ref_count, 1)
        self.assertEqual(report.fetch_status_record_count, 2)
        self.assertEqual(report.missing_fetch_status_attachment_refs, ())
        self.assertEqual(
            report.extra_fetch_status_attachment_refs,
            ("muc_internal_portal:999999:attachment-0001",),
        )
        self.assertEqual(report.attachment_owner_expectation_mismatch_count, 1)
        self.assertEqual(report.action_required_count, 1)
        self.assertEqual(report.attachment_owner_expectation_mismatches[0].notice_id, "186977")
        self.assertEqual(
            report.attachment_owner_expectation_mismatches[0].owner_title_hint,
            "报名表",
        )

    def test_control_plane_status_report_aggregates_bounded_operator_counts(self) -> None:
        build_reconcile_report = getattr(
            fetch_status_module,
            "build_authenticated_notice_live_historical_reconcile_report",
            None,
        )
        build_control_plane_status_report = getattr(
            fetch_status_module,
            "build_authenticated_notice_control_plane_status_report",
            None,
        )
        self.assertIsNotNone(build_reconcile_report)
        self.assertIsNotNone(build_control_plane_status_report)
        inventory_entries = (
            _inventory_entry(
                "186977",
                attachment_ref_count=1,
                reference_only_count=1,
                owner_expectations=(
                    {
                        "owner_kind": "attachment_document",
                        "relation_type": "attachment_ref",
                        "owner_title_hint": "报名表",
                        "evidence_text": "附件：报名表",
                    },
                ),
            ),
            _inventory_entry(
                "355493",
                attachment_ref_count=1,
                reference_only_count=0,
                terminal_attachment_outcomes=(
                    {
                        "attachment_ref_id": "attachment-0001",
                        "classification": "unsupported_binary",
                        "terminal_outcome": "unsupported_binary",
                    },
                ),
            ),
        )
        fetch_status_records = (
            _fetch_status_record("186977", "attachment-0001"),
            _collected_fetch_status_record("355493", "attachment-0001"),
        )
        reference_only_report = build_reference_only_attachment_explanation_report(
            inventory_entries=inventory_entries,
            attachment_refs_by_key={
                "authenticated_notice_portal/186977/attachment-refs.jsonl": (
                    _attachment_ref(
                        "186977",
                        "attachment-0001",
                        object_key=None,
                        content_sha256=None,
                    ),
                ),
                "authenticated_notice_portal/355493/attachment-refs.jsonl": (
                    _attachment_ref(
                        "355493",
                        "attachment-0001",
                        object_key="objects/355493/materials.zip",
                        content_sha256="b" * 64,
                    ),
                ),
            },
            fetch_status_records=fetch_status_records,
        )
        reconcile_report = build_reconcile_report(
            inventory_entries=inventory_entries,
            fetch_status_records=fetch_status_records,
        )

        status_report = build_control_plane_status_report(
            inventory_entries=inventory_entries,
            reconcile_report=reconcile_report,
            reference_only_report=reference_only_report,
            latest_collector_run={"run_id": "run-20260404", "notices_collected": 2},
        )

        self.assertEqual(status_report.source_notice_count, 2)
        self.assertEqual(status_report.source_attachment_ref_count, 2)
        self.assertEqual(status_report.reference_only_action_required_count, 0)
        self.assertEqual(status_report.reconcile_action_required_count, 0)
        self.assertEqual(status_report.unsupported_binary_count, 1)
        self.assertEqual(status_report.latest_collector_run["run_id"], "run-20260404")

    def test_check_live_historical_reconcile_main_reports_owner_mismatches(self) -> None:
        reconcile_worker = importlib.import_module(
            "campus_ingestion_worker.check_authenticated_notice_live_historical_reconcile"
        )
        inventory_store = _FakeInventoryStore(
            (
                _inventory_entry(
                    "186977",
                    attachment_ref_count=0,
                    owner_expectations=(
                        {
                            "owner_kind": "attachment_document",
                            "relation_type": "attachment_ref",
                            "owner_title_hint": "报名表",
                            "evidence_text": "附件：报名表",
                        },
                    ),
                ),
            )
        )
        with (
            patch(
                "campus_ingestion_worker.check_authenticated_notice_live_historical_reconcile.load_worker_env"
            ),
            patch(
                "campus_ingestion_worker.check_authenticated_notice_live_historical_reconcile.build_authenticated_notice_source_truth_inventory_store_from_env",
                return_value=inventory_store,
            ),
            patch(
                "campus_ingestion_worker.check_authenticated_notice_live_historical_reconcile.build_authenticated_notice_attachment_fetch_status_store_from_env",
                return_value=InMemoryAuthenticatedNoticeAttachmentFetchStatusStore(),
            ),
            patch("sys.stdout", new_callable=io.StringIO) as stdout,
        ):
            reconcile_worker.main(
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
        self.assertEqual(payload["attachment_owner_expectation_mismatch_count"], 1)
        self.assertEqual(payload["action_required_count"], 1)

    def test_show_control_plane_status_main_reports_operator_summary(self) -> None:
        status_worker = importlib.import_module(
            "campus_ingestion_worker.show_authenticated_notice_control_plane_status"
        )
        inventory_store = _FakeInventoryStore(
            (
                _inventory_entry("186977", attachment_ref_count=1),
                _inventory_entry(
                    "355493",
                    attachment_ref_count=1,
                    reference_only_count=0,
                    terminal_attachment_outcomes=(
                        {
                            "attachment_ref_id": "attachment-0001",
                            "classification": "unsupported_binary",
                            "terminal_outcome": "unsupported_binary",
                        },
                    ),
                ),
            )
        )
        fetch_status_store = InMemoryAuthenticatedNoticeAttachmentFetchStatusStore(
            (
                _fetch_status_record("186977", "attachment-0001"),
                _collected_fetch_status_record("355493", "attachment-0001"),
            )
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
                "authenticated_notice_portal/355493/attachment-refs.jsonl": (
                    _attachment_ref(
                        "355493",
                        "attachment-0001",
                        object_key="objects/355493/materials.zip",
                        content_sha256="b" * 64,
                    ),
                ),
            }
        )
        with (
            patch(
                "campus_ingestion_worker.show_authenticated_notice_control_plane_status.load_worker_env"
            ),
            patch(
                "campus_ingestion_worker.show_authenticated_notice_control_plane_status.build_authenticated_notice_source_truth_inventory_store_from_env",
                return_value=inventory_store,
            ),
            patch(
                "campus_ingestion_worker.show_authenticated_notice_control_plane_status.build_authenticated_notice_attachment_fetch_status_store_from_env",
                return_value=fetch_status_store,
            ),
            patch(
                "campus_ingestion_worker.show_authenticated_notice_control_plane_status.build_source_truth_object_store",
                return_value=object_store,
            ),
            patch(
                "campus_ingestion_worker.show_authenticated_notice_control_plane_status.load_latest_authenticated_notice_collector_run_from_env",
                return_value={"run_id": "run-20260404"},
            ),
            patch("sys.stdout", new_callable=io.StringIO) as stdout,
        ):
            status_worker.main(
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
        self.assertEqual(payload["source_notice_count"], 2)
        self.assertEqual(payload["unsupported_binary_count"], 1)
        self.assertEqual(payload["latest_collector_run"]["run_id"], "run-20260404")
