from __future__ import annotations

import importlib
import io
import json
import unittest
from unittest.mock import patch

from campus_ingestion_core.collection_runtime_audit import (
    CollectionRuntimeAuditReport,
    CollectionRuntimeRenameTargetAudit,
    QdrantFamilySummary,
    ReleaseFamilySummary,
)

worker = importlib.import_module("campus_ingestion_worker.audit_collection_runtime_state")


class CollectionRuntimeAuditWorkerCliTest(unittest.TestCase):
    def test_main_bootstraps_env_and_prints_report(self) -> None:
        report = CollectionRuntimeAuditReport(
            targets=(
                CollectionRuntimeRenameTargetAudit(
                    corpus="regulations",
                    legacy_collection="student_handbook",
                    canonical_collection="student_rules",
                    legacy_release_family=ReleaseFamilySummary(
                        corpus="regulations",
                        collection="student_handbook",
                        manifest_count=1,
                        release_ids=("r20260331_210128",),
                    ),
                    canonical_release_family=ReleaseFamilySummary(
                        corpus="regulations",
                        collection="student_rules",
                        manifest_count=1,
                        release_ids=("r20260419_031500",),
                    ),
                    legacy_qdrant_family=QdrantFamilySummary(
                        alias_name="student_handbook",
                        alias_target=None,
                        collection_prefix="student_handbook",
                        physical_collections=("student_handbook__r20260331_210128",),
                    ),
                    canonical_qdrant_family=QdrantFamilySummary(
                        alias_name="student_rules",
                        alias_target="student_rules__r20260419_031500",
                        collection_prefix="student_rules",
                        physical_collections=("student_rules__r20260419_031500",),
                    ),
                ),
            )
        )
        with (
            patch("campus_ingestion_worker.audit_collection_runtime_state.load_worker_env"),
            patch(
                "campus_ingestion_worker.audit_collection_runtime_state.audit_collection_runtime_state"
            ) as audit_runtime_state,
            patch("sys.stdout", new_callable=io.StringIO) as stdout,
        ):
            audit_runtime_state.return_value = report
            worker.main([])

        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["targets"][0]["canonical_collection"], "student_rules")


if __name__ == "__main__":
    unittest.main()
