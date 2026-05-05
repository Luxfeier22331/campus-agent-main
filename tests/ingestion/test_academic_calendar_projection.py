from __future__ import annotations

import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from campus_ingestion_core.academic_calendar_projection import (
    ACADEMIC_CALENDAR_PROJECTION_FILENAME,
    assert_academic_calendar_projection_release_ready,
    build_academic_calendar_projection_bundle_from_curated_source_truth,
    build_academic_calendar_projection_bundle_from_source_truth_manifest,
    write_academic_calendar_projection_release_from_source_truth_manifest,
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


class AcademicCalendarProjectionTest(unittest.TestCase):
    def test_builds_projection_from_curated_official_web_calendar_source_truth(self) -> None:
        result = build_academic_calendar_projection_bundle_from_curated_source_truth(
            curated_source_truth_artifact=_curated_calendar_artifact(),
            generated_at="2026-05-05T10:00:00+08:00",
        )

        self.assertTrue(result.validation_report.valid, result.validation_report.issues)
        assert_academic_calendar_projection_release_ready(
            result.bundle,
            expected_ready_records=3,
        )
        self.assertEqual(
            result.bundle["source_families"],
            ["official_web_curated_academic_calendar_v1"],
        )
        by_kind = {
            record["day_kind"]: record for record in result.bundle["academic_calendar_records"]
        }
        self.assertEqual(by_kind["teaching_day"]["week_index"], 1)
        self.assertEqual(by_kind["holiday"]["holiday_name"], "国庆节、中秋节假期")
        self.assertEqual(by_kind["makeup_class_day"]["class_day_pattern"], "执行周一课表")
        self.assertEqual(
            by_kind["makeup_class_day"]["source_refs"],
            [
                "official_web:muc-public-academic-calendar:owver_calendar",
                "https://www.muc.edu.cn/__local/8/B8/2D/E7FC43247592623AA3BD878CEC6_6A8F589A_403B2.jpg",
            ],
        )

    def test_rejects_curated_calendar_source_truth_with_manual_review_notes(self) -> None:
        artifact = _curated_calendar_artifact()
        artifact["documentData"]["records"][0]["manualReviewNotes"] = ["日期需要复核"]

        with self.assertRaisesRegex(ValueError, "manual review"):
            build_academic_calendar_projection_bundle_from_curated_source_truth(
                curated_source_truth_artifact=artifact,
                generated_at="2026-05-05T10:00:00+08:00",
            )

    def test_source_truth_manifest_writes_current_projection_release(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            source_path = root / "curated-calendar.v1.json"
            source_path.write_text(
                json.dumps(_curated_calendar_artifact(), ensure_ascii=False),
                encoding="utf-8",
            )
            manifest_path = root / "source-truth.v1.json"
            manifest_path.write_text(
                json.dumps(
                    {
                        "schema_version": "academic_calendar_source_truth_manifest.v1",
                        "target_corpus": "calendar",
                        "target_collection": "academic_calendar",
                        "upstream_source_channel": "official_web",
                        "release_id_prefix": "academic-calendar-curated-test",
                        "expected_ready_records": 3,
                        "curated_academic_calendars": [{"path": str(source_path)}],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            object_store = _FakeObjectStore()

            report = write_academic_calendar_projection_release_from_source_truth_manifest(
                source_truth_manifest_path=manifest_path,
                output_dir=root / "release-output",
                generated_at="2026-05-05T10:00:00+08:00",
                object_store=object_store,
                bucket="campus-rag-derived",
                release_id="academic-calendar-curated-test-release",
            )

        projection = json.loads(
            object_store.objects[("campus-rag-derived", report.current_object_key)].decode("utf-8")
        )
        self.assertEqual(len(projection["academic_calendar_records"]), 3)
        self.assertTrue(report.current_object_key.endswith(ACADEMIC_CALENDAR_PROJECTION_FILENAME))

    def test_default_source_truth_manifest_builds_2025_2026_runtime_facts(self) -> None:
        result = build_academic_calendar_projection_bundle_from_source_truth_manifest(
            source_truth_manifest_path=Path(
                "configs/ingestion/calendar/academic_calendar/source-truth.v1.json"
            ),
            generated_at="2026-05-05T10:00:00+08:00",
        )

        self.assertTrue(result.validation_report.valid, result.validation_report.issues)
        assert_academic_calendar_projection_release_ready(
            result.bundle,
            expected_ready_records=47,
        )
        records = result.bundle["academic_calendar_records"]
        self.assertTrue(
            any(
                record["start_date"] == "2026-05-04"
                and record["end_date"] == "2026-05-10"
                and record["week_index"] == 10
                and record["day_kind"] == "teaching_day"
                for record in records
            )
        )
        self.assertTrue(
            any(
                record["start_date"] == "2026-05-09"
                and record["is_makeup_class"] is True
                and record["class_day_pattern"] == "执行周一课表"
                for record in records
            )
        )
        self.assertTrue(
            any(
                record["holiday_name"] == "劳动节假期"
                and record["start_date"] == "2026-05-01"
                and record["end_date"] == "2026-05-05"
                for record in records
            )
        )


def _curated_calendar_artifact() -> dict[str, object]:
    return {
        "schemaVersion": "official_web_curated_academic_calendar.v1",
        "projectionName": "central-minzu-2025-2026-academic-calendar",
        "documentData": {
            "title": "中央民族大学 2025-2026 学年校历",
            "extractionStatus": "ready",
            "sourceRefs": [
                "official_web:muc-public-academic-calendar:owver_calendar",
                "https://www.muc.edu.cn/__local/8/B8/2D/E7FC43247592623AA3BD878CEC6_6A8F589A_403B2.jpg",
            ],
            "manualReviewRequired": False,
            "records": [
                {
                    "academicYearLabel": "2025-2026学年",
                    "termLabel": "秋季学期",
                    "startDate": "2025-09-01",
                    "endDate": "2025-09-07",
                    "weekIndex": 1,
                    "dayKind": "teaching_day",
                    "classDayPattern": "",
                    "isMakeupClass": False,
                    "holidayName": "",
                },
                {
                    "academicYearLabel": "2025-2026学年",
                    "termLabel": "秋季学期",
                    "startDate": "2025-10-01",
                    "endDate": "2025-10-08",
                    "weekIndex": 5,
                    "dayKind": "holiday",
                    "classDayPattern": "",
                    "isMakeupClass": False,
                    "holidayName": "国庆节、中秋节假期",
                },
                {
                    "academicYearLabel": "2025-2026学年",
                    "termLabel": "春季学期",
                    "startDate": "2026-05-09",
                    "endDate": "2026-05-09",
                    "weekIndex": 9,
                    "dayKind": "makeup_class_day",
                    "classDayPattern": "执行周一课表",
                    "isMakeupClass": True,
                    "holidayName": "",
                },
            ],
        },
    }


if __name__ == "__main__":
    unittest.main()
