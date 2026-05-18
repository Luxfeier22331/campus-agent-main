from __future__ import annotations

import unittest

from campus_ingestion_core.authenticated_notice_processing_projection import (
    build_authenticated_notice_processing_snapshots,
)
from campus_ingestion_core.collected_notice_ingest_queue_store import (
    build_notice_ingest_queue_record,
)

from tests.ingestion import authenticated_notice_run_queue_consumer_support as support


class AuthenticatedNoticeProcessingProjectionTest(unittest.TestCase):
    def test_builds_operator_safe_transport_schedule_snapshot(self) -> None:
        bundle_bytes = support._json_bytes([{"notice_id": "355867"}])
        manifest_bytes = support._json_bytes({"run_id": "run-001"})
        job = support._job(
            run_id="run-001",
            bundle_sha=support._sha(bundle_bytes),
            bundle_size=len(bundle_bytes),
            manifest_sha=support._sha(manifest_bytes),
            manifest_size=len(manifest_bytes),
        )
        record = build_notice_ingest_queue_record(job)
        trace_row = {
            "status": "completed",
            "import_result": {
                "selected_notices": [
                    {
                        "notice_id": "355867",
                        "title": "关于4月27日-5月5日期间两校区班车及地铁接驳车安排的通知",
                    }
                ],
                "selected_notice_ids": ["355867"],
            },
            "child_task_summary": {
                "by_kind": {"downstream_materialization": 1},
                "by_state": {"completed": 3},
                "highest_severity": "none",
                "task_count": 3,
            },
            "progress_events": [
                {
                    "event_id": "event-001",
                    "generated_at": "2026-05-01T08:00:00.000Z",
                    "stage": "downstream_materialization",
                    "transition": "completed",
                    "reason_code": "downstream_materialization_completed",
                    "message": "downstream materialization completed",
                    "output_refs": [
                        {
                            "artifact_path": "/tmp/raw-operation-path",
                            "key": "derived/raw-object-key.json",
                        }
                    ],
                }
            ],
            "downstream_materialization": {
                "status": "completed",
                "typed_materialization": {
                    "status": "completed",
                    "materialized_releases": [
                        {
                            "candidate_kind": "transport_schedule",
                            "collection": "transport_schedule",
                            "current": True,
                            "notice_ids": ["355867"],
                            "release_id": "transport-schedule-run-001-job-001",
                            "notice_read_model_counts": {
                                "355867": {
                                    "currentSnapshots": 1,
                                    "rejectedSources": 0,
                                    "scheduledDepartures": 49,
                                    "snapshots": 1,
                                }
                            },
                        }
                    ],
                },
            },
        }

        snapshots = build_authenticated_notice_processing_snapshots(
            record=record,
            trace_row=trace_row,
            projected_at="2026-05-01T08:00:01.000Z",
            producer_version="test@1",
        )

        self.assertEqual(len(snapshots), 1)
        snapshot = snapshots[0]
        self.assertEqual(snapshot["noticeId"], "355867")
        self.assertEqual(snapshot["lifecycleStatus"], "tool_ready")
        self.assertEqual(snapshot["targetSurface"], "campus_services")
        self.assertEqual(snapshot["candidateKind"], "transport_schedule")
        self.assertTrue(snapshot["current"])
        self.assertTrue(snapshot["toolReady"])
        self.assertEqual(snapshot["readModelCounts"]["scheduledDepartures"], 49)
        self.assertEqual(snapshot["readModelCounts"]["rejectedSources"], 0)
        self.assertEqual(snapshot["releaseId"], "transport-schedule-run-001-job-001")
        self.assertEqual(
            snapshot["timeline"][0]["payload"],
            {"reasonCode": "downstream_materialization_completed"},
        )
        self.assertFalse(_contains_forbidden_key(snapshot))

    def test_builds_regulation_materialization_snapshot_without_tool_ready(self) -> None:
        bundle_bytes = support._json_bytes([{"notice_id": "354006"}])
        manifest_bytes = support._json_bytes({"run_id": "run-002"})
        job = support._job(
            run_id="run-002",
            bundle_sha=support._sha(bundle_bytes),
            bundle_size=len(bundle_bytes),
            manifest_sha=support._sha(manifest_bytes),
            manifest_size=len(manifest_bytes),
        )
        record = build_notice_ingest_queue_record(job)
        trace_row = {
            "status": "completed",
            "import_result": {
                "selected_notices": [
                    {
                        "notice_id": "354006",
                        "title": "中央民族大学中华民族共同体学院 2026年“英才计划”硕博连读研究生招生实施细则",
                    }
                ],
                "selected_notice_ids": ["354006"],
            },
            "progress_events": [
                {
                    "event_id": "event-002",
                    "generated_at": "2026-05-01T09:00:00.000Z",
                    "stage": "regulation_admission",
                    "transition": "admitted",
                    "reason_code": "scoped_rule_candidate_detected",
                    "regulation_admission_class": "scoped_rules_candidate",
                    "promotion_disposition": "promote_to_regulation_target",
                    "message": "regulation scoped rule admitted.",
                }
            ],
            "downstream_materialization": {
                "status": "completed",
                "typed_materialization": {
                    "status": "completed",
                    "materialized_releases": [
                        {
                            "candidate_kind": "regulation",
                            "collection": "scoped_rules",
                            "corpus": "regulations",
                            "current": True,
                            "notice_ids": ["354006"],
                            "release_id": "regulation-scoped-rules-run-002",
                            "notice_read_model_counts": {
                                "354006": {
                                    "readerDocuments": 1,
                                    "targetDocuments": 1,
                                }
                            },
                        }
                    ],
                },
            },
        }

        snapshots = build_authenticated_notice_processing_snapshots(
            record=record,
            trace_row=trace_row,
            projected_at="2026-05-01T09:00:01.000Z",
            producer_version="test@1",
        )

        self.assertEqual(len(snapshots), 1)
        snapshot = snapshots[0]
        self.assertEqual(snapshot["noticeId"], "354006")
        self.assertEqual(snapshot["lifecycleStatus"], "materialized")
        self.assertEqual(snapshot["targetSurface"], "regulations/scoped_rules")
        self.assertEqual(snapshot["candidateKind"], "regulation")
        self.assertEqual(snapshot["materializationStatus"], "completed")
        self.assertFalse(snapshot["toolReady"])
        self.assertEqual(snapshot["readModelCounts"]["readerDocuments"], 1)
        self.assertEqual(
            snapshot["timeline"][0]["payload"]["reasonCode"], "scoped_rule_candidate_detected"
        )
        self.assertEqual(
            snapshot["timeline"][0]["payload"]["regulationAdmissionClass"], "scoped_rules_candidate"
        )
        self.assertEqual(
            snapshot["timeline"][0]["payload"]["promotionDisposition"],
            "promote_to_regulation_target",
        )
        self.assertEqual(
            snapshot["downstream"],
            {
                "candidateKind": "regulation",
                "current": True,
                "readModelCounts": {
                    "readerDocuments": 1,
                    "rejectedSources": 0,
                    "targetDocuments": 1,
                },
                "releaseId": "regulation-scoped-rules-run-002",
                "targetSurface": "regulations/scoped_rules",
                "toolReady": False,
            },
        )
        self.assertFalse(_contains_forbidden_key(snapshot))

    def test_builds_regulation_target_surface_from_release_collection(self) -> None:
        bundle_bytes = support._json_bytes([{"notice_id": "188889"}])
        manifest_bytes = support._json_bytes({"run_id": "run-003"})
        job = support._job(
            run_id="run-003",
            bundle_sha=support._sha(bundle_bytes),
            bundle_size=len(bundle_bytes),
            manifest_sha=support._sha(manifest_bytes),
            manifest_size=len(manifest_bytes),
        )
        record = build_notice_ingest_queue_record(job)
        trace_row = {
            "status": "completed",
            "import_result": {
                "selected_notices": [
                    {
                        "notice_id": "188889",
                        "title": "中央民族大学采购工作管理办法",
                    }
                ],
                "selected_notice_ids": ["188889"],
            },
            "downstream_materialization": {
                "status": "completed",
                "typed_materialization": {
                    "status": "completed",
                    "materialized_releases": [
                        {
                            "candidate_kind": "regulation",
                            "collection": "institutional_rules",
                            "corpus": "regulations",
                            "current": True,
                            "notice_ids": ["188889"],
                            "release_id": "regulation-institutional-rules-run-003",
                        }
                    ],
                },
            },
        }

        snapshots = build_authenticated_notice_processing_snapshots(
            record=record,
            trace_row=trace_row,
            projected_at="2026-05-01T09:30:01.000Z",
            producer_version="test@1",
        )

        self.assertEqual(snapshots[0]["targetSurface"], "regulations/institutional_rules")
        self.assertEqual(
            snapshots[0]["downstream"]["targetSurface"],
            "regulations/institutional_rules",
        )

    def test_builds_regulation_rag_release_status_downstream_projection(self) -> None:
        bundle_bytes = support._json_bytes([{"notice_id": "188889"}])
        manifest_bytes = support._json_bytes({"run_id": "run-003"})
        job = support._job(
            run_id="run-003",
            bundle_sha=support._sha(bundle_bytes),
            bundle_size=len(bundle_bytes),
            manifest_sha=support._sha(manifest_bytes),
            manifest_size=len(manifest_bytes),
        )
        record = build_notice_ingest_queue_record(job)
        trace_row = {
            "status": "completed",
            "import_result": {
                "selected_notices": [
                    {
                        "notice_id": "188889",
                        "title": "中央民族大学采购工作管理办法",
                    }
                ],
                "selected_notice_ids": ["188889"],
            },
            "downstream_materialization": {
                "status": "completed",
                "typed_materialization": {
                    "status": "completed",
                    "materialized_releases": [
                        {
                            "candidate_kind": "regulation",
                            "collection": "institutional_rules",
                            "corpus": "regulations",
                            "current": True,
                            "document_site_status": "published",
                            "notice_ids": ["188889"],
                            "rag_index_status": "indexed",
                            "rag_preparation_status": "completed",
                            "rag_serving_status": "serving_published",
                            "rag_verification_status": "passed",
                            "release_id": "regulation-institutional-rules-run-003",
                        }
                    ],
                },
            },
        }

        snapshots = build_authenticated_notice_processing_snapshots(
            record=record,
            trace_row=trace_row,
            projected_at="2026-05-01T09:30:01.000Z",
            producer_version="test@1",
        )

        self.assertEqual(
            snapshots[0]["downstream"]["ragReleaseStatus"],
            {
                "documentSiteStatus": "published",
                "ragIndexStatus": "indexed",
                "ragPreparationStatus": "completed",
                "ragServingStatus": "serving_published",
                "ragVerificationStatus": "passed",
            },
        )

    def test_builds_operator_visible_regulation_audit_cleanup_timeline_payload(self) -> None:
        bundle_bytes = support._json_bytes([{"notice_id": "186977"}])
        manifest_bytes = support._json_bytes({"run_id": "run-004"})
        job = support._job(
            run_id="run-004",
            bundle_sha=support._sha(bundle_bytes),
            bundle_size=len(bundle_bytes),
            manifest_sha=support._sha(manifest_bytes),
            manifest_size=len(manifest_bytes),
        )
        record = build_notice_ingest_queue_record(job)
        trace_row = {
            "status": "completed",
            "import_result": {
                "selected_notices": [
                    {
                        "notice_id": "186977",
                        "title": "药学院2021年硕博连读博士研究生招生实施细则",
                    }
                ],
                "selected_notice_ids": ["186977"],
            },
            "progress_events": [
                {
                    "event_id": "event-004",
                    "generated_at": "2026-05-01T10:00:00.000Z",
                    "stage": "regulation_target_cleanup",
                    "transition": "completed",
                    "message": "target-side residue cleanup completed.",
                    "audit_run_id": "audit-run14-20260501",
                    "cleanup_run_id": "cleanup-186977-20260501",
                    "cleanup_disposition": "target_residue_deleted",
                    "postgres_exact_remaining": 0,
                    "object_store_exact_keys_remaining": 0,
                    "qdrant_residue_count": 0,
                }
            ],
        }

        snapshots = build_authenticated_notice_processing_snapshots(
            record=record,
            trace_row=trace_row,
            projected_at="2026-05-01T10:00:01.000Z",
            producer_version="test@1",
        )

        payload = snapshots[0]["timeline"][0]["payload"]
        self.assertEqual(payload["auditRunId"], "audit-run14-20260501")
        self.assertEqual(payload["cleanupRunId"], "cleanup-186977-20260501")
        self.assertEqual(payload["cleanupDisposition"], "target_residue_deleted")
        self.assertEqual(payload["postgresExactRemaining"], 0)
        self.assertEqual(payload["objectStoreExactKeysRemaining"], 0)
        self.assertEqual(payload["qdrantResidueCount"], 0)
        self.assertFalse(_contains_forbidden_key(snapshots[0]))


def _contains_forbidden_key(value: object) -> bool:
    forbidden = {
        "artifact_path",
        "attachmentBytes",
        "attachments",
        "bodyText",
        "bundlePath",
        "bucket",
        "key",
        "localPath",
        "objectKey",
        "ocrText",
        "output_refs",
        "rawHtml",
        "source_object_refs",
    }
    if isinstance(value, dict):
        return any(key in forbidden or _contains_forbidden_key(item) for key, item in value.items())
    if isinstance(value, list):
        return any(_contains_forbidden_key(item) for item in value)
    return False


if __name__ == "__main__":
    unittest.main()
