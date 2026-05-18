from __future__ import annotations

import importlib
import io
import json
import tempfile
import unittest
from dataclasses import dataclass
from pathlib import Path
from unittest.mock import patch

worker = importlib.import_module(
    "campus_ingestion_worker.build_internal_notice_consumer_admission_manifest"
)


@dataclass(frozen=True)
class _RunRefs:
    run_id: str = "collector-run-001"
    source_surface: str = "notice"
    source_bucket: str = "source-bucket"
    bundle_object_key: str = "runs/collector-run-001/notices-bundle.json"
    manifest_object_key: str = "runs/collector-run-001/export-manifest.json"
    bundle_content_sha256: str = "a" * 64
    bundle_byte_size: int = 123
    manifest_content_sha256: str = "b" * 64
    manifest_byte_size: int = 45


@dataclass(frozen=True)
class _LoadedPayload:
    bundle_records: tuple[dict[str, object], ...]
    export_manifest: dict[str, object]


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

    def test_main_builds_manifest_from_verified_collector_run_refs(self) -> None:
        bundle_records = (
            {
                "notice_id": "355867",
                "notice": {
                    "notice_id": "355867",
                    "notice_title": "关于4月27日-5月5日期间两校区班车及地铁接驳车安排的通知",
                    "notice_content": "",
                    "categories": [
                        {"notice_type": "5", "notice_type_name": "办公通知"},
                    ],
                },
                "notice_attachments": [],
                "attachments": [],
            },
            {
                "notice_id": "ignored",
                "notice": {
                    "notice_id": "ignored",
                    "notice_title": "普通通知",
                    "notice_content": "",
                    "categories": [],
                },
                "notice_attachments": [],
                "attachments": [],
            },
        )
        with tempfile.TemporaryDirectory() as temp_dir:
            output_path = Path(temp_dir) / "consumer-admission-manifest.json"

            with (
                patch(
                    "campus_ingestion_worker.build_internal_notice_consumer_admission_manifest.load_worker_env"
                ),
                patch(
                    "campus_ingestion_worker.build_internal_notice_consumer_admission_manifest."
                    "resolve_authenticated_notice_collector_run_refs",
                    return_value=_RunRefs(),
                ) as resolve_refs,
                patch(
                    "campus_ingestion_worker.build_internal_notice_consumer_admission_manifest."
                    "build_object_store_from_env",
                    return_value=object(),
                ),
                patch(
                    "campus_ingestion_worker.build_internal_notice_consumer_admission_manifest."
                    "load_authenticated_notice_import_payload_from_object_refs",
                    return_value=_LoadedPayload(
                        bundle_records=bundle_records,
                        export_manifest={"run_id": "collector-run-001"},
                    ),
                ),
                patch("sys.stdout", new_callable=io.StringIO) as stdout,
            ):
                worker.main(
                    [
                        "--collector-run-id",
                        "collector-run-001",
                        "--source-surface",
                        "notice",
                        "--notice-id",
                        "355867",
                        "--output-path",
                        str(output_path),
                        "--admission-run-id",
                        "consumer-admission-collector-run-001",
                        "--site-id",
                        "muc_internal_portal",
                    ]
                )

            payload = json.loads(stdout.getvalue())
            resolve_refs.assert_called_once()
            self.assertEqual(payload["selected_notice_ids"], ["355867"])
            self.assertEqual(payload["selection_source"], "collector_run_object_store")
            self.assertEqual(payload["selection_path"], "collector-run-001")
            self.assertEqual(
                json.loads(output_path.read_text(encoding="utf-8"))["selected_notice_ids"],
                ["355867"],
            )


if __name__ == "__main__":
    unittest.main()
