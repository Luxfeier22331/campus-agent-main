from __future__ import annotations

import importlib
import io
import json
import unittest
from unittest.mock import patch

worker = importlib.import_module(
    "campus_ingestion_worker.show_authenticated_document_holding_status"
)


class ShowAuthenticatedDocumentHoldingStatusWorkerCliTest(unittest.TestCase):
    def test_main_builds_common_download_status_report(self) -> None:
        with (
            patch(
                "campus_ingestion_worker.show_authenticated_document_holding_status.load_worker_env"
            ),
            patch(
                "campus_ingestion_worker.show_authenticated_document_holding_status.build_document_registry_from_env",
                return_value=object(),
            ),
            patch(
                "campus_ingestion_worker.show_authenticated_document_holding_status.build_raw_asset_registry_from_env",
                return_value=object(),
            ),
            patch(
                "campus_ingestion_worker.show_authenticated_document_holding_status.build_authenticated_notice_source_truth_inventory_store_from_env",
                return_value=object(),
            ),
            patch(
                "campus_ingestion_worker.show_authenticated_document_holding_status.build_authenticated_notice_file_release_inventory_store_from_env",
                return_value=object(),
            ),
            patch(
                "campus_ingestion_worker.show_authenticated_document_holding_status.build_notice_consumption_projection_store_from_env",
                return_value=object(),
            ),
            patch(
                "campus_ingestion_worker.show_authenticated_document_holding_status.build_internal_notice_read_model_store_from_env",
                return_value=object(),
            ),
            patch(
                "campus_ingestion_worker.show_authenticated_document_holding_status.ObjectStoreSettings.from_env"
            ) as settings_from_env,
            patch(
                "campus_ingestion_worker.show_authenticated_document_holding_status.S3ObjectStoreAdmin",
                return_value=object(),
            ),
            patch(
                "campus_ingestion_worker.show_authenticated_document_holding_status.build_authenticated_document_holding_status_report",
                return_value={
                    "scope_unit_count": 1,
                    "action_required_count": 0,
                    "reason_counts": {},
                    "rows": [],
                },
            ) as build_report,
            patch("sys.stdout", new_callable=io.StringIO) as stdout,
        ):
            settings_from_env.return_value = type(
                "Settings", (), {"bucket_source": "campus-rag-source"}
            )()
            worker.main(
                [
                    "--collection",
                    "common_download_source",
                    "--notice-id",
                    "355119",
                ]
            )

        kwargs = build_report.call_args.kwargs
        self.assertEqual(kwargs["source_corpus"], "authenticated_documents")
        self.assertEqual(kwargs["source_collection"], "common_download_source")
        self.assertEqual(kwargs["notice_ids"], ("355119",))
        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["scope_unit_count"], 1)


if __name__ == "__main__":
    unittest.main()
