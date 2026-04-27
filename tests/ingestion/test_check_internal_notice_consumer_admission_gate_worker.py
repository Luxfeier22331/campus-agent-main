from __future__ import annotations

import importlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from campus_ingestion_core.authenticated_notice_notice_family import (
    load_authenticated_notice_notice_family_config,
)
from campus_ingestion_core.internal_notice_consumer_admission_builder import (
    build_internal_notice_consumer_admission_manifest_from_bundle_records,
)
from campus_ingestion_core.internal_notice_consumer_admission_manifest import (
    write_internal_notice_consumer_admission_manifest,
)

worker = importlib.import_module(
    "campus_ingestion_worker.check_internal_notice_consumer_admission_gate"
)


class CheckInternalNoticeConsumerAdmissionGateWorkerCliTest(unittest.TestCase):
    def test_main_checks_manifest_gate_for_read_model_rebuild(self) -> None:
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
            manifest_path = Path(temp_dir) / "consumer-admission-manifest.json"
            _write_manifest(manifest_path, bundle)

            with (
                patch(
                    "campus_ingestion_worker.check_internal_notice_consumer_admission_gate.load_worker_env"
                ),
                patch("sys.stdout", new_callable=io.StringIO) as stdout,
            ):
                worker.main(
                    [
                        "--manifest-path",
                        str(manifest_path),
                        "--operation",
                        "read-model-rebuild",
                        "--notice-id",
                        "354192",
                    ]
                )

            payload = json.loads(stdout.getvalue())
            self.assertEqual(payload["verdict"], "allow")
            self.assertEqual(payload["selected_notice_ids"], ["354192"])

    def test_main_exits_nonzero_when_manifest_gate_blocks(self) -> None:
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
            manifest_path = Path(temp_dir) / "consumer-admission-manifest.json"
            _write_manifest(manifest_path, bundle)

            with (
                patch(
                    "campus_ingestion_worker.check_internal_notice_consumer_admission_gate.load_worker_env"
                ),
                patch("sys.stdout", new_callable=io.StringIO) as stdout,
                self.assertRaises(SystemExit) as raised,
            ):
                worker.main(
                    [
                        "--manifest-path",
                        str(manifest_path),
                        "--operation",
                        "read-model-rebuild",
                        "--notice-id",
                        "missing-notice",
                    ]
                )

            self.assertEqual(raised.exception.code, 1)
            payload = json.loads(stdout.getvalue())
            self.assertEqual(payload["verdict"], "block")
            self.assertIn("id_mismatch", payload["reason_codes"])


def _write_manifest(path: Path, bundle: list[dict[str, object]]) -> None:
    config = load_authenticated_notice_notice_family_config(
        Path(
            "configs/ingestion/campus_notices/internal_notice/notice-family-classification.v1.json"
        )
    )
    manifest = build_internal_notice_consumer_admission_manifest_from_bundle_records(
        bundle_records=bundle,
        config=config,
        admission_run_id="consumer-admission-test",
        selection_source="bundle_dry_run",
        selection_path="bundle.json",
        site_id="muc_internal_portal",
        created_at="2026-04-27T00:00:00+00:00",
    )
    write_internal_notice_consumer_admission_manifest(path, manifest)


if __name__ == "__main__":
    unittest.main()
