from __future__ import annotations

import importlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

worker = importlib.import_module(
    "campus_ingestion_worker.build_internal_notice_consumer_admission_manifest"
)


class BuildInternalNoticeConsumerAdmissionManifestWorkerCliTest(unittest.TestCase):
    def test_main_builds_manifest_from_bundle_records(self) -> None:
        bundle = [
            {
                "notice_id": "354192",
                "notice": {
                    "notice_id": "354192",
                    "notice_title": "关于2025-2026学年第二学期本科生网上选课的通知",
                    "notice_content": "",
                    "categories": [
                        {"notice_type": "6", "notice_type_name": "教学通知"},
                    ],
                },
                "notice_attachments": [],
                "attachments": [],
            }
        ]
        with tempfile.TemporaryDirectory() as temp_dir:
            bundle_path = Path(temp_dir) / "bundle.json"
            output_path = Path(temp_dir) / "consumer-admission-manifest.json"
            bundle_path.write_text(json.dumps(bundle), encoding="utf-8")

            with (
                patch(
                    "campus_ingestion_worker.build_internal_notice_consumer_admission_manifest.load_worker_env"
                ),
                patch("sys.stdout", new_callable=io.StringIO) as stdout,
            ):
                worker.main(
                    [
                        "--bundle-path",
                        str(bundle_path),
                        "--output-path",
                        str(output_path),
                        "--admission-run-id",
                        "consumer-admission-test",
                        "--selection-path",
                        str(bundle_path),
                        "--site-id",
                        "muc_internal_portal",
                    ]
                )

            payload = json.loads(stdout.getvalue())
            self.assertEqual(payload["selected_notice_ids"], ["354192"])
            self.assertEqual(payload["decision_records"][0]["target_surface"], "notice_level_query")
            self.assertEqual(json.loads(output_path.read_text())["selected_notice_ids"], ["354192"])


if __name__ == "__main__":
    unittest.main()
