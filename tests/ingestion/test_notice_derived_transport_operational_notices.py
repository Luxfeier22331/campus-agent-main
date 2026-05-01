from __future__ import annotations

import unittest

from .notice_derived_transport_schedule_materialization_test_support import (
    _build_runtime,
    _load_module,
)


class NoticeDerivedTransportOperationalNoticeTest(unittest.TestCase):
    def test_builds_operational_notice_for_boarding_point_change(self) -> None:
        module = _load_module()
        self.assertIsNotNone(module, "notice-derived transport materializer module is required")
        assert module is not None
        registry, object_store, entry = _build_runtime(
            notice_id="353903",
            parent_markdown=(
                "# 关于更改通勤班车丰台校区乘车点的通知\n\n"
                "自2026年1月1日起，通勤班车丰台校区上车点、下车点更改为南门外停车区，"
                "运行班次时间不变。\n"
            ),
            attachment_document_ids=(),
        )

        result = module.build_notice_derived_transport_schedule_projection_bundle(
            projection_entries=(entry,),
            registry=registry,
            object_store=object_store,
            derived_bucket="campus-rag-derived",
            generated_at="2026-03-20T09:00:00+08:00",
            service_horizon_days=3,
        )

        self.assertEqual(result.bundle["transport_schedule_snapshots"], [])
        self.assertEqual(result.rejected_source_records, [])
        self.assertEqual(
            result.bundle["transport_operational_notices"],
            [
                {
                    "notice_id": "353903",
                    "source_ref": "notice:muc_internal_portal:353903",
                    "notice_kind": "boarding_point_change",
                    "route_ids": ["route:fengtai-to-haidian"],
                    "effective_from": "2026-01-01T00:00:00+08:00",
                    "effective_until": "",
                    "operational_comment": (
                        "自2026年1月1日起，通勤班车丰台校区上车点、下车点更改为南门外停车区，"
                        "运行班次时间不变"
                    ),
                }
            ],
        )

    def test_builds_operational_notice_with_yearless_effective_date_parentheses(self) -> None:
        module = _load_module()
        self.assertIsNotNone(module, "notice-derived transport materializer module is required")
        assert module is not None
        registry, object_store, entry = _build_runtime(
            notice_id="353903",
            release_time="2025-12-11T16:02:00+08:00",
            parent_markdown=(
                "# 关于更改通勤班车丰台校区乘车点的通知\n\n"
                "下周一（12月15日）起，两校区通勤班车丰台校区的上车点、"
                "下车点更改为聚雅餐厅东侧停车场路口。\n\n"
                "丰台校区管委会办公室\n\n"
                "2025年12月11日\n"
            ),
            attachment_document_ids=(),
        )

        result = module.build_notice_derived_transport_schedule_projection_bundle(
            projection_entries=(entry,),
            registry=registry,
            object_store=object_store,
            derived_bucket="campus-rag-derived",
            generated_at="2026-03-20T09:00:00+08:00",
            service_horizon_days=3,
        )

        self.assertEqual(result.bundle["transport_schedule_snapshots"], [])
        self.assertEqual(result.rejected_source_records, [])
        self.assertEqual(
            result.bundle["transport_operational_notices"],
            [
                {
                    "notice_id": "353903",
                    "source_ref": "notice:muc_internal_portal:353903",
                    "notice_kind": "boarding_point_change",
                    "route_ids": ["route:fengtai-to-haidian"],
                    "effective_from": "2025-12-15T00:00:00+08:00",
                    "effective_until": "",
                    "operational_comment": (
                        "下周一（12月15日）起，两校区通勤班车丰台校区的上车点、"
                        "下车点更改为聚雅餐厅东侧停车场路口"
                    ),
                }
            ],
        )


if __name__ == "__main__":
    unittest.main()
