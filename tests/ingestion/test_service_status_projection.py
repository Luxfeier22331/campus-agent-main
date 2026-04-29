from __future__ import annotations

import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from campus_ingestion_core.service_status_projection import (
    SERVICE_STATUS_PROJECTION_FILENAME,
    SERVICE_STATUS_REJECTED_SOURCE_REPORT_FILENAME,
    validate_service_status_projection_bundle,
    write_service_status_projection_release,
)


class ServiceStatusProjectionTest(unittest.TestCase):
    def test_validation_requires_service_family_and_rejects_unknown_current_status(self) -> None:
        report = validate_service_status_projection_bundle(
            {
                "schema_version": "campus_services_projection_bundle.v1",
                "service_status_records": [
                    {
                        "subject_id": "service:library:haidian",
                        "display_name": "海淀校区图书馆",
                        "observed_status": "unknown",
                        "effective_from": "2026-04-28T08:00:00+08:00",
                        "effective_until": "2026-04-28T22:00:00+08:00",
                        "related_notice_refs": ["notice:muc_internal_portal:355001"],
                    }
                ],
                "service_status_rejected_sources": [],
            }
        )

        self.assertFalse(report.valid)
        paths = {issue["path"] for issue in report.issues}
        self.assertIn("service_status_records[0].service_family", paths)
        self.assertIn("service_status_records[0].observed_status", paths)
        self.assertEqual(report.counts["service_status_records"], 1)
        self.assertEqual(report.counts["rejected_sources"], 0)

    def test_validation_counts_rejected_sources_and_requires_reason(self) -> None:
        report = validate_service_status_projection_bundle(
            {
                "schema_version": "campus_services_projection_bundle.v1",
                "service_status_records": [],
                "service_status_rejected_sources": [
                    {
                        "source_notice_id": "355001",
                        "source_ref": "notice:muc_internal_portal:355001",
                        "notice_family": "library_service_status",
                        "candidate_kind": "service_status",
                        "missing_fields": ["effective_window"],
                    }
                ],
            }
        )

        self.assertFalse(report.valid)
        self.assertEqual(report.counts["rejected_sources"], 1)
        self.assertIn(
            "service_status_rejected_sources[0].reason",
            {issue["path"] for issue in report.issues},
        )

    def test_write_release_can_stage_without_current_artifact(self) -> None:
        bundle = {
            "schema_version": "campus_services_projection_bundle.v1",
            "service_status_records": [
                {
                    "subject_id": "service:library:haidian",
                    "display_name": "海淀校区图书馆",
                    "service_family": "library",
                    "aliases": ["图书馆"],
                    "campus_scope": "haidian",
                    "observed_status": "open",
                    "effective_from": "2026-04-28T08:00:00+08:00",
                    "effective_until": "2026-04-28T22:00:00+08:00",
                    "affected_scope": "海淀校区",
                    "status_note": "正常开放。",
                    "related_notice_refs": ["notice:muc_internal_portal:355001"],
                    "override_source_refs": ["notice:muc_internal_portal:355001"],
                }
            ],
            "service_status_rejected_sources": [
                {
                    "source_notice_id": "355002",
                    "source_ref": "notice:muc_internal_portal:355002",
                    "notice_family": "service_status_override",
                    "candidate_kind": "service_status",
                    "reason": "missing_effective_window",
                    "missing_fields": ["effective_from", "effective_until"],
                }
            ],
        }
        with TemporaryDirectory() as temp_dir:
            output_dir = Path(temp_dir)
            report = write_service_status_projection_release(
                bundle=bundle,
                output_dir=output_dir,
                release_id="service-status-stage-355001",
                generated_at="2026-04-28T09:00:00+08:00",
                write_current=False,
            )

            self.assertTrue(
                (
                    output_dir / "service-status-stage-355001" / SERVICE_STATUS_PROJECTION_FILENAME
                ).exists()
            )
            self.assertFalse((output_dir / "current" / SERVICE_STATUS_PROJECTION_FILENAME).exists())
            self.assertFalse((output_dir / "current").exists())
            rejected_path = (
                output_dir
                / "service-status-stage-355001"
                / SERVICE_STATUS_REJECTED_SOURCE_REPORT_FILENAME
            )
            self.assertEqual(json.loads(rejected_path.read_text())["rejected_source_count"], 1)
            self.assertEqual(report.rejected_source_report_path, str(rejected_path))
            self.assertEqual(
                report.rejected_source_report_object_key,
                (
                    "campus_services/releases/service_status/service-status-stage-355001/"
                    "rejected-source-report.json"
                ),
            )
            self.assertEqual(report.current_object_key, "")


if __name__ == "__main__":
    unittest.main()
