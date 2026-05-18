from __future__ import annotations

import importlib
import io
import json
import unittest
from dataclasses import replace
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import patch

from campus_ingestion_core.notice_consumption_projection import (
    NoticeConsumptionProjectionEntry,
)

from tests.ingestion.build_transport_schedule_projection_worker_support import (
    _notice_projection_runtime,
    _write_consumer_manifest,
    _write_json,
    _write_jsonl,
    _write_transport_preview_gate,
)

worker = importlib.import_module("campus_ingestion_worker.build_transport_schedule_projection")


class _FakeObjectStore:
    def __init__(self) -> None:
        self.objects: dict[tuple[str, str], bytes] = {}

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        return self.objects[(bucket, key)]

    def put_bytes(
        self,
        *,
        bucket: str,
        key: str,
        data: bytes,
        content_type: str,
    ) -> None:
        self.objects[(bucket, key)] = data


class _FakeStructuredProjectionPublisher:
    def __init__(self) -> None:
        self.calls: list[dict[str, object]] = []

    def publish_release(self, **kwargs: object) -> object:
        self.calls.append(dict(kwargs))
        return {"current": kwargs.get("promote_current", True)}


class _FakeProjectionStore:
    def __init__(self, entries: tuple[NoticeConsumptionProjectionEntry, ...]) -> None:
        self.entries = entries
        self.list_notice_ids: tuple[str, ...] | None = None

    def list_by_scope(
        self,
        source_corpus: str,
        source_collection: str,
        *,
        notice_ids: tuple[str, ...] = (),
    ) -> tuple[NoticeConsumptionProjectionEntry, ...]:
        self.list_notice_ids = tuple(notice_ids)
        return self.entries


class BuildTransportScheduleProjectionWorkerTest(unittest.TestCase):
    def test_worker_builds_projection_release_from_local_notice_source_truth_inventory(
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

            report = worker.build_transport_schedule_projection_release_from_inventory(
                source_truth_inventory_path=inventory_path,
                source_truth_root=source_root,
                work_dir=root / "work",
                release_id="transport-schedule-20260424T090000",
                generated_at="2026-04-24T09:00:00+08:00",
                service_horizon_days=3,
                object_store=object_store,
                derived_bucket="campus-rag-derived",
                structured_projection_publisher=publisher,
                publish_mode="promote",
            )

        self.assertEqual(report.release_id, "transport-schedule-20260424T090000")
        self.assertEqual(len(publisher.calls), 1)
        publish_call = publisher.calls[0]
        self.assertEqual(publish_call["corpus"], "campus_services")
        self.assertEqual(publish_call["collection"], "transport_schedule")
        self.assertEqual(publish_call["release_id"], "transport-schedule-20260424T090000")
        self.assertEqual(publish_call["schema_version"], "campus_services_projection_bundle.v1")
        self.assertEqual(publish_call["validation_status"], "valid")
        self.assertEqual(publish_call["artifact_object_key"], report.release_object_key)
        self.assertTrue(str(publish_call["artifact_checksum"]).startswith("sha256:"))
        self.assertEqual(
            len(publish_call["bundle"]["transport_schedule_snapshots"]),  # type: ignore[index]
            1,
        )
        current_payload = json.loads(
            object_store.objects[
                (
                    "campus-rag-derived",
                    "campus_services/releases/transport_schedule/current/campus-services-projection.json",
                )
            ].decode("utf-8")
        )
        self.assertEqual(len(current_payload["transport_schedule_snapshots"]), 1)
        self.assertEqual(current_payload["scheduled_departures"][0]["departure_time"], "06:50")
        self.assertIn(
            (
                "campus-rag-derived",
                "campus_services/releases/transport_schedule/transport-schedule-20260424T090000/rejected-source-report.json",
            ),
            object_store.objects,
        )

    def test_worker_builds_projection_release_from_consumption_projection_candidates(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            manifest_path = root / "consumer-admission-manifest.json"
            _write_consumer_manifest(manifest_path)
            object_store = _FakeObjectStore()
            publisher = _FakeStructuredProjectionPublisher()
            registry, projection_entry = _notice_projection_runtime(object_store)

            report = worker.build_transport_schedule_projection_release_from_consumption_projection(
                projection_entries=(projection_entry,),
                registry=registry,
                work_dir=root / "work",
                release_id="transport-schedule-20260320T090000",
                generated_at="2026-03-20T09:00:00+08:00",
                service_horizon_days=3,
                object_store=object_store,
                derived_bucket="campus-rag-derived",
                structured_projection_publisher=publisher,
                publish_mode="promote",
            )

        self.assertEqual(report.release_id, "transport-schedule-20260320T090000")
        self.assertEqual(len(publisher.calls), 1)
        self.assertEqual(publisher.calls[0]["collection"], "transport_schedule")
        self.assertEqual(publisher.calls[0]["release_id"], "transport-schedule-20260320T090000")
        current_payload = json.loads(
            object_store.objects[
                (
                    "campus-rag-derived",
                    "campus_services/releases/transport_schedule/current/campus-services-projection.json",
                )
            ].decode("utf-8")
        )
        self.assertEqual(
            {
                (row["route_id"], row["departure_time"])
                for row in current_payload["scheduled_departures"]
            },
            {
                ("route:haidian-to-fengtai", "19:30"),
                ("route:fengtai-to-haidian", "07:30"),
            },
        )
        self.assertIn(
            (
                "campus-rag-derived",
                "campus_services/releases/transport_schedule/transport-schedule-20260320T090000/rejected-source-report.json",
            ),
            object_store.objects,
        )

    def test_preview_publish_mode_writes_local_artifacts_only(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            object_store = _FakeObjectStore()
            publisher = _FakeStructuredProjectionPublisher()
            registry, projection_entry = _notice_projection_runtime(object_store)

            report = worker.build_transport_schedule_projection_release_from_consumption_projection(
                projection_entries=(projection_entry,),
                registry=registry,
                work_dir=root / "work",
                release_id="transport-schedule-355122-preview",
                generated_at="2026-03-20T09:00:00+08:00",
                service_horizon_days=3,
                object_store=object_store,
                derived_bucket="campus-rag-derived",
                structured_projection_publisher=publisher,
                publish_mode="preview",
            )

        self.assertEqual(report.release_id, "transport-schedule-355122-preview")
        self.assertEqual(publisher.calls, [])
        self.assertNotIn(
            (
                "campus-rag-derived",
                "campus_services/releases/transport_schedule/transport-schedule-355122-preview/"
                "campus-services-projection.json",
            ),
            object_store.objects,
        )
        self.assertNotIn(
            (
                "campus-rag-derived",
                "campus_services/releases/transport_schedule/current/campus-services-projection.json",
            ),
            object_store.objects,
        )

    def test_stage_publish_mode_writes_versioned_release_without_current(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            object_store = _FakeObjectStore()
            publisher = _FakeStructuredProjectionPublisher()
            registry, projection_entry = _notice_projection_runtime(object_store)

            report = worker.build_transport_schedule_projection_release_from_consumption_projection(
                projection_entries=(projection_entry,),
                registry=registry,
                work_dir=root / "work",
                release_id="transport-schedule-355122-stage",
                generated_at="2026-03-20T09:00:00+08:00",
                service_horizon_days=3,
                object_store=object_store,
                derived_bucket="campus-rag-derived",
                structured_projection_publisher=publisher,
                publish_mode="stage",
            )

        self.assertEqual(report.release_id, "transport-schedule-355122-stage")
        self.assertEqual(len(publisher.calls), 1)
        self.assertFalse(publisher.calls[0]["promote_current"])
        self.assertIn(
            (
                "campus-rag-derived",
                "campus_services/releases/transport_schedule/transport-schedule-355122-stage/"
                "campus-services-projection.json",
            ),
            object_store.objects,
        )
        self.assertNotIn(
            (
                "campus-rag-derived",
                "campus_services/releases/transport_schedule/current/campus-services-projection.json",
            ),
            object_store.objects,
        )

    def test_release_notice_provenance_dedupes_multiple_units_for_same_notice(self) -> None:
        object_store = _FakeObjectStore()
        _, projection_entry = _notice_projection_runtime(object_store)
        second_unit = replace(
            projection_entry,
            unit_id="notice_unit:notice:muc_internal_portal:355122:service_status_override:2",
        )

        records = worker._transport_release_notice_provenance_records(
            projection_entries=(projection_entry, second_unit),
            admitted_at="2026-04-28T08:30:00Z",
            materialized_at="2026-04-28T08:56:20Z",
        )

        self.assertEqual(
            records,
            [
                {
                    "source_notice_id": "355122",
                    "source_ref": "notice:muc_internal_portal:355122",
                    "source_notice_release_time": "2026-03-18T10:00:00+08:00",
                    "admitted_at": "2026-04-28T08:30:00Z",
                    "materialized_at": "2026-04-28T08:56:20Z",
                }
            ],
        )

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
