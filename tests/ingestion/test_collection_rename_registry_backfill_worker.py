from __future__ import annotations

import importlib
import io
import json
import unittest
from unittest.mock import patch

from campus_ingestion_core.collection_rename_registry_backfill import (
    RegistryCollectionRenameApplyReport,
    RegistryCollectionRenameTargetResult,
)

worker = importlib.import_module("campus_ingestion_worker.collection_rename_registry_backfill")


class CollectionRenameRegistryBackfillWorkerCliTest(unittest.TestCase):
    def test_main_runs_apply_subcommand_and_prints_report(self) -> None:
        report = RegistryCollectionRenameApplyReport(
            command="apply",
            targets=(
                RegistryCollectionRenameTargetResult(
                    kind="document_registry",
                    legacy_row_count=2,
                    sample_rows=(),
                    table_name="ingestion_registry.document_registry_records",
                    target_names=("runtime_document_registry",),
                    updated_row_count=2,
                ),
            ),
        )
        with (
            patch("campus_ingestion_worker.collection_rename_registry_backfill.load_worker_env"),
            patch(
                "campus_ingestion_worker.collection_rename_registry_backfill.apply_registry_collection_rename_backfill"
            ) as apply_backfill,
            patch(
                "campus_ingestion_worker.collection_rename_registry_backfill.close_persistent_postgres_pools"
            ) as close_pools,
            patch("sys.stdout", new_callable=io.StringIO) as stdout,
        ):
            apply_backfill.return_value = report
            worker.main(["apply"])

        payload = json.loads(stdout.getvalue())
        self.assertEqual(apply_backfill.call_count, 1)
        self.assertEqual(close_pools.call_count, 1)
        self.assertEqual(payload["command"], "apply")
        self.assertEqual(payload["targets"][0]["updated_row_count"], 2)

    def test_main_closes_persistent_pools_when_command_fails(self) -> None:
        with (
            patch("campus_ingestion_worker.collection_rename_registry_backfill.load_worker_env"),
            patch(
                "campus_ingestion_worker.collection_rename_registry_backfill.audit_registry_collection_rename_backfill",
                side_effect=RuntimeError("boom"),
            ),
            patch(
                "campus_ingestion_worker.collection_rename_registry_backfill.close_persistent_postgres_pools"
            ) as close_pools,
            self.assertRaisesRegex(RuntimeError, "boom"),
        ):
            worker.main(["audit"])

        self.assertEqual(close_pools.call_count, 1)


if __name__ == "__main__":
    unittest.main()
