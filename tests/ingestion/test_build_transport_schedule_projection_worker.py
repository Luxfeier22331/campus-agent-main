from __future__ import annotations

import importlib
import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

worker = importlib.import_module("campus_ingestion_worker.build_transport_schedule_projection")


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

            report = worker.build_transport_schedule_projection_release_from_inventory(
                source_truth_inventory_path=inventory_path,
                source_truth_root=source_root,
                work_dir=root / "work",
                release_id="transport-schedule-20260424T090000",
                generated_at="2026-04-24T09:00:00+08:00",
                service_horizon_days=3,
                object_store=object_store,
                derived_bucket="campus-rag-derived",
            )

        self.assertEqual(report.release_id, "transport-schedule-20260424T090000")
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
                "campus_services/releases/transport_schedule/transport-schedule-20260424T090000/manual-review-report.json",
            ),
            object_store.objects,
        )


def _write_json(path: Path, payload: dict[str, object]) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _write_jsonl(path: Path, rows: list[dict[str, object]]) -> None:
    path.write_text(
        "\n".join(json.dumps(row, ensure_ascii=False) for row in rows) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    unittest.main()
