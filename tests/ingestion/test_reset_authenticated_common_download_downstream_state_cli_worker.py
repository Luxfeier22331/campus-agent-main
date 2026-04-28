from __future__ import annotations

import importlib
import io
import json
import unittest
from unittest.mock import patch

worker = importlib.import_module(
    "campus_ingestion_worker.reset_authenticated_common_download_downstream_state"
)


class ResetAuthenticatedCommonDownloadDownstreamStateWorkerCliTest(unittest.TestCase):
    def test_main_requires_yes_flag(self) -> None:
        with (
            patch(
                "campus_ingestion_worker.reset_authenticated_common_download_downstream_state.load_worker_env"
            ),
            self.assertRaises(SystemExit),
        ):
            worker.main(["--notice-id", "355119"])

    def test_main_executes_reset_and_prints_report(self) -> None:
        with (
            patch(
                "campus_ingestion_worker.reset_authenticated_common_download_downstream_state.load_worker_env"
            ),
            patch(
                "campus_ingestion_worker.reset_authenticated_common_download_downstream_state.build_authenticated_notice_source_truth_inventory_store_from_env",
                return_value=object(),
            ),
            patch(
                "campus_ingestion_worker.reset_authenticated_common_download_downstream_state.build_document_registry_from_env",
                return_value=object(),
            ),
            patch(
                "campus_ingestion_worker.reset_authenticated_common_download_downstream_state.build_raw_asset_registry_from_env",
                return_value=object(),
            ),
            patch(
                "campus_ingestion_worker.reset_authenticated_common_download_downstream_state.build_notice_consumption_projection_store_from_env",
                return_value=object(),
            ),
            patch(
                "campus_ingestion_worker.reset_authenticated_common_download_downstream_state.build_internal_notice_read_model_store_from_env",
                return_value=object(),
            ),
            patch(
                "campus_ingestion_worker.reset_authenticated_common_download_downstream_state.ObjectStoreSettings.from_env"
            ) as settings_from_env,
            patch(
                "campus_ingestion_worker.reset_authenticated_common_download_downstream_state.S3ObjectStoreAdmin",
                return_value=object(),
            ),
            patch(
                "campus_ingestion_worker.reset_authenticated_common_download_downstream_state.reset_authenticated_common_download_downstream_state",
                return_value={
                    "purged_notice_ids": ["355119"],
                    "inventory_row_removed_count": 1,
                    "document_row_removed_count": 1,
                    "raw_asset_row_removed_count": 0,
                    "projection_row_removed_count": 1,
                    "read_model_row_removed_count": 1,
                    "source_artifact_removed_count": 3,
                    "derived_artifact_removed_count": 2,
                },
            ) as run_reset,
            patch("sys.stdout", new_callable=io.StringIO) as stdout,
        ):
            settings_from_env.return_value = type(
                "Settings",
                (),
                {
                    "bucket_source": "campus-rag-source",
                    "bucket_derived": "campus-rag-derived",
                },
            )()
            worker.main(["--notice-id", "355119", "--yes"])

        kwargs = run_reset.call_args.kwargs
        self.assertEqual(kwargs["notice_ids"], ("355119",))
        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["inventory_row_removed_count"], 1)


if __name__ == "__main__":
    unittest.main()
