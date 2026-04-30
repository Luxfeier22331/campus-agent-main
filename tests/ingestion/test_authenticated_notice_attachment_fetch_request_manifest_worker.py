from __future__ import annotations

import importlib
import io
import json
import unittest
from unittest.mock import patch

from tests.ingestion.authenticated_notice_attachment_fetch_status_worker_test_support import (
    _attachment_ref,
    _FakeInventoryStore,
    _FakeSourceTruthObjectStore,
    _inventory_entry,
)

fetch_request_manifest_worker = importlib.import_module(
    "campus_ingestion_worker.build_authenticated_notice_attachment_fetch_request_manifest"
)
worker_package = importlib.import_module("campus_ingestion_worker")


class AuthenticatedNoticeAttachmentFetchRequestManifestWorkerTest(unittest.TestCase):
    def test_main_builds_collector_manifest_from_selected_source_truth_attachment_refs(
        self,
    ) -> None:
        inventory_store = _FakeInventoryStore(
            (
                _inventory_entry("355929", attachment_ref_count=1),
                _inventory_entry("355867", attachment_ref_count=3),
            )
        )
        object_store = _FakeSourceTruthObjectStore(
            {
                "authenticated_notice_portal/355929/attachment-refs.jsonl": (
                    {
                        **_attachment_ref(
                            "355929",
                            "attachment-0001",
                            object_key=None,
                            content_sha256=None,
                        ),
                        "attachment_capture_policy": "metadata_only",
                        "attachment_capture_state": "metadata_recorded",
                        "retention_class": "metadata_only",
                    },
                ),
                "authenticated_notice_portal/355867/attachment-refs.jsonl": (
                    {
                        **_attachment_ref(
                            "355867",
                            "attachment-0001",
                            object_key=None,
                            content_sha256=None,
                        ),
                        "attachment_capture_policy": "fetch_to_quarantine",
                        "attachment_capture_state": "not_attempted",
                        "retention_class": "quarantine_candidate",
                        "byte_fetch_required_reason": "service_fact_missing_required_fact",
                    },
                    {
                        **_attachment_ref(
                            "355867",
                            "attachment-0002",
                            object_key=None,
                            content_sha256=None,
                        ),
                        "attachment_capture_policy": "fetch_required_for_admitted_owner",
                        "attachment_capture_state": "not_attempted",
                        "retention_class": "admitted_source_bytes",
                        "promotion_owner": "regulations/institutional_rules",
                        "promotion_decision_id": "decision-355867",
                    },
                    {
                        **_attachment_ref(
                            "355867",
                            "attachment-0003",
                            object_key=None,
                            content_sha256=None,
                        ),
                        "attachment_capture_policy": "metadata_only",
                        "attachment_capture_state": "metadata_recorded",
                        "retention_class": "metadata_only",
                    },
                ),
            }
        )
        with (
            patch(
                "campus_ingestion_worker.build_authenticated_notice_attachment_fetch_request_manifest.load_worker_env"
            ),
            patch(
                "campus_ingestion_worker.build_authenticated_notice_attachment_fetch_request_manifest.build_authenticated_notice_source_truth_inventory_store_from_env",
                return_value=inventory_store,
            ),
            patch(
                "campus_ingestion_worker.build_authenticated_notice_attachment_fetch_request_manifest.build_source_truth_object_store",
                return_value=object_store,
            ),
            patch("sys.stdout", new_callable=io.StringIO) as stdout,
        ):
            fetch_request_manifest_worker.main(
                [
                    "--corpus",
                    "campus_notices",
                    "--collection",
                    "internal_notice",
                    "--notice-id",
                    "355929",
                    "--notice-id",
                    "355867",
                ]
            )

        payload = json.loads(stdout.getvalue())
        self.assertEqual(
            payload["schema_version"],
            "authenticated_notice_attachment_fetch_request_manifest_v1",
        )
        self.assertEqual(payload["notice_ids"], ["355867", "355929"])
        self.assertEqual(payload["notice_count"], 2)
        self.assertEqual(payload["fetch_request_count"], 2)
        self.assertEqual(payload["required_source_object_count"], 1)
        self.assertEqual(
            [(row["notice_id"], row["attachment_ref_id"]) for row in payload["requests"]],
            [("355867", "attachment-0001"), ("355867", "attachment-0002")],
        )
        self.assertEqual(
            payload["requests"][1]["collector_admission"],
            {
                "noticeId": "355867",
                "attachmentRefId": "attachment-0002",
                "attachmentCapturePolicy": "fetch_required_for_admitted_owner",
            },
        )

    def test_main_omits_quarantine_refs_that_already_have_uploaded_bytes(self) -> None:
        inventory_store = _FakeInventoryStore((_inventory_entry("355867", attachment_ref_count=1),))
        object_store = _FakeSourceTruthObjectStore(
            {
                "authenticated_notice_portal/355867/attachment-refs.jsonl": (
                    {
                        **_attachment_ref(
                            "355867",
                            "attachment-0001",
                            object_key=(
                                "authenticated_notice_portal/attachment-a/capture/table-a.png"
                            ),
                            content_sha256="a" * 64,
                        ),
                        "storage_provider": "object_store",
                        "ingest_status": "uploaded",
                        "attachment_capture_policy": "fetch_to_quarantine",
                        "attachment_capture_state": "uploaded_quarantine",
                        "retention_class": "quarantine_candidate",
                        "byte_fetch_required": False,
                        "byte_fetch_required_reason": "service_fact_missing_required_fact",
                    },
                ),
            }
        )
        with (
            patch(
                "campus_ingestion_worker.build_authenticated_notice_attachment_fetch_request_manifest.load_worker_env"
            ),
            patch(
                "campus_ingestion_worker.build_authenticated_notice_attachment_fetch_request_manifest.build_authenticated_notice_source_truth_inventory_store_from_env",
                return_value=inventory_store,
            ),
            patch(
                "campus_ingestion_worker.build_authenticated_notice_attachment_fetch_request_manifest.build_source_truth_object_store",
                return_value=object_store,
            ),
            patch("sys.stdout", new_callable=io.StringIO) as stdout,
        ):
            fetch_request_manifest_worker.main(
                [
                    "--corpus",
                    "campus_notices",
                    "--collection",
                    "internal_notice",
                    "--notice-id",
                    "355867",
                ]
            )

        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["notice_ids"], ["355867"])
        self.assertEqual(payload["fetch_request_count"], 0)
        self.assertEqual(payload["required_source_object_count"], 0)
        self.assertEqual(payload["requests"], [])

    def test_package_exposes_manifest_builder_main(self) -> None:
        self.assertIs(
            worker_package.build_authenticated_notice_attachment_fetch_request_manifest_main,
            fetch_request_manifest_worker.main,
        )

    def test_main_fails_when_selected_notice_is_absent_from_source_truth_inventory(self) -> None:
        inventory_store = _FakeInventoryStore((_inventory_entry("355867", attachment_ref_count=0),))
        with (
            patch(
                "campus_ingestion_worker.build_authenticated_notice_attachment_fetch_request_manifest.load_worker_env"
            ),
            patch(
                "campus_ingestion_worker.build_authenticated_notice_attachment_fetch_request_manifest.build_authenticated_notice_source_truth_inventory_store_from_env",
                return_value=inventory_store,
            ),
            self.assertRaisesRegex(ValueError, "source-truth inventory missing notice ids"),
        ):
            fetch_request_manifest_worker.main(
                [
                    "--corpus",
                    "campus_notices",
                    "--collection",
                    "internal_notice",
                    "--notice-id",
                    "355867",
                    "--notice-id",
                    "999999",
                ]
            )


if __name__ == "__main__":
    unittest.main()
