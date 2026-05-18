from __future__ import annotations

import json
import os
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

import scripts.publish_academic_calendar_projection as publisher_script


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


class _FakePublisher:
    def __init__(self) -> None:
        self.published: list[dict[str, object]] = []

    def publish_release(self, **kwargs: object) -> object:
        self.published.append(dict(kwargs))
        return {
            "collection": kwargs["collection"],
            "release_id": kwargs["release_id"],
            "counts": {"academic_calendar_records": 3},
        }


class PublishAcademicCalendarProjectionTest(unittest.TestCase):
    def test_publish_from_manifest_writes_artifacts_and_optionally_current_projection(self) -> None:
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
            structured_publisher = _FakePublisher()

            report = publisher_script.publish_academic_calendar_projection_from_manifest(
                source_truth_manifest_path=manifest_path,
                output_dir=root / "release-output",
                generated_at="2026-05-05T10:00:00+08:00",
                object_store=object_store,
                bucket="campus-rag-derived",
                structured_projection_publisher=structured_publisher,
                release_id="academic-calendar-curated-test-release",
                promote_current=True,
            )

        self.assertTrue(report["published"])
        self.assertEqual(report["release_id"], "academic-calendar-curated-test-release")
        self.assertEqual(report["record_count"], 4)
        self.assertEqual(structured_publisher.published[0]["collection"], "academic_calendar")
        self.assertTrue(structured_publisher.published[0]["promote_current"])
        self.assertIn(
            ("campus-rag-derived", report["current_object_key"]),
            object_store.objects,
        )

    def test_publish_from_manifest_preview_does_not_require_structured_publisher(self) -> None:
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

            report = publisher_script.publish_academic_calendar_projection_from_manifest(
                source_truth_manifest_path=manifest_path,
                output_dir=root / "release-output",
                generated_at="2026-05-05T10:00:00+08:00",
                object_store=_FakeObjectStore(),
                bucket="campus-rag-derived",
                structured_projection_publisher=None,
                release_id="academic-calendar-curated-test-release",
                promote_current=False,
            )

        self.assertFalse(report["published"])
        self.assertEqual(report["record_count"], 4)

    def test_main_loads_repo_env_and_builds_object_store_from_settings(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            manifest_path = root / "source-truth.v1.json"
            source_path = root / "curated-calendar.v1.json"
            output_dir = root / "release-output"
            report_path = root / "report.json"
            source_path.write_text(
                json.dumps(_curated_calendar_artifact(), ensure_ascii=False),
                encoding="utf-8",
            )
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
            constructed_settings: list[object] = []

            def fake_admin(settings: object) -> _FakeObjectStore:
                constructed_settings.append(settings)
                return object_store

            with (
                patch.object(publisher_script, "load_repo_env") as load_repo_env,
                patch.object(publisher_script, "S3ObjectStoreAdmin", side_effect=fake_admin),
                patch.dict(
                    os.environ,
                    {
                        "OBJECT_STORE_ENDPOINT": "http://127.0.0.1:9000",
                        "OBJECT_STORE_ACCESS_KEY": "access",
                        "OBJECT_STORE_SECRET_KEY": "secret",
                        "OBJECT_STORE_BUCKET_DERIVED": "campus-rag-derived-test",
                    },
                    clear=True,
                ),
            ):
                exit_code = publisher_script.main(
                    [
                        "--source-truth-manifest",
                        str(manifest_path),
                        "--output-dir",
                        str(output_dir),
                        "--generated-at",
                        "2026-05-05T10:00:00+08:00",
                        "--release-id",
                        "academic-calendar-curated-test-release",
                        "--report-path",
                        str(report_path),
                    ]
                )
                report = json.loads(report_path.read_text(encoding="utf-8"))

            self.assertEqual(exit_code, 0)
            load_repo_env.assert_called_once()
            self.assertEqual(len(constructed_settings), 1)
            self.assertEqual(report["record_count"], 4)
            self.assertIn(
                ("campus-rag-derived-test", report["release_object_key"]),
                object_store.objects,
            )

    def test_main_uses_shared_postgres_env_when_database_url_is_omitted(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            manifest_path = root / "source-truth.v1.json"
            source_path = root / "curated-calendar.v1.json"
            output_dir = root / "release-output"
            report_path = root / "report.json"
            source_path.write_text(
                json.dumps(_curated_calendar_artifact(), ensure_ascii=False),
                encoding="utf-8",
            )
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
            publisher = _FakePublisher()
            database_urls: list[str] = []

            def fake_publisher(database_url: str) -> _FakePublisher:
                database_urls.append(database_url)
                return publisher

            with (
                patch.object(publisher_script, "load_repo_env"),
                patch.object(publisher_script, "S3ObjectStoreAdmin", return_value=object_store),
                patch.object(
                    publisher_script,
                    "PostgresStructuredProjectionPublisher",
                    side_effect=fake_publisher,
                ),
                patch.dict(
                    os.environ,
                    {
                        "OBJECT_STORE_ENDPOINT": "http://127.0.0.1:9000",
                        "OBJECT_STORE_ACCESS_KEY": "access",
                        "OBJECT_STORE_SECRET_KEY": "secret",
                        "OBJECT_STORE_BUCKET_DERIVED": "campus-rag-derived-test",
                        "CAMPUS_SHARED_POSTGRES_URL": "postgresql://example/db",
                    },
                    clear=True,
                ),
            ):
                exit_code = publisher_script.main(
                    [
                        "--source-truth-manifest",
                        str(manifest_path),
                        "--output-dir",
                        str(output_dir),
                        "--generated-at",
                        "2026-05-05T10:00:00+08:00",
                        "--release-id",
                        "academic-calendar-curated-test-release",
                        "--promote-current",
                        "--report-path",
                        str(report_path),
                    ]
                )
                report = json.loads(report_path.read_text(encoding="utf-8"))

            self.assertEqual(exit_code, 0)
            self.assertEqual(database_urls, ["postgresql://example/db"])
            self.assertTrue(report["published"])
            self.assertTrue(publisher.published[0]["promote_current"])


def _curated_calendar_artifact() -> dict[str, object]:
    return {
        "schemaVersion": "official_web_curated_academic_calendar.v1",
        "projectionName": "central-minzu-2025-2026-academic-calendar",
        "documentData": {
            "title": "中央民族大学 2025-2026 学年校历",
            "extractionStatus": "ready",
            "manualReviewRequired": False,
            "sourceRefs": ["https://www.muc.edu.cn/ggfw/mdxl.htm"],
            "records": [
                {
                    "academicYearLabel": "2025-2026学年",
                    "termLabel": "春季学期",
                    "startDate": "2026-05-04",
                    "endDate": "2026-05-10",
                    "weekIndex": 10,
                    "dayKind": "teaching_day",
                    "classDayPattern": "",
                    "isMakeupClass": False,
                    "holidayName": "",
                },
                {
                    "academicYearLabel": "2025-2026学年",
                    "termLabel": "春季学期",
                    "startDate": "2026-05-01",
                    "endDate": "2026-05-05",
                    "weekIndex": 9,
                    "dayKind": "holiday",
                    "classDayPattern": "",
                    "isMakeupClass": False,
                    "holidayName": "劳动节假期",
                },
                {
                    "academicYearLabel": "2025-2026学年",
                    "termLabel": "春季学期",
                    "startDate": "2026-05-09",
                    "endDate": "2026-05-09",
                    "weekIndex": 10,
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
