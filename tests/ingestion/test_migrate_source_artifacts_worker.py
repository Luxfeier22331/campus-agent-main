from __future__ import annotations

import importlib
import io
import json
import unittest
from unittest.mock import patch

from campus_ingestion_core import SourceArtifactsMigrationReport

migration_worker = importlib.import_module(
    "campus_ingestion_worker.migrate_source_artifacts_to_canonical_source_bucket"
)


class MigrateSourceArtifactsWorkerCliTest(unittest.TestCase):
    def test_main_builds_typed_request_from_cli_args(self) -> None:
        with (
            patch("campus_ingestion_worker.migrate_source_artifacts_to_canonical_source_bucket.load_worker_env"),
            patch(
                "campus_ingestion_worker.migrate_source_artifacts_to_canonical_source_bucket."
                "migrate_source_artifacts_to_canonical_source_bucket"
            ) as migrate,
            patch("sys.stdout", new_callable=io.StringIO) as stdout,
        ):
            migrate.return_value = SourceArtifactsMigrationReport(
                corpus="curriculum",
                collection="curriculum_plan",
                raw_asset_id="asset:curriculum-plan-2022",
                raw_version_id="sha256:test-001",
                source_provider_response_bucket="campus-rag-derived",
                source_provider_response_key="curriculum/sources/.../provider-response.jsonl",
                canonical_provider_response_bucket="campus-rag-source",
                canonical_provider_response_key="ocr/pdf_ocr/curriculum-plan/2022/sha256/test-001/provider-response.jsonl",
                source_layout_elements_bucket="campus-rag-derived",
                source_layout_elements_key="curriculum/sources/.../layout-elements.jsonl",
                canonical_layout_elements_bucket="campus-rag-source",
                canonical_layout_elements_key="source-truth/pdf_ocr/curriculum-plan/2022/sha256/test-001/layout-elements.jsonl",
                provider_response_migrated=True,
                layout_elements_migrated=True,
                updated_document_record_count=2,
            )
            migration_worker.main(
                [
                    "--corpus",
                    "curriculum",
                    "--collection",
                    "curriculum_plan",
                    "--raw-version-id",
                    "sha256:test-001",
                    "--raw-asset-id",
                    "asset:curriculum-plan-2022",
                    "--year",
                    "2022",
                ]
            )

        request = migrate.call_args.kwargs["request"]
        self.assertEqual(request.corpus, "curriculum")
        self.assertEqual(request.collection, "curriculum_plan")
        self.assertEqual(request.raw_version_id, "sha256:test-001")
        self.assertEqual(request.raw_asset_id, "asset:curriculum-plan-2022")
        self.assertEqual(request.year, "2022")
        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["canonical_provider_response_bucket"], "campus-rag-source")


if __name__ == "__main__":
    unittest.main()
