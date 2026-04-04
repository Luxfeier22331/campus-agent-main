from __future__ import annotations

import importlib
import io
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import Mock, patch

from campus_ingestion_core.authenticated_notice_closeout import (
    AuthenticatedNoticeCloseoutService,
    CloseoutPlanner,
    InMemoryCloseoutStore,
)
from campus_ingestion_core.settings import ObjectStoreSettings
from tests.ingestion.test_authenticated_notice_import import (
    _FakeObjectStore,
    _sample_export_manifest,
    _sample_notice_bundle,
    _write_json,
)
from tests.support.in_memory_registry import InMemoryDocumentRegistry, InMemoryRawAssetRegistry

plan_worker = importlib.import_module(
    "campus_ingestion_worker.plan_authenticated_notice_closeout"
)
run_worker = importlib.import_module(
    "campus_ingestion_worker.run_authenticated_notice_closeout_worker"
)
show_worker = importlib.import_module("campus_ingestion_worker.show_authenticated_notice_closeout")
promote_worker = importlib.import_module(
    "campus_ingestion_worker.promote_authenticated_notice_closeout"
)
watch_worker = importlib.import_module("campus_ingestion_worker.watch_authenticated_notice_closeout")


class AuthenticatedNoticeCloseoutWorkerCliTest(unittest.TestCase):
    def test_plan_worker_show_and_promote_cli_round_trip(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            bundle_path = root / "bundle.json"
            manifest_path = root / "manifest.json"
            bundle = _sample_notice_bundle() * 2
            bundle[1] = json.loads(json.dumps(bundle[1], ensure_ascii=False))
            bundle[1]["notice_id"] = 355120
            bundle[1]["notice"]["notice_id"] = 355120
            bundle[1]["notice"]["notice_title"] = "第二条测试通知"
            bundle[1]["notice"]["notice_link"] = "https://portal.example.edu/notice/355120"
            bundle[1]["links"][0]["notice_id"] = 355120
            bundle[1]["links"][0]["url"] = "https://portal.example.edu/files/355120.docx"
            bundle[1]["links"][0]["final_url"] = "https://portal.example.edu/files/355120.docx"
            bundle[1]["notice_attachments"][0]["notice_id"] = 355120
            bundle[1]["attachments"][0]["attachment_id"] = 355120
            bundle[1]["attachments"][0]["source_url"] = "https://portal.example.edu/files/355120.docx"
            bundle[1]["attachments"][0]["normalized_source_url"] = (
                "https://portal.example.edu/files/355120.docx"
            )
            bundle[1]["attachments"][0]["final_url"] = "https://portal.example.edu/files/355120.docx"
            bundle[1]["attachments"][0]["original_filename"] = "355120.docx"
            bundle[1]["attachments"][0]["object_key"] = "objects/355120.docx"
            _write_json(bundle_path, bundle)
            _write_json(manifest_path, _sample_export_manifest())
            service = AuthenticatedNoticeCloseoutService(
                closeout_store=InMemoryCloseoutStore(),
                object_store=_FakeObjectStore(),
                object_store_settings=ObjectStoreSettings(
                    endpoint="http://localhost:9000",
                    access_key="minioadmin",
                    secret_key="minioadmin",
                ),
                document_registry=InMemoryDocumentRegistry(
                    backing_path=root / "registry" / "documents.json"
                ),
                raw_asset_registry=InMemoryRawAssetRegistry(
                    backing_path=root / "registry" / "raw-assets.json"
                ),
                planner=CloseoutPlanner(shard_size=1, batch_size=1, max_shards=4),
            )

            with (
                patch("campus_ingestion_worker.plan_authenticated_notice_closeout.load_worker_env"),
                patch(
                    "campus_ingestion_worker.plan_authenticated_notice_closeout.AuthenticatedNoticeCloseoutService.from_env",
                    return_value=service,
                ),
                patch("sys.stdout", new_callable=io.StringIO) as stdout,
            ):
                plan_worker.main(
                    [
                        "--bundle-path",
                        str(bundle_path),
                        "--manifest-path",
                        str(manifest_path),
                        "--site-id",
                        "muc_internal_portal",
                        "--source-home-url",
                        "https://portal.example.edu/home",
                        "--run-id",
                        "run-1",
                        "--shard-size",
                        "1",
                        "--batch-size",
                        "1",
                        "--max-concurrency",
                        "2",
                        "--notice-concurrency",
                        "4",
                        "--object-store-concurrency",
                        "8",
                        "--lease-seconds",
                        "120",
                    ]
                )

            plan_payload = json.loads(stdout.getvalue())
            self.assertEqual(plan_payload["state"], "planned")
            self.assertEqual(plan_payload["completed_batch_count"], 0)

            with (
                patch(
                    "campus_ingestion_worker.run_authenticated_notice_closeout_worker.load_worker_env"
                ),
                patch(
                    "campus_ingestion_worker.run_authenticated_notice_closeout_worker.AuthenticatedNoticeCloseoutService.from_env",
                    return_value=service,
                ),
                patch("sys.stdout", new_callable=io.StringIO) as stdout,
            ):
                run_worker.main(["--run-id", "run-1", "--worker-id", "worker-a"])

            worker_payload = json.loads(stdout.getvalue())
            self.assertEqual(worker_payload["state"], "verified")
            self.assertEqual(worker_payload["completed_batch_count"], 2)

            with (
                patch("campus_ingestion_worker.show_authenticated_notice_closeout.load_worker_env"),
                patch(
                    "campus_ingestion_worker.show_authenticated_notice_closeout.AuthenticatedNoticeCloseoutService.from_env",
                    return_value=service,
                ),
                patch("sys.stdout", new_callable=io.StringIO) as stdout,
            ):
                show_worker.main(["--run-id", "run-1"])

            show_payload = json.loads(stdout.getvalue())
            self.assertEqual(show_payload["run_id"], "run-1")
            self.assertEqual(show_payload["state"], "verified")
            self.assertEqual(show_payload["completed_batch_count"], 2)

            with (
                patch(
                    "campus_ingestion_worker.promote_authenticated_notice_closeout.load_worker_env"
                ),
                patch(
                    "campus_ingestion_worker.promote_authenticated_notice_closeout.AuthenticatedNoticeCloseoutService.from_env",
                    return_value=service,
                ),
                patch("sys.stdout", new_callable=io.StringIO) as stdout,
            ):
                promote_worker.main(["--run-id", "run-1"])

            promote_payload = json.loads(stdout.getvalue())
            self.assertEqual(promote_payload["state"], "done")
            self.assertEqual(promote_payload["replaced_scope_record_count"], 2)

    def test_watch_cli_streams_multiple_snapshots(self) -> None:
        service = Mock()
        service.show_run.side_effect = [
            {
                "run_id": "run-1",
                "state": "planned",
                "batch_count": 2,
                "completed_batch_count": 0,
            },
            {
                "run_id": "run-1",
                "state": "verified",
                "batch_count": 2,
                "completed_batch_count": 2,
            },
        ]

        with (
            patch("campus_ingestion_worker.watch_authenticated_notice_closeout.load_worker_env"),
            patch(
                "campus_ingestion_worker.watch_authenticated_notice_closeout.AuthenticatedNoticeCloseoutService.from_env",
                return_value=service,
            ),
            patch("campus_ingestion_worker.watch_authenticated_notice_closeout.time.sleep"),
            patch("sys.stdout", new_callable=io.StringIO) as stdout,
        ):
            watch_worker.main(["--run-id", "run-1", "--interval", "0", "--iterations", "2"])

        rendered = [
            json.loads(line)
            for line in stdout.getvalue().splitlines()
            if line.strip()
        ]
        self.assertEqual([item["state"] for item in rendered], ["planned", "verified"])


if __name__ == "__main__":
    unittest.main()
