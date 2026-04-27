from __future__ import annotations

import importlib
import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from tests.ingestion.test_notice_derived_service_status_materialization import (
    _service_status_runtime,
)

worker = importlib.import_module("campus_ingestion_worker.build_service_status_projection")


class _FakeStructuredProjectionPublisher:
    def __init__(self) -> None:
        self.calls: list[dict[str, object]] = []

    def publish_release(self, **kwargs: object) -> object:
        self.calls.append(dict(kwargs))
        return {"current": True}


class BuildServiceStatusProjectionWorkerTest(unittest.TestCase):
    def test_worker_builds_service_status_release_from_consumption_projection_candidates(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            registry, object_store, entry = _service_status_runtime(
                notice_id="353903",
                notice_title="关于更改通勤班车丰台校区乘车点的通知",
                release_time="2025-12-11 10:00",
                parent_markdown=(
                    "# 关于更改通勤班车丰台校区乘车点的通知\n\n"
                    "下周一（12月15日）起，两校区通勤班车丰台校区的上车点、"
                    "下车点更改为聚雅餐厅东侧停车场路口。\n"
                ),
            )
            publisher = _FakeStructuredProjectionPublisher()

            report = worker.build_service_status_projection_release_from_consumption_projection(
                projection_entries=(entry,),
                registry=registry,
                work_dir=root / "work",
                release_id="service-status-20260427T120000",
                generated_at="2026-04-27T12:00:00+08:00",
                object_store=object_store,
                derived_bucket="campus-rag-derived",
                structured_projection_publisher=publisher,
            )

        self.assertEqual(report.release_id, "service-status-20260427T120000")
        self.assertEqual(len(publisher.calls), 1)
        publish_call = publisher.calls[0]
        self.assertEqual(publish_call["corpus"], "campus_services")
        self.assertEqual(publish_call["collection"], "service_status")
        self.assertEqual(publish_call["schema_version"], "campus_services_projection_bundle.v1")
        self.assertEqual(publish_call["validation_status"], "valid")
        current_payload = json.loads(
            object_store.objects[
                (
                    "campus-rag-derived",
                    "campus_services/releases/service_status/current/service-status-projection.json",
                )
            ].decode("utf-8")
        )
        self.assertEqual(
            current_payload["service_status_records"][0]["subject_id"],
            "transport:intercampus-commute:boarding-point:fengtai",
        )
