from __future__ import annotations

import importlib
import io
import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from campus_ingestion_core.authenticated_notice_file_release_inventory import (
    InMemoryAuthenticatedNoticeFileReleaseInventoryStore,
)
from campus_ingestion_core.authenticated_notice_source_truth_inventory import (
    InMemoryAuthenticatedNoticeSourceTruthInventoryStore,
)
from campus_ingestion_core.settings import ObjectStoreSettings

from tests.ingestion.authenticated_notice_import_test_support import _FakeObjectStore

worker = importlib.import_module(
    "campus_ingestion_worker.audit_authenticated_notice_object_locators"
)


class AuditAuthenticatedNoticeObjectLocatorsWorkerTest(unittest.TestCase):
    def test_main_writes_audit_report_without_mutating_object_store(self) -> None:
        object_store = _FakeObjectStore()
        settings = ObjectStoreSettings(
            endpoint="http://localhost:9000",
            access_key="minioadmin",
            secret_key="minioadmin",
            bucket_source="campus-rag-source",
            bucket_derived="campus-rag-derived",
        )
        with TemporaryDirectory() as temp_dir:
            output_path = Path(temp_dir) / "object-locator-audit.json"
            with (
                patch(
                    "campus_ingestion_worker.audit_authenticated_notice_object_locators.load_worker_env"
                ),
                patch(
                    "campus_ingestion_worker.audit_authenticated_notice_object_locators.ObjectStoreSettings.from_env",
                    return_value=settings,
                ),
                patch(
                    "campus_ingestion_worker.audit_authenticated_notice_object_locators.S3ObjectStoreAdmin",
                    return_value=object_store,
                ),
                patch(
                    "campus_ingestion_worker.audit_authenticated_notice_object_locators.build_authenticated_notice_source_truth_inventory_store_from_env",
                    return_value=InMemoryAuthenticatedNoticeSourceTruthInventoryStore(),
                ),
                patch(
                    "campus_ingestion_worker.audit_authenticated_notice_object_locators.build_authenticated_notice_file_release_inventory_store_from_env",
                    return_value=InMemoryAuthenticatedNoticeFileReleaseInventoryStore(),
                ),
                patch("sys.stdout", new_callable=io.StringIO) as stdout,
            ):
                worker.main(["--output-path", str(output_path)])

            payload = json.loads(stdout.getvalue())
            persisted = json.loads(output_path.read_text(encoding="utf-8"))

        self.assertEqual(payload["output_path"], str(output_path))
        self.assertEqual(persisted["write_performed"], False)
        self.assertEqual(object_store.uploads, [])


if __name__ == "__main__":
    unittest.main()
