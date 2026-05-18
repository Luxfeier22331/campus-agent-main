from __future__ import annotations

import importlib
import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import patch

from campus_ingestion_core.notice_consumption_projection import (
    NOTICE_COMPLETENESS_COMPLETE,
    NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET,
    NOTICE_DEFAULT_AGENT_CAMPUS_SERVICES,
    NOTICE_PRIMARY_ROLE_SERVICE_STATUS_OVERRIDE,
    NOTICE_SEMANTIC_OWNER_NOTICE_BODY,
    NOTICE_SOURCE_FAMILY_INTERNAL_RESTRICTED,
    NOTICE_TARGET_SURFACE_SERVICE_STATUS_CANDIDATE,
    NOTICE_TEMPORAL_POLICY_CURRENT_OVERRIDE,
    NoticeConsumptionProjectionEntry,
)

worker = importlib.import_module(
    "campus_ingestion_worker.authenticated_notice_typed_downstream_materialization"
)


class AuthenticatedNoticeTypedDownstreamMaterializationWorkerTest(unittest.TestCase):
    def test_materializes_transport_candidate_with_generated_preview_gate(self) -> None:
        entry = _transport_entry("355867")
        projection_store = _ProjectionStore((entry,))
        release_report = SimpleNamespace(
            release_id="transport-schedule-run-001-job-001",
            release_object_key=(
                "campus_services/releases/transport_schedule/"
                "transport-schedule-run-001-job-001/campus-services-projection.json"
            ),
            current_object_key=(
                "campus_services/releases/transport_schedule/current/"
                "campus-services-projection.json"
            ),
        )
        with TemporaryDirectory() as tmpdir:
            operations_dir = Path(tmpdir) / "operations"
            consumer_manifest_path = Path(tmpdir) / "consumer-admission.json"
            consumer_manifest_path.write_text("{}", encoding="utf-8")

            with (
                patch.object(
                    worker,
                    "build_notice_consumption_projection_store_from_env",
                    return_value=projection_store,
                ),
                patch.object(worker, "build_document_registry_from_env", return_value=object()),
                patch.object(
                    worker,
                    "build_structured_projection_publisher_from_env",
                    return_value=object(),
                ),
                patch.object(
                    worker,
                    "load_internal_notice_consumer_admission_manifest",
                    return_value=SimpleNamespace(created_at="2026-05-01T10:00:00+08:00"),
                ),
                patch.object(
                    worker,
                    "check_internal_notice_consumer_admission_gate",
                    return_value=SimpleNamespace(allowed=True, reason_codes=()),
                ),
                patch.object(
                    worker,
                    "build_notice_derived_transport_schedule_projection_bundle",
                    return_value=SimpleNamespace(
                        bundle={
                            "schema_version": "campus_services_projection_bundle.v1",
                            "transport_schedule_snapshots": [
                                {
                                    "snapshot_id": "transport-schedule-notice-355867",
                                    "source_ref": "notice:muc_internal_portal:355867",
                                    "is_current": True,
                                }
                            ],
                            "scheduled_departures": [
                                {
                                    "snapshot_id": "transport-schedule-notice-355867",
                                    "route_id": "intercampus-fengtai-to-haidian",
                                    "departure_time": "08:00",
                                    "related_notice_refs": ["notice:muc_internal_portal:355867"],
                                }
                            ],
                            "transport_service_exceptions": [],
                            "transport_operational_notices": [],
                        },
                        validation_report=SimpleNamespace(valid=True, counts={}, issues=()),
                        rejected_source_records=[],
                    ),
                ),
                patch.object(
                    worker,
                    "build_transport_schedule_projection_release_from_consumption_projection",
                    return_value=release_report,
                ) as materialize_transport,
            ):
                report = worker.materialize_authenticated_notice_typed_downstream(
                    import_result={
                        "selected_notice_ids": ["355867"],
                        "typed_materialization_candidate_count": 1,
                    },
                    env={
                        "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                        "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                        "OBJECT_STORE_SECRET_KEY": "minioadmin",
                    },
                    object_store=object(),
                    operations_dir=operations_dir,
                    consumer_admission_manifest_path=consumer_manifest_path,
                    source_corpus="campus_notices",
                    source_collection="internal_notice",
                    run_id="run-001",
                    job_id="job-001",
                    generated_at="2026-05-01T10:00:00+08:00",
                )
                evidence_path = operations_dir / "typed-downstream-materialization.json"
                evidence_exists = evidence_path.exists()
                evidence = json.loads(evidence_path.read_text(encoding="utf-8"))

        self.assertEqual(report["status"], "completed")
        self.assertEqual(report["candidate_count"], 1)
        self.assertEqual(report["completed_count"], 1)
        self.assertEqual(report["materialized_releases"][0]["collection"], "transport_schedule")
        call = materialize_transport.call_args.kwargs
        self.assertEqual(call["projection_entries"], (entry,))
        self.assertEqual(call["publish_mode"], "promote")
        self.assertEqual(
            call["transport_preview_gate_report"]["buckets"]["preview_passed"],
            ["355867"],
        )
        self.assertTrue(evidence_exists)
        self.assertEqual(evidence["status"], "completed")

    def test_transport_preview_failed_returns_missing_without_release_write(self) -> None:
        entry = _transport_entry("355867")
        projection_store = _ProjectionStore((entry,))
        release_report = SimpleNamespace(
            release_id="transport-schedule-run-001-job-001",
            release_object_key="unexpected",
            current_object_key="unexpected-current",
        )
        rejected_source = {
            "schema_version": "transport_schedule_rejected_sources.v1",
            "source_notice_id": "355867",
            "source_ref": "notice:muc_internal_portal:355867",
            "reason": "no_supported_transport_schedule_rows",
            "candidate_kind": "transport_schedule",
        }
        with TemporaryDirectory() as tmpdir:
            operations_dir = Path(tmpdir) / "operations"
            consumer_manifest_path = Path(tmpdir) / "consumer-admission.json"
            consumer_manifest_path.write_text("{}", encoding="utf-8")

            with (
                patch.object(
                    worker,
                    "build_notice_consumption_projection_store_from_env",
                    return_value=projection_store,
                ),
                patch.object(worker, "build_document_registry_from_env", return_value=object()),
                patch.object(
                    worker,
                    "build_structured_projection_publisher_from_env",
                    return_value=object(),
                ),
                patch.object(
                    worker,
                    "load_internal_notice_consumer_admission_manifest",
                    return_value=SimpleNamespace(created_at="2026-05-01T10:00:00+08:00"),
                ),
                patch.object(
                    worker,
                    "check_internal_notice_consumer_admission_gate",
                    return_value=SimpleNamespace(allowed=True, reason_codes=()),
                ),
                patch.object(
                    worker,
                    "build_notice_derived_transport_schedule_projection_bundle",
                    return_value=SimpleNamespace(
                        bundle={
                            "schema_version": "campus_services_projection_bundle.v1",
                            "transport_schedule_snapshots": [],
                            "scheduled_departures": [],
                            "transport_service_exceptions": [],
                            "transport_operational_notices": [],
                            "transport_rejected_sources": [rejected_source],
                        },
                        validation_report=SimpleNamespace(valid=True, counts={}, issues=()),
                        rejected_source_records=[rejected_source],
                    ),
                ),
                patch.object(
                    worker,
                    "build_transport_schedule_projection_release_from_consumption_projection",
                    return_value=release_report,
                ) as materialize_transport,
            ):
                report = worker.materialize_authenticated_notice_typed_downstream(
                    import_result={
                        "selected_notice_ids": ["355867"],
                        "typed_materialization_candidate_count": 1,
                    },
                    env={
                        "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                        "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                        "OBJECT_STORE_SECRET_KEY": "minioadmin",
                    },
                    object_store=object(),
                    operations_dir=operations_dir,
                    consumer_admission_manifest_path=consumer_manifest_path,
                    source_corpus="campus_notices",
                    source_collection="internal_notice",
                    run_id="run-001",
                    job_id="job-001",
                    generated_at="2026-05-01T10:00:00+08:00",
                )

        self.assertEqual(report["status"], "missing")
        self.assertEqual(report["candidate_count"], 1)
        self.assertEqual(report["completed_count"], 0)
        self.assertEqual(report["failed_count"], 1)
        self.assertEqual(report["findings"][0]["code"], "transport_preview_failed")
        self.assertEqual(
            report["findings"][0]["preview_gate"]["buckets"]["preview_failed"],
            ["355867"],
        )
        self.assertEqual(
            report["findings"][0]["rejected_sources"][0]["reason"],
            "no_supported_transport_schedule_rows",
        )
        materialize_transport.assert_not_called()


class _ProjectionStore:
    def __init__(self, entries: tuple[NoticeConsumptionProjectionEntry, ...]) -> None:
        self.entries = entries
        self.notice_ids: tuple[str, ...] = ()

    def list_by_scope(self, source_corpus, source_collection, *, notice_ids=()):
        del source_corpus, source_collection
        self.notice_ids = tuple(notice_ids)
        selected = set(notice_ids)
        return tuple(
            entry for entry in self.entries if not selected or entry.source_notice_id in selected
        )


def _transport_entry(notice_id: str) -> NoticeConsumptionProjectionEntry:
    return NoticeConsumptionProjectionEntry(
        source_family=NOTICE_SOURCE_FAMILY_INTERNAL_RESTRICTED,
        source_corpus="campus_notices",
        source_collection="internal_notice",
        source_notice_id=notice_id,
        unit_id=f"notice_unit:notice:muc_internal_portal:{notice_id}:service_status_override",
        primary_role=NOTICE_PRIMARY_ROLE_SERVICE_STATUS_OVERRIDE,
        semantic_owner=NOTICE_SEMANTIC_OWNER_NOTICE_BODY,
        default_agent=NOTICE_DEFAULT_AGENT_CAMPUS_SERVICES,
        target_surface=NOTICE_TARGET_SURFACE_SERVICE_STATUS_CANDIDATE,
        temporal_policy=NOTICE_TEMPORAL_POLICY_CURRENT_OVERRIDE,
        completeness_status=NOTICE_COMPLETENESS_COMPLETE,
        answerability="answerable",
        consumption_status=NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET,
        source_notice_document_id=f"notice:muc_internal_portal:{notice_id}",
        source_document_id=f"notice:muc_internal_portal:{notice_id}",
        source_notice_release_time="2026-04-25 13:11",
        role_metadata={
            "notice_title": "关于4月27日-5月5日期间两校区班车及地铁接驳车安排的通知",
            "service_status_candidate_kind": "transport_schedule",
            "notice_family": "facility_transport_classroom_status",
        },
    )


if __name__ == "__main__":
    unittest.main()
