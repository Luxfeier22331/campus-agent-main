from __future__ import annotations

import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from campus_ingestion_core.transport_schedule_projection import (
    TRANSPORT_SCHEDULE_PROJECTION_FILENAME,
    build_transport_schedule_projection_bundle,
    validate_transport_schedule_projection_bundle,
    write_transport_schedule_projection_release,
)


class _FakeObjectStore:
    def __init__(self) -> None:
        self.objects: dict[tuple[str, str], bytes] = {}

    def put_bytes(
        self,
        *,
        bucket: str,
        key: str,
        data: bytes,
        content_type: str,
    ) -> None:
        self.objects[(bucket, key)] = data


class TransportScheduleProjectionTest(unittest.TestCase):
    def test_builds_projection_bundle_from_authenticated_notice_source_truth(self) -> None:
        result = build_transport_schedule_projection_bundle(
            source_truth_parents=(
                {
                    "notice_manifest": {
                        "site_id": "muc_internal_portal",
                        "notice_id": "1001",
                        "notice_title_normalized": "关于发布校车时刻表的通知",
                        "notice_release_time": "2026-04-20 18:00",
                        "source_notice_link": "https://portal.example.edu/notice/1001",
                    },
                    "content_blocks": [
                        {
                            "text_normalized": (
                                "本时刻表自2026年4月21日起执行。"
                                "海淀校区至丰台校区工作日发车时间：06:50、07:20、13:20。"
                                "丰台校区至海淀校区工作日发车时间：17:10、18:00。"
                                "地铁接驳车每日发车时间：08:00、08:30。"
                            )
                        }
                    ],
                },
                {
                    "notice_manifest": {
                        "site_id": "muc_internal_portal",
                        "notice_id": "1002",
                        "notice_title_normalized": "关于地铁接驳车临时停运的通知",
                        "notice_release_time": "2026-04-23 09:00",
                    },
                    "content_blocks": [{"text_normalized": "2026年4月24日地铁接驳车临时停运。"}],
                },
            ),
            generated_at="2026-04-24T09:00:00+08:00",
            service_horizon_days=4,
        )

        self.assertEqual(result.manual_review_sources, [])
        self.assertTrue(result.validation_report.valid, result.validation_report.issues)
        bundle = result.bundle
        self.assertEqual(bundle["schema_version"], "campus_services_projection_bundle.v1")
        self.assertEqual(len(bundle["transport_schedule_snapshots"]), 1)
        self.assertEqual(
            bundle["transport_schedule_snapshots"][0]["source_ref"],
            "notice:muc_internal_portal:1001",
        )
        self.assertEqual(
            {route["route_id"] for route in bundle["transport_routes"]},
            {
                "route:haidian-to-fengtai",
                "route:fengtai-to-haidian",
                "route:subway-shuttle",
            },
        )
        haidian_to_fengtai = [
            row
            for row in bundle["scheduled_departures"]
            if row["route_id"] == "route:haidian-to-fengtai"
        ]
        self.assertEqual(
            [row["departure_time"] for row in haidian_to_fengtai[:3]],
            ["06:50", "07:20", "13:20"],
        )
        self.assertIn("2026-04-24", haidian_to_fengtai[0]["service_dates"])
        self.assertNotIn("2026-04-25", haidian_to_fengtai[0]["service_dates"])
        self.assertEqual(
            bundle["transport_service_exceptions"],
            [
                {
                    "snapshot_id": "snapshot:transport-schedule:2026-04-20:1001",
                    "route_id": "route:subway-shuttle",
                    "service_date": "2026-04-24",
                    "service_status": "temporarily_suspended",
                    "related_notice_refs": ["notice:muc_internal_portal:1002"],
                    "operational_comment": "2026年4月24日地铁接驳车临时停运。",
                }
            ],
        )

    def test_validation_rejects_multiple_current_snapshots(self) -> None:
        report = validate_transport_schedule_projection_bundle(
            {
                "schema_version": "campus_services_projection_bundle.v1",
                "transport_schedule_snapshots": [
                    {
                        "snapshot_id": "snapshot:one",
                        "published_at": "2026-04-20T18:00:00+08:00",
                        "effective_from": "2026-04-21T00:00:00+08:00",
                        "source_ref": "notice:muc_internal_portal:1001",
                        "is_current": True,
                    },
                    {
                        "snapshot_id": "snapshot:two",
                        "published_at": "2026-04-21T18:00:00+08:00",
                        "effective_from": "2026-04-22T00:00:00+08:00",
                        "source_ref": "notice:muc_internal_portal:1002",
                        "is_current": True,
                    },
                ],
                "transport_routes": [],
                "scheduled_departures": [],
                "transport_service_exceptions": [],
            }
        )

        self.assertFalse(report.valid)
        self.assertIn("multiple current transport schedule snapshots", report.issues[0]["message"])

    def test_write_release_publishes_versioned_and_current_projection(self) -> None:
        with TemporaryDirectory() as temp_dir:
            output_dir = Path(temp_dir)
            object_store = _FakeObjectStore()
            bundle = {
                "schema_version": "campus_services_projection_bundle.v1",
                "transport_schedule_snapshots": [],
                "transport_routes": [],
                "scheduled_departures": [],
                "transport_service_exceptions": [],
            }
            report = write_transport_schedule_projection_release(
                bundle=bundle,
                output_dir=output_dir,
                release_id="transport-schedule-20260424T090000",
                generated_at="2026-04-24T09:00:00+08:00",
                object_store=object_store,
                bucket="campus-rag-derived",
            )
            self.assertTrue(
                (output_dir / "current" / TRANSPORT_SCHEDULE_PROJECTION_FILENAME).exists()
            )

            self.assertEqual(
                report.release_object_key,
                "campus_services/releases/transport_schedule/transport-schedule-20260424T090000/campus-services-projection.json",
            )
        self.assertEqual(
            report.current_object_key,
            "campus_services/releases/transport_schedule/current/campus-services-projection.json",
        )
        self.assertEqual(
            json.loads(
                object_store.objects[
                    (
                        "campus-rag-derived",
                        "campus_services/releases/transport_schedule/current/"
                        + TRANSPORT_SCHEDULE_PROJECTION_FILENAME,
                    )
                ].decode("utf-8")
            ),
            bundle,
        )


if __name__ == "__main__":
    unittest.main()
