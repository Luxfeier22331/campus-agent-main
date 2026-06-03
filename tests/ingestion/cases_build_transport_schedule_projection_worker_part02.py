from __future__ import annotations

import io
import unittest
from dataclasses import replace
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
    worker,
)


class BuildTransportScheduleProjectionWorkerTestPart02(unittest.TestCase):
    def test_release_scope_blocks_multiple_notice_ids_for_stage_without_override(self) -> None:
        object_store = _FakeObjectStore()
        _, projection_entry = _notice_projection_runtime(object_store)
        second_notice = replace(
            projection_entry,
            source_notice_id="355123",
            source_notice_document_id="notice:muc_internal_portal:355123",
            source_document_id="notice:muc_internal_portal:355123",
        )

        with self.assertRaisesRegex(ValueError, "exactly one selected notice id"):
            worker._assert_transport_release_scope_allows(
                publish_mode="stage",
                projection_entries=(projection_entry, second_notice),
                selected_notice_ids=("355122", "355123"),
                all_ready_transport_candidates=False,
                allow_multi_notice_release=False,
            )

        worker._assert_transport_release_scope_allows(
            publish_mode="preview",
            projection_entries=(projection_entry, second_notice),
            selected_notice_ids=("355122", "355123"),
            all_ready_transport_candidates=False,
            allow_multi_notice_release=False,
        )

    def test_main_requires_consumer_admission_manifest_for_typed_materialization(
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
                self.assertRaisesRegex(ValueError, "consumer admission manifest"),
            ):
                worker.main(
                    [
                        "--from-consumption-projection",
                        "--notice-id",
                        "355122",
                        "--publish-mode",
                        "preview",
                        "--work-dir",
                        str(root / "work"),
                        "--release-id",
                        "transport-schedule-cli-355122-preview",
                        "--generated-at",
                        "2026-03-20T09:00:00+08:00",
                        "--service-horizon-days",
                        "3",
                    ]
                )

    def test_main_accepts_consumer_admission_manifest_for_typed_materialization(
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
            ):
                worker.main(
                    [
                        "--from-consumption-projection",
                        "--notice-id",
                        "355122",
                        "--consumer-admission-manifest-path",
                        str(manifest_path),
                        "--publish-mode",
                        "preview",
                        "--work-dir",
                        str(root / "work"),
                        "--release-id",
                        "transport-schedule-cli-355122-preview",
                        "--generated-at",
                        "2026-03-20T09:00:00+08:00",
                        "--service-horizon-days",
                        "3",
                    ]
                )

        self.assertEqual(publisher.calls, [])

    def test_main_blocks_stage_without_transport_preview_gate(self) -> None:
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
                self.assertRaisesRegex(ValueError, "transport preview gate"),
            ):
                worker.main(
                    [
                        "--from-consumption-projection",
                        "--notice-id",
                        "355122",
                        "--consumer-admission-manifest-path",
                        str(manifest_path),
                        "--publish-mode",
                        "stage",
                        "--work-dir",
                        str(root / "work"),
                        "--release-id",
                        "transport-schedule-cli-355122-stage",
                        "--generated-at",
                        "2026-03-20T09:00:00+08:00",
                        "--service-horizon-days",
                        "3",
                    ]
                )

        self.assertEqual(publisher.calls, [])

    def test_release_gate_blocks_historical_notice_becoming_current_snapshot(self) -> None:
        preview_gate = {
            "schema_version": "schedule_transport_preview_gate.v1",
            "validation_valid": True,
            "buckets": {
                "preview_passed": ["245272"],
                "preview_failed": [],
            },
            "release_write_buckets": {
                "current_serving_write": ["354578"],
                "historical_snapshot_only_write": ["245272"],
                "operational_exception_write": [],
                "preview_failed_skip": [],
            },
        }
        bundle = {
            "transport_schedule_snapshots": [
                {
                    "snapshot_id": "snapshot:transport-schedule:2024-08-30:245272",
                    "source_ref": "notice:muc_internal_portal:245272",
                    "is_current": True,
                    "schedule_scope": "baseline_revision",
                    "service_date_ranges": [],
                }
            ],
            "scheduled_departures": [
                {
                    "snapshot_id": "snapshot:transport-schedule:2024-08-30:245272",
                    "related_notice_refs": ["notice:muc_internal_portal:245272"],
                }
            ],
            "transport_service_exceptions": [],
            "transport_operational_notices": [],
        }

        with self.assertRaisesRegex(ValueError, "historical_snapshot_only_write"):
            worker._assert_transport_bundle_matches_preview_gate_report(
                publish_mode="stage",
                bundle=bundle,
                preview_gate_report=preview_gate,
                selected_notice_ids=("245272",),
            )
