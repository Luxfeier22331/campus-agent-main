from __future__ import annotations

import io
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import patch

from tests.ingestion.build_transport_schedule_projection_worker_suite_support import (
    _FakeObjectStore,
    _FakeProjectionStore,
    _FakeStructuredProjectionPublisher,
    _notice_projection_runtime,
    _write_consumer_manifest,
    _write_json,
    _write_jsonl,
    _write_transport_preview_gate,
    worker,
)


class BuildTransportScheduleProjectionWorkerTestPart03(unittest.TestCase):
    def test_main_defaults_to_preview_publish_mode(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            source_root = root / "source"
            notice_root = source_root / "authenticated_notice_portal" / "notice-1001"
            notice_root.mkdir(parents=True)
            _write_json(
                notice_root / "notice-manifest.json",
                {
                    "site_id": "muc_internal_portal",
                    "notice_id": "1001",
                    "notice_title_normalized": "校车时刻表",
                    "notice_release_time": "2026-04-20 18:00",
                },
            )
            _write_jsonl(
                notice_root / "content-blocks.jsonl",
                [
                    {
                        "text_normalized": (
                            "本时刻表自2026年4月21日起执行。"
                            "海淀校区至丰台校区工作日发车时间：06:50。"
                        )
                    }
                ],
            )
            inventory_path = root / "inventory.json"
            _write_json(
                inventory_path,
                {
                    "parents": [
                        {
                            "notice_manifest_key": "authenticated_notice_portal/notice-1001/notice-manifest.json",
                            "content_blocks_key": "authenticated_notice_portal/notice-1001/content-blocks.jsonl",
                        }
                    ]
                },
            )
            object_store = _FakeObjectStore()
            publisher = _FakeStructuredProjectionPublisher()

            with (
                patch(
                    "campus_ingestion_worker.build_transport_schedule_projection.load_worker_env"
                ),
                patch(
                    "campus_ingestion_worker.build_transport_schedule_projection.ObjectStoreSettings.from_env",
                    return_value=SimpleNamespace(
                        bucket_source="campus-rag-source",
                        bucket_derived="campus-rag-derived",
                    ),
                ),
                patch(
                    "campus_ingestion_worker.build_transport_schedule_projection.S3ObjectStoreAdmin",
                    return_value=object_store,
                ),
                patch(
                    "campus_ingestion_worker.build_transport_schedule_projection.build_structured_projection_publisher_from_env",
                    return_value=publisher,
                ),
                patch("sys.stdout", new_callable=io.StringIO),
            ):
                worker.main(
                    [
                        "--source-truth-inventory",
                        str(inventory_path),
                        "--source-truth-root",
                        str(source_root),
                        "--work-dir",
                        str(root / "work"),
                        "--release-id",
                        "transport-schedule-cli-20260424T090000",
                        "--generated-at",
                        "2026-04-24T09:00:00+08:00",
                        "--service-horizon-days",
                        "3",
                    ]
                )

        self.assertEqual(publisher.calls, [])
        self.assertNotIn(
            (
                "campus-rag-derived",
                "campus_services/releases/transport_schedule/current/campus-services-projection.json",
            ),
            object_store.objects,
        )

    def test_main_publishes_release_to_structured_projection_postgres_when_explicitly_promoted(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            source_root = root / "source"
            notice_root = source_root / "authenticated_notice_portal" / "notice-1001"
            notice_root.mkdir(parents=True)
            _write_json(
                notice_root / "notice-manifest.json",
                {
                    "site_id": "muc_internal_portal",
                    "notice_id": "1001",
                    "notice_title_normalized": "校车时刻表",
                    "notice_release_time": "2026-04-20 18:00",
                },
            )
            _write_jsonl(
                notice_root / "content-blocks.jsonl",
                [
                    {
                        "text_normalized": (
                            "本时刻表自2026年4月21日起执行。"
                            "海淀校区至丰台校区工作日发车时间：06:50。"
                        )
                    }
                ],
            )
            inventory_path = root / "inventory.json"
            _write_json(
                inventory_path,
                {
                    "parents": [
                        {
                            "notice_manifest_key": "authenticated_notice_portal/notice-1001/notice-manifest.json",
                            "content_blocks_key": "authenticated_notice_portal/notice-1001/content-blocks.jsonl",
                        }
                    ]
                },
            )
            object_store = _FakeObjectStore()
            publisher = _FakeStructuredProjectionPublisher()

            with (
                patch(
                    "campus_ingestion_worker.build_transport_schedule_projection.load_worker_env"
                ),
                patch(
                    "campus_ingestion_worker.build_transport_schedule_projection.ObjectStoreSettings.from_env",
                    return_value=SimpleNamespace(
                        bucket_source="campus-rag-source",
                        bucket_derived="campus-rag-derived",
                    ),
                ),
                patch(
                    "campus_ingestion_worker.build_transport_schedule_projection.S3ObjectStoreAdmin",
                    return_value=object_store,
                ),
                patch(
                    "campus_ingestion_worker.build_transport_schedule_projection.build_structured_projection_publisher_from_env",
                    return_value=publisher,
                ),
                patch("sys.stdout", new_callable=io.StringIO),
            ):
                worker.main(
                    [
                        "--source-truth-inventory",
                        str(inventory_path),
                        "--source-truth-root",
                        str(source_root),
                        "--work-dir",
                        str(root / "work"),
                        "--release-id",
                        "transport-schedule-cli-20260424T090000",
                        "--generated-at",
                        "2026-04-24T09:00:00+08:00",
                        "--service-horizon-days",
                        "3",
                        "--publish-mode",
                        "promote",
                    ]
                )

        self.assertEqual(len(publisher.calls), 1)
        self.assertEqual(publisher.calls[0]["collection"], "transport_schedule")

    def test_main_can_preview_from_all_ready_transport_candidates(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            manifest_path = root / "consumer-admission-manifest.json"
            preview_gate_path = root / "transport-preview-gate.json"
            _write_consumer_manifest(manifest_path)
            _write_transport_preview_gate(preview_gate_path, selected_notice_ids=("355122",))
            object_store = _FakeObjectStore()
            publisher = _FakeStructuredProjectionPublisher()
            registry, projection_entry = _notice_projection_runtime(object_store)
            projection_store = _FakeProjectionStore((projection_entry,))

            with (
                patch(
                    "campus_ingestion_worker.build_transport_schedule_projection.load_worker_env"
                ),
                patch(
                    "campus_ingestion_worker.build_transport_schedule_projection.ObjectStoreSettings.from_env",
                    return_value=SimpleNamespace(
                        bucket_source="campus-rag-source",
                        bucket_derived="campus-rag-derived",
                    ),
                ),
                patch(
                    "campus_ingestion_worker.build_transport_schedule_projection.S3ObjectStoreAdmin",
                    return_value=object_store,
                ),
                patch(
                    "campus_ingestion_worker.build_transport_schedule_projection.build_document_registry_from_env",
                    return_value=registry,
                ),
                patch(
                    "campus_ingestion_worker.build_transport_schedule_projection.build_notice_consumption_projection_store_from_env",
                    return_value=projection_store,
                ),
                patch(
                    "campus_ingestion_worker.build_transport_schedule_projection.build_structured_projection_publisher_from_env",
                    return_value=publisher,
                ),
                patch("sys.stdout", new_callable=io.StringIO),
            ):
                worker.main(
                    [
                        "--from-consumption-projection",
                        "--all-ready-transport-candidates",
                        "--consumer-admission-manifest-path",
                        str(manifest_path),
                        "--publish-mode",
                        "preview",
                        "--work-dir",
                        str(root / "work"),
                        "--release-id",
                        "transport-schedule-cli-all-ready-preview",
                        "--generated-at",
                        "2026-03-20T09:00:00+08:00",
                        "--service-horizon-days",
                        "3",
                    ]
                )

        self.assertEqual(projection_store.list_notice_ids, ())
        self.assertEqual(publisher.calls, [])

    def test_main_blocks_all_ready_transport_candidates_for_stage_without_override(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            manifest_path = root / "consumer-admission-manifest.json"
            _write_consumer_manifest(manifest_path)
            object_store = _FakeObjectStore()
            publisher = _FakeStructuredProjectionPublisher()
            registry, projection_entry = _notice_projection_runtime(object_store)
            projection_store = _FakeProjectionStore((projection_entry,))

            with (
                patch(
                    "campus_ingestion_worker.build_transport_schedule_projection.load_worker_env"
                ),
                patch(
                    "campus_ingestion_worker.build_transport_schedule_projection.ObjectStoreSettings.from_env",
                    return_value=SimpleNamespace(
                        bucket_source="campus-rag-source",
                        bucket_derived="campus-rag-derived",
                    ),
                ),
                patch(
                    "campus_ingestion_worker.build_transport_schedule_projection.S3ObjectStoreAdmin",
                    return_value=object_store,
                ),
                patch(
                    "campus_ingestion_worker.build_transport_schedule_projection.build_document_registry_from_env",
                    return_value=registry,
                ),
                patch(
                    "campus_ingestion_worker.build_transport_schedule_projection.build_notice_consumption_projection_store_from_env",
                    return_value=projection_store,
                ),
                patch(
                    "campus_ingestion_worker.build_transport_schedule_projection.build_structured_projection_publisher_from_env",
                    return_value=publisher,
                ),
                patch("sys.stdout", new_callable=io.StringIO),
                self.assertRaisesRegex(ValueError, "all-ready transport candidates"),
            ):
                worker.main(
                    [
                        "--from-consumption-projection",
                        "--all-ready-transport-candidates",
                        "--consumer-admission-manifest-path",
                        str(manifest_path),
                        "--publish-mode",
                        "stage",
                        "--work-dir",
                        str(root / "work"),
                        "--release-id",
                        "transport-schedule-cli-all-ready-stage",
                        "--generated-at",
                        "2026-03-20T09:00:00+08:00",
                        "--service-horizon-days",
                        "3",
                    ]
                )

        self.assertEqual(publisher.calls, [])

    def test_main_allows_all_ready_stage_with_explicit_multi_notice_override(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            manifest_path = root / "consumer-admission-manifest.json"
            preview_gate_path = root / "transport-preview-gate.json"
            _write_consumer_manifest(manifest_path)
            _write_transport_preview_gate(preview_gate_path, selected_notice_ids=("355122",))
            object_store = _FakeObjectStore()
            publisher = _FakeStructuredProjectionPublisher()
            registry, projection_entry = _notice_projection_runtime(object_store)
            projection_store = _FakeProjectionStore((projection_entry,))

            with (
                patch(
                    "campus_ingestion_worker.build_transport_schedule_projection.load_worker_env"
                ),
                patch(
                    "campus_ingestion_worker.build_transport_schedule_projection.ObjectStoreSettings.from_env",
                    return_value=SimpleNamespace(
                        bucket_source="campus-rag-source",
                        bucket_derived="campus-rag-derived",
                    ),
                ),
                patch(
                    "campus_ingestion_worker.build_transport_schedule_projection.S3ObjectStoreAdmin",
                    return_value=object_store,
                ),
                patch(
                    "campus_ingestion_worker.build_transport_schedule_projection.build_document_registry_from_env",
                    return_value=registry,
                ),
                patch(
                    "campus_ingestion_worker.build_transport_schedule_projection.build_notice_consumption_projection_store_from_env",
                    return_value=projection_store,
                ),
                patch(
                    "campus_ingestion_worker.build_transport_schedule_projection.build_structured_projection_publisher_from_env",
                    return_value=publisher,
                ),
                patch("sys.stdout", new_callable=io.StringIO),
            ):
                worker.main(
                    [
                        "--from-consumption-projection",
                        "--all-ready-transport-candidates",
                        "--allow-multi-notice-release",
                        "--consumer-admission-manifest-path",
                        str(manifest_path),
                        "--transport-preview-gate-report-path",
                        str(preview_gate_path),
                        "--publish-mode",
                        "stage",
                        "--work-dir",
                        str(root / "work"),
                        "--release-id",
                        "transport-schedule-cli-all-ready-stage",
                        "--generated-at",
                        "2026-03-20T09:00:00+08:00",
                        "--service-horizon-days",
                        "3",
                    ]
                )

        self.assertEqual(projection_store.list_notice_ids, ())
        self.assertEqual(len(publisher.calls), 1)
        self.assertFalse(publisher.calls[0]["promote_current"])
        bundle = publisher.calls[0]["bundle"]
        self.assertEqual(len(bundle["transport_schedule_snapshots"]), 1)  # type: ignore[index]
