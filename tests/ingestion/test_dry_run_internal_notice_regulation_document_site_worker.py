from __future__ import annotations

import importlib
import io
import json
import unittest
from dataclasses import asdict
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from campus_ingestion_core.in_memory_registries import InMemoryDocumentRegistry

from tests.ingestion.internal_notice_consumption_projection_test_support import (
    _build_runtime,
)

worker = importlib.import_module(
    "campus_ingestion_worker.dry_run_internal_notice_regulation_document_site"
)


class DryRunInternalNoticeRegulationDocumentSiteWorkerTest(unittest.TestCase):
    def test_main_materializes_selected_regulation_into_local_reader_assets(self) -> None:
        registry, inventory_store, object_store = _build_runtime()

        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            documents_path = root / "source-documents.json"
            inventory_path = root / "source-truth-inventory.json"
            object_store_root = root / "object-store"
            output_dir = root / "dry-run"

            InMemoryDocumentRegistry(
                registry.list_by_scope("campus_notices", "internal_notice"),
                backing_path=documents_path,
            )
            inventory_payload = [
                asdict(entry)
                for entry in inventory_store.list_by_scope(
                    "campus_notices",
                    "internal_notice",
                    notice_ids=("187233",),
                )
            ]
            inventory_path.write_text(
                json.dumps(inventory_payload, ensure_ascii=False),
                encoding="utf-8",
            )
            for (bucket, key), data in object_store.objects.items():
                target = object_store_root / bucket / key
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(data)

            with (
                patch(
                    "campus_ingestion_worker.dry_run_internal_notice_regulation_document_site.load_worker_env"
                ),
                patch("sys.stdout", new_callable=io.StringIO) as stdout,
            ):
                worker.main(
                    [
                        "--documents-json",
                        str(documents_path),
                        "--source-truth-inventory-json",
                        str(inventory_path),
                        "--object-store-root",
                        str(object_store_root),
                        "--output-dir",
                        str(output_dir),
                        "--notice-id",
                        "187233",
                    ]
                )

            payload = json.loads(stdout.getvalue())
            self.assertEqual(payload["selected_notice_ids"], ["187233"])
            self.assertEqual(payload["target_scope"], "regulations/institutional_rules")
            self.assertEqual(payload["query_serving_opened"], False)
            self.assertEqual(payload["rag_release_opened"], False)
            self.assertEqual(payload["materialized_document_count"], 1)
            self.assertEqual(payload["reader_document_count"], 1)
            self.assertEqual(payload["gated_entry_count"], 1)
            self.assertGreater(payload["reader_asset_count"], 0)
            self.assertTrue(Path(payload["target_object_store_root"]).exists())
            self.assertFalse(
                (object_store_root / "campus-rag-derived" / "regulations").exists(),
                "dry-run must not write materialized target assets into the input object-store",
            )
            self.assertTrue(
                (
                    Path(payload["target_object_store_root"]) / "campus-rag-derived" / "regulations"
                ).exists()
            )

            for key in (
                "consumer_admission_manifest_path",
                "gate_report_path",
                "target_document_registry_path",
                "document_reader_manifest_path",
                "document_reader_report_path",
            ):
                self.assertTrue(Path(payload[key]).exists(), key)

            reader_manifest = json.loads(
                Path(payload["document_reader_manifest_path"]).read_text(encoding="utf-8")
            )
            self.assertEqual(len(reader_manifest["documents"]), 1)
            self.assertEqual(
                reader_manifest["documentVersions"][0]["deliveryMode"],
                "gated_asset",
            )


if __name__ == "__main__":
    unittest.main()
