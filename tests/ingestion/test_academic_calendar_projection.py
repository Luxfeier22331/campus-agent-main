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
            expected_ready_records=4,
        )
        self.assertEqual(
            result.bundle["source_families"],
            ["official_web_curated_academic_calendar_v1"],
        )
        records = result.bundle["academic_calendar_records"]
        self.assertEqual(
            result.validation_report.counts["record_family.named_event"],
            1,
        )
        self.assertEqual(
            result.validation_report.counts["record_family.term_window"],
            1,
        )
        by_family = {record["record_family"]: record for record in records}
        self.assertEqual(by_family["teaching_week"]["week_index"], 1)
        self.assertEqual(by_family["term_window"]["event_name"], "秋季学期")
        self.assertEqual(by_family["term_window"]["event_end_date_exclusive"], "2025-09-08")
        holiday = next(record for record in records if record["record_family"] == "named_event")
        self.assertEqual(holiday["holiday_name"], "国庆节、中秋节假期")
        self.assertEqual(holiday["event_name"], "国庆节、中秋节假期")
        self.assertEqual(holiday["event_end_date_exclusive"], "2025-10-09")
        self.assertEqual(by_family["class_day_override"]["class_day_pattern"], "执行周一课表")
        self.assertEqual(
            by_family["class_day_override"]["source_refs"],
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
                        "expected_ready_records": 4,
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
        self.assertEqual(len(projection["academic_calendar_records"]), 4)
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
            expected_ready_records=51,
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
        may_9_records = [
            record
            for record in records
            if record["start_date"] == "2026-05-09" and record["end_date"] == "2026-05-09"
        ]
        self.assertTrue(
            any(
                record["record_family"] == "normal_rest_day"
                and record["day_kind"] == "normal_rest_day"
                and record["source_notice_ids"] == ["355589", "355682"]
                and record["precedence_reason"] == "later_official_notice_overrides_baseline"
                for record in may_9_records
            ),
            may_9_records,
        )
        self.assertFalse(
            any(
                record["record_family"] == "class_day_override"
                and record["is_makeup_class"] is True
                and record["class_day_pattern"] == "执行周一课表"
                for record in may_9_records
            ),
            may_9_records,
        )
        self.assertTrue(
            any(
                record["holiday_name"] == "劳动节假期"
                and record["record_family"] == "named_event"
                and record["start_date"] == "2026-05-01"
                and record["end_date"] == "2026-05-05"
                and record["event_end_date_exclusive"] == "2026-05-06"
                for record in records
            )
        )
        self.assertTrue(
            any(
                record["record_family"] == "term_window"
                and record["term_label"] == "春季学期"
                and record["start_date"] == "2026-03-02"
                and record["end_date"] == "2026-07-12"
                and record["event_end_date_exclusive"] == "2026-07-13"
                for record in records
            )
        )
        suspension = next(
            record
            for record in records
            if record["record_family"] == "course_suspension"
            and record["start_date"] == "2026-04-27"
            and record["end_date"] == "2026-05-05"
        )
        self.assertEqual(
            suspension["event_name"],
            "运动会、春季社会实践周、劳动节假期课程调整",
        )
        self.assertIn("春假", suspension["event_aliases"])
        self.assertEqual(suspension["event_alias_types"]["春假"], "colloquial")
        self.assertEqual(suspension["source_notice_ids"], ["355682"])
        self.assertEqual(suspension["applies_to"], ["undergraduate", "preparatory", "graduate"])
        self.assertTrue(
            any(
                record["record_family"] == "workday_makeup"
                and record["start_date"] == "2026-04-25"
                and record["class_day_pattern"] == "执行2026-05-05教学计划"
                and record["source_notice_ids"] == ["355589", "355682"]
                for record in records
            )
        )
        self.assertFalse(any(record.get("event_name") == "春假" for record in records))

    def test_validation_rejects_named_event_without_source_display_fields(self) -> None:
        artifact = _curated_calendar_artifact()
        artifact["documentData"]["records"][1]["sourceRefs"] = []
        artifact["documentData"]["sourceRefs"] = ["https://www.muc.edu.cn/ggfw/mdxl.htm"]

        result = build_academic_calendar_projection_bundle_from_curated_source_truth(
            curated_source_truth_artifact=artifact,
            generated_at="2026-05-05T10:00:00+08:00",
        )
        named_event = next(
            record
            for record in result.bundle["academic_calendar_records"]
            if record["record_family"] == "named_event"
        )
        named_event["source_url"] = ""

        with self.assertRaisesRegex(ValueError, "source_url is required"):
            assert_academic_calendar_projection_release_ready(result.bundle)

    def test_validation_accepts_notice_derived_calendar_record_families(self) -> None:
        bundle = _minimal_projection_bundle(
            [
                _projection_record(
                    record_family="course_suspension",
                    day_kind="course_suspension",
                    event_name="运动会、春季社会实践周、劳动节假期课程调整",
                    event_type="course_suspension",
                    event_aliases=["春假", "春季社会实践周"],
                    event_alias_types={"春假": "colloquial"},
                    source_family="authenticated_notice_calendar_arrangement_v1",
                    source_precedence=80,
                    source_notice_ids=["355682"],
                    start_date="2026-04-27",
                    end_date="2026-05-05",
                    event_end_date_exclusive="2026-05-06",
                    applies_to=["undergraduate", "graduate"],
                ),
                _projection_record(
                    record_family="normal_rest_day",
                    day_kind="normal_rest_day",
                    event_name="五一劳动节假期正常公休安排",
                    event_type="normal_rest_day",
                    source_family="authenticated_notice_calendar_arrangement_v1",
                    source_precedence=90,
                    source_notice_ids=["355589", "355682"],
                    precedence_reason="later_official_notice_overrides_baseline",
                    conflict_refs=["calendar:official_web:baseline-2026-05-09"],
                    start_date="2026-05-09",
                    end_date="2026-05-09",
                    event_end_date_exclusive="2026-05-10",
                ),
                _projection_record(
                    record_family="workday_makeup",
                    day_kind="workday_makeup",
                    event_name="五一劳动节假期调休上课安排",
                    event_type="workday_makeup",
                    source_family="authenticated_notice_calendar_arrangement_v1",
                    source_precedence=90,
                    source_notice_ids=["355589", "355682"],
                    start_date="2026-04-25",
                    end_date="2026-04-25",
                    event_end_date_exclusive="2026-04-26",
                    class_day_pattern="执行5月5日教学计划",
                    is_makeup_class=True,
                ),
            ]
        )

        validation = build_validation(bundle)

        self.assertTrue(validation.valid, validation.issues)
        self.assertEqual(validation.counts["record_family.course_suspension"], 1)
        self.assertEqual(validation.counts["record_family.normal_rest_day"], 1)
        self.assertEqual(validation.counts["record_family.workday_makeup"], 1)

    def test_validation_blocks_calendar_conflict_without_precedence_reason(self) -> None:
        bundle = _minimal_projection_bundle(
            [
                _projection_record(
                    record_family="class_day_override",
                    day_kind="makeup_class_day",
                    source_family="official_web_curated_academic_calendar_v1",
                    source_precedence=10,
                    start_date="2026-05-09",
                    end_date="2026-05-09",
                    event_end_date_exclusive="2026-05-10",
                    class_day_pattern="执行周一课表",
                    is_makeup_class=True,
                ),
                _projection_record(
                    record_family="normal_rest_day",
                    day_kind="normal_rest_day",
                    event_name="五一劳动节假期正常公休安排",
                    event_type="normal_rest_day",
                    source_family="authenticated_notice_calendar_arrangement_v1",
                    source_precedence=90,
                    source_notice_ids=["355589", "355682"],
                    start_date="2026-05-09",
                    end_date="2026-05-09",
                    event_end_date_exclusive="2026-05-10",
                ),
            ]
        )

        validation = build_validation(bundle)

        self.assertFalse(validation.valid)
        self.assertTrue(
            any(
                "calendar conflict requires precedence_reason" in issue["message"]
                for issue in validation.issues
            ),
            validation.issues,
        )

    def test_validation_blocks_colloquial_alias_without_alias_type(self) -> None:
        bundle = _minimal_projection_bundle(
            [
                _projection_record(
                    record_family="course_suspension",
                    day_kind="course_suspension",
                    event_name="运动会、春季社会实践周、劳动节假期课程调整",
                    event_type="course_suspension",
                    event_aliases=["春假"],
                    event_alias_types={},
                    source_family="authenticated_notice_calendar_arrangement_v1",
                    source_precedence=80,
                    source_notice_ids=["355682"],
                    start_date="2026-04-27",
                    end_date="2026-05-05",
                    event_end_date_exclusive="2026-05-06",
                ),
            ]
        )

        validation = build_validation(bundle)

        self.assertFalse(validation.valid)
        self.assertTrue(
            any(
                "colloquial alias must declare event_alias_types" in issue["message"]
                for issue in validation.issues
            ),
            validation.issues,
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


def build_validation(bundle: dict[str, object]):
    from campus_ingestion_core.academic_calendar_projection import (
        validate_academic_calendar_projection_bundle,
    )

    return validate_academic_calendar_projection_bundle(bundle)


def _minimal_projection_bundle(records: list[dict[str, object]]) -> dict[str, object]:
    return {
        "schema_version": "academic_calendar_projection.v1",
        "generated_at": "2026-05-07T00:00:00+08:00",
        "source_families": [
            "official_web_curated_academic_calendar_v1",
            "authenticated_notice_calendar_arrangement_v1",
        ],
        "source_documents": [],
        "academic_calendar_records": records,
        "manual_review_sources": [],
    }


def _projection_record(
    *,
    record_family: str,
    day_kind: str,
    source_family: str,
    source_precedence: int,
    start_date: str,
    end_date: str,
    event_end_date_exclusive: str,
    event_name: str = "",
    event_type: str = "",
    event_aliases: list[str] | None = None,
    event_alias_types: dict[str, str] | None = None,
    source_notice_ids: list[str] | None = None,
    precedence_reason: str = "",
    conflict_refs: list[str] | None = None,
    applies_to: list[str] | None = None,
    class_day_pattern: str = "",
    is_makeup_class: bool = False,
) -> dict[str, object]:
    return {
        "calendar_record_id": f"calendar:test:{record_family}:{start_date}",
        "record_family": record_family,
        "academic_year_label": "2025-2026学年",
        "term_label": "春季学期",
        "start_date": start_date,
        "end_date": end_date,
        "week_index": 9,
        "day_kind": day_kind,
        "class_day_pattern": class_day_pattern,
        "is_makeup_class": is_makeup_class,
        "holiday_name": "",
        "source_refs": ["https://my.muc.edu.cn/#/print?type=6&notice_id=355682&show_type=1"],
        "event_name": event_name,
        "event_type": event_type,
        "event_aliases": event_aliases or [],
        "event_alias_types": event_alias_types or {},
        "event_start_date": start_date,
        "event_end_date_exclusive": event_end_date_exclusive,
        "display_start_date": start_date,
        "display_end_date": end_date,
        "applies_to": applies_to or ["all"],
        "source_title": "关于运动会、春季社会实践周、劳动节假期本（预）科、研究生课程调整的通知",
        "source_url": "https://my.muc.edu.cn/#/print?type=6&notice_id=355682&show_type=1",
        "source_family": source_family,
        "source_precedence": source_precedence,
        "source_notice_ids": source_notice_ids or [],
        "precedence_reason": precedence_reason,
        "conflict_refs": conflict_refs or [],
    }


if __name__ == "__main__":
    unittest.main()
