from __future__ import annotations

import json
import unittest
from dataclasses import replace
from pathlib import Path
from tempfile import TemporaryDirectory

from tests.ingestion.build_transport_schedule_projection_worker_suite_support import (
    _FakeObjectStore,
    _FakeStructuredProjectionPublisher,
    _notice_projection_runtime,
    _write_consumer_manifest,
    _write_json,
    _write_jsonl,
    worker,
)


class BuildTransportScheduleProjectionWorkerTestPart01(unittest.TestCase):
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
