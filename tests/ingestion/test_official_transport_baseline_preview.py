from __future__ import annotations

import unittest

from campus_ingestion_core.official_transport_baseline_preview import (
    build_official_transport_baseline_preview,
)

_BASELINE_OCR_TEXT = """
表1 师生通勤班车班次表 (新增班次3月20日起执行)
<table>
<tr><td>星期</td><td>线路</td><td>序号</td><td>发车时间</td><td>类型</td><td>备注</td></tr>
<tr><td rowspan="2">周一至周五</td><td rowspan="2">海淀校区→丰台校区</td><td>1</td><td>6:40</td><td>教师班次</td><td></td></tr>
<tr><td>2</td><td>8:10</td><td>学生班次</td><td></td></tr>
<tr><td rowspan="2">周六、日及法定节假日</td><td rowspan="2">丰台校区→海淀校区</td><td>1</td><td>8:00</td><td>学生班次</td><td></td></tr>
<tr><td>2</td><td>12:30</td><td>教师班次</td><td></td></tr>
</table>
"""


class OfficialTransportBaselinePreviewTests(unittest.TestCase):
    def test_builds_canonical_rows_from_mineru_table_with_rowspans(self) -> None:
        preview = build_official_transport_baseline_preview(
            ocr_plain_text=_BASELINE_OCR_TEXT,
            baseline_reference_date="2026-03-01",
            generated_at="2026-04-29T14:30:00+08:00",
            source_ref="official_transport_baseline:local-probe:20260429-222640",
            provider="mineru_api",
            model="vlm",
            provider_batch_id="batch-1",
        )

        self.assertFalse(preview["write_enabled"])
        self.assertEqual(preview["baseline"]["source_kind"], "official_baseline")
        self.assertEqual(preview["baseline"]["reference_date"], "2026-03-01")
        self.assertEqual(preview["baseline"]["effective_from"], "2026-03-20")
        self.assertEqual(preview["counts"]["canonical_row_count"], 4)
        self.assertEqual(preview["counts"]["route_count"], 2)
        self.assertEqual(preview["consistency"]["verdict"], "passed")

        first, second, third, fourth = preview["canonical_rows"]
        self.assertEqual(first["service_date_policy"], "weekdays")
        self.assertEqual(first["route_id"], "route:haidian-to-fengtai")
        self.assertEqual(first["departure_time"], "06:40")
        self.assertEqual(first["rider_type"], "教师")
        self.assertEqual(second["rider_type"], "学生")
        self.assertEqual(third["service_date_policy"], "weekends_and_holidays")
        self.assertEqual(third["route_id"], "route:fengtai-to-haidian")
        self.assertEqual(fourth["departure_time"], "12:30")

        bundle = preview["projection_bundle"]
        self.assertEqual(len(bundle["transport_schedule_snapshots"]), 1)
        self.assertTrue(bundle["transport_schedule_snapshots"][0]["is_current"])
        self.assertEqual(len(bundle["scheduled_departures"]), 4)
        self.assertTrue(
            all(row["source_kind"] == "official_baseline" for row in bundle["scheduled_departures"])
        )


if __name__ == "__main__":
    unittest.main()
