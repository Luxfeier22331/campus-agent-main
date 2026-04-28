from __future__ import annotations

import importlib
import io
import json
import unittest
from dataclasses import replace
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import patch

from campus_ingestion_core.internal_notice_consumer_admission_manifest import (
    CONSUMER_ADMISSION_BODY_QUALITY_PRESENT,
    CONSUMER_ADMISSION_DECISION_ADMIT,
    CONSUMER_ADMISSION_SCOPE_WRITE_MODE_UPSERT_SELECTED,
    ConsumerAdmissionDecisionRecord,
    InternalNoticeConsumerAdmissionManifest,
    compute_consumer_admission_selection_sha256,
    write_internal_notice_consumer_admission_manifest,
)
from campus_ingestion_core.models import DocumentRegistryRecord
from campus_ingestion_core.notice_consumption_projection import (
    NOTICE_ANSWERABILITY_BODY_ONLY_ANSWERABLE,
    NOTICE_COMPLETENESS_COMPLETE,
    NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET,
    NOTICE_DEFAULT_AGENT_CAMPUS_SERVICES,
    NOTICE_PRIMARY_ROLE_SERVICE_STATUS_OVERRIDE,
    NOTICE_SEMANTIC_OWNER_NOTICE_BODY,
    NOTICE_TARGET_SURFACE_SERVICE_STATUS_CANDIDATE,
    NOTICE_TEMPORAL_POLICY_CURRENT_OVERRIDE,
    NoticeConsumptionProjectionEntry,
)

from tests.ingestion.internal_notice_scoped_rule_materialization_test_support import (
    _canonical_markdown,
    _document_units,
    _record,
)
from tests.support.in_memory_registry import InMemoryDocumentRegistry

worker = importlib.import_module("campus_ingestion_worker.build_transport_schedule_projection")


class _FakeObjectStore:
    def __init__(self) -> None:
        self.objects: dict[tuple[str, str], bytes] = {}

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        return self.objects[(bucket, key)]

    def put_bytes(
        self,
        *,
        bucket: str,
        key: str,
        data: bytes,
        content_type: str,
    ) -> None:
        self.objects[(bucket, key)] = data


class _FakeStructuredProjectionPublisher:
    def __init__(self) -> None:
        self.calls: list[dict[str, object]] = []

    def publish_release(self, **kwargs: object) -> object:
        self.calls.append(dict(kwargs))
        return {"current": kwargs.get("promote_current", True)}


class _FakeProjectionStore:
    def __init__(self, entries: tuple[NoticeConsumptionProjectionEntry, ...]) -> None:
        self.entries = entries
        self.list_notice_ids: tuple[str, ...] | None = None

    def list_by_scope(
        self,
        source_corpus: str,
        source_collection: str,
        *,
        notice_ids: tuple[str, ...] = (),
    ) -> tuple[NoticeConsumptionProjectionEntry, ...]:
        self.list_notice_ids = tuple(notice_ids)
        return self.entries


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
            publisher = _FakeStructuredProjectionPublisher()

            report = worker.build_transport_schedule_projection_release_from_inventory(
                source_truth_inventory_path=inventory_path,
                source_truth_root=source_root,
                work_dir=root / "work",
                release_id="transport-schedule-20260424T090000",
                generated_at="2026-04-24T09:00:00+08:00",
                service_horizon_days=3,
                object_store=object_store,
                derived_bucket="campus-rag-derived",
                structured_projection_publisher=publisher,
            )

        self.assertEqual(report.release_id, "transport-schedule-20260424T090000")
        self.assertEqual(len(publisher.calls), 1)
        publish_call = publisher.calls[0]
        self.assertEqual(publish_call["corpus"], "campus_services")
        self.assertEqual(publish_call["collection"], "transport_schedule")
        self.assertEqual(publish_call["release_id"], "transport-schedule-20260424T090000")
        self.assertEqual(publish_call["schema_version"], "campus_services_projection_bundle.v1")
        self.assertEqual(publish_call["validation_status"], "valid")
        self.assertEqual(publish_call["artifact_object_key"], report.release_object_key)
        self.assertTrue(str(publish_call["artifact_checksum"]).startswith("sha256:"))
        self.assertEqual(
            len(publish_call["bundle"]["transport_schedule_snapshots"]),  # type: ignore[index]
            1,
        )
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
                "campus_services/releases/transport_schedule/transport-schedule-20260424T090000/rejected-source-report.json",
            ),
            object_store.objects,
        )

    def test_worker_builds_projection_release_from_consumption_projection_candidates(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            manifest_path = root / "consumer-admission-manifest.json"
            _write_consumer_manifest(manifest_path)
            object_store = _FakeObjectStore()
            publisher = _FakeStructuredProjectionPublisher()
            registry, projection_entry = _notice_projection_runtime(object_store)

            report = worker.build_transport_schedule_projection_release_from_consumption_projection(
                projection_entries=(projection_entry,),
                registry=registry,
                work_dir=root / "work",
                release_id="transport-schedule-20260320T090000",
                generated_at="2026-03-20T09:00:00+08:00",
                service_horizon_days=3,
                object_store=object_store,
                derived_bucket="campus-rag-derived",
                structured_projection_publisher=publisher,
            )

        self.assertEqual(report.release_id, "transport-schedule-20260320T090000")
        self.assertEqual(len(publisher.calls), 1)
        self.assertEqual(publisher.calls[0]["collection"], "transport_schedule")
        self.assertEqual(publisher.calls[0]["release_id"], "transport-schedule-20260320T090000")
        current_payload = json.loads(
            object_store.objects[
                (
                    "campus-rag-derived",
                    "campus_services/releases/transport_schedule/current/campus-services-projection.json",
                )
            ].decode("utf-8")
        )
        self.assertEqual(
            {
                (row["route_id"], row["departure_time"])
                for row in current_payload["scheduled_departures"]
            },
            {
                ("route:haidian-to-fengtai", "19:30"),
                ("route:fengtai-to-haidian", "07:30"),
            },
        )
        self.assertIn(
            (
                "campus-rag-derived",
                "campus_services/releases/transport_schedule/transport-schedule-20260320T090000/rejected-source-report.json",
            ),
            object_store.objects,
        )

    def test_preview_publish_mode_writes_local_artifacts_only(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            object_store = _FakeObjectStore()
            publisher = _FakeStructuredProjectionPublisher()
            registry, projection_entry = _notice_projection_runtime(object_store)

            report = worker.build_transport_schedule_projection_release_from_consumption_projection(
                projection_entries=(projection_entry,),
                registry=registry,
                work_dir=root / "work",
                release_id="transport-schedule-355122-preview",
                generated_at="2026-03-20T09:00:00+08:00",
                service_horizon_days=3,
                object_store=object_store,
                derived_bucket="campus-rag-derived",
                structured_projection_publisher=publisher,
                publish_mode="preview",
            )

        self.assertEqual(report.release_id, "transport-schedule-355122-preview")
        self.assertEqual(publisher.calls, [])
        self.assertNotIn(
            (
                "campus-rag-derived",
                "campus_services/releases/transport_schedule/transport-schedule-355122-preview/"
                "campus-services-projection.json",
            ),
            object_store.objects,
        )
        self.assertNotIn(
            (
                "campus-rag-derived",
                "campus_services/releases/transport_schedule/current/campus-services-projection.json",
            ),
            object_store.objects,
        )

    def test_stage_publish_mode_writes_versioned_release_without_current(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            object_store = _FakeObjectStore()
            publisher = _FakeStructuredProjectionPublisher()
            registry, projection_entry = _notice_projection_runtime(object_store)

            report = worker.build_transport_schedule_projection_release_from_consumption_projection(
                projection_entries=(projection_entry,),
                registry=registry,
                work_dir=root / "work",
                release_id="transport-schedule-355122-stage",
                generated_at="2026-03-20T09:00:00+08:00",
                service_horizon_days=3,
                object_store=object_store,
                derived_bucket="campus-rag-derived",
                structured_projection_publisher=publisher,
                publish_mode="stage",
            )

        self.assertEqual(report.release_id, "transport-schedule-355122-stage")
        self.assertEqual(len(publisher.calls), 1)
        self.assertFalse(publisher.calls[0]["promote_current"])
        self.assertIn(
            (
                "campus-rag-derived",
                "campus_services/releases/transport_schedule/transport-schedule-355122-stage/"
                "campus-services-projection.json",
            ),
            object_store.objects,
        )
        self.assertNotIn(
            (
                "campus-rag-derived",
                "campus_services/releases/transport_schedule/current/campus-services-projection.json",
            ),
            object_store.objects,
        )

    def test_main_requires_consumer_admission_manifest_for_typed_materialization(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            manifest_path = root / "consumer-admission-manifest.json"
            _write_consumer_manifest(manifest_path)
            object_store = _FakeObjectStore()
            publisher = _FakeStructuredProjectionPublisher()
            registry, projection_entry = _notice_projection_runtime(object_store)
            projection_store = _FakeProjectionStore((projection_entry,))

            with (
                patch(
                    "campus_ingestion_worker.build_transport_schedule_projection.load_worker_env"
                ),
                patch(
                    "campus_ingestion_worker.build_transport_schedule_projection.ObjectStoreSettings.from_env",
                    return_value=SimpleNamespace(
                        bucket_source="campus-rag-source",
                        bucket_derived="campus-rag-derived",
                    ),
                ),
                patch(
                    "campus_ingestion_worker.build_transport_schedule_projection.S3ObjectStoreAdmin",
                    return_value=object_store,
                ),
                patch(
                    "campus_ingestion_worker.build_transport_schedule_projection.build_document_registry_from_env",
                    return_value=registry,
                ),
                patch(
                    "campus_ingestion_worker.build_transport_schedule_projection.build_notice_consumption_projection_store_from_env",
                    return_value=projection_store,
                ),
                patch(
                    "campus_ingestion_worker.build_transport_schedule_projection.build_structured_projection_publisher_from_env",
                    return_value=publisher,
                ),
                patch("sys.stdout", new_callable=io.StringIO),
                self.assertRaisesRegex(ValueError, "consumer admission manifest"),
            ):
                worker.main(
                    [
                        "--from-consumption-projection",
                        "--notice-id",
                        "355122",
                        "--publish-mode",
                        "preview",
                        "--work-dir",
                        str(root / "work"),
                        "--release-id",
                        "transport-schedule-cli-355122-preview",
                        "--generated-at",
                        "2026-03-20T09:00:00+08:00",
                        "--service-horizon-days",
                        "3",
                    ]
                )

    def test_main_accepts_consumer_admission_manifest_for_typed_materialization(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            manifest_path = root / "consumer-admission-manifest.json"
            _write_consumer_manifest(manifest_path)
            object_store = _FakeObjectStore()
            publisher = _FakeStructuredProjectionPublisher()
            registry, projection_entry = _notice_projection_runtime(object_store)
            projection_store = _FakeProjectionStore((projection_entry,))

            with (
                patch(
                    "campus_ingestion_worker.build_transport_schedule_projection.load_worker_env"
                ),
                patch(
                    "campus_ingestion_worker.build_transport_schedule_projection.ObjectStoreSettings.from_env",
                    return_value=SimpleNamespace(
                        bucket_source="campus-rag-source",
                        bucket_derived="campus-rag-derived",
                    ),
                ),
                patch(
                    "campus_ingestion_worker.build_transport_schedule_projection.S3ObjectStoreAdmin",
                    return_value=object_store,
                ),
                patch(
                    "campus_ingestion_worker.build_transport_schedule_projection.build_document_registry_from_env",
                    return_value=registry,
                ),
                patch(
                    "campus_ingestion_worker.build_transport_schedule_projection.build_notice_consumption_projection_store_from_env",
                    return_value=projection_store,
                ),
                patch(
                    "campus_ingestion_worker.build_transport_schedule_projection.build_structured_projection_publisher_from_env",
                    return_value=publisher,
                ),
                patch("sys.stdout", new_callable=io.StringIO),
            ):
                worker.main(
                    [
                        "--from-consumption-projection",
                        "--notice-id",
                        "355122",
                        "--consumer-admission-manifest-path",
                        str(manifest_path),
                        "--publish-mode",
                        "preview",
                        "--work-dir",
                        str(root / "work"),
                        "--release-id",
                        "transport-schedule-cli-355122-preview",
                        "--generated-at",
                        "2026-03-20T09:00:00+08:00",
                        "--service-horizon-days",
                        "3",
                    ]
                )

        self.assertEqual(publisher.calls, [])

    def test_main_publishes_release_to_structured_projection_postgres_when_configured(
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
            publisher = _FakeStructuredProjectionPublisher()

            with (
                patch(
                    "campus_ingestion_worker.build_transport_schedule_projection.load_worker_env"
                ),
                patch(
                    "campus_ingestion_worker.build_transport_schedule_projection.ObjectStoreSettings.from_env",
                    return_value=SimpleNamespace(
                        bucket_source="campus-rag-source",
                        bucket_derived="campus-rag-derived",
                    ),
                ),
                patch(
                    "campus_ingestion_worker.build_transport_schedule_projection.S3ObjectStoreAdmin",
                    return_value=object_store,
                ),
                patch(
                    "campus_ingestion_worker.build_transport_schedule_projection.build_structured_projection_publisher_from_env",
                    return_value=publisher,
                ),
                patch("sys.stdout", new_callable=io.StringIO),
            ):
                worker.main(
                    [
                        "--source-truth-inventory",
                        str(inventory_path),
                        "--source-truth-root",
                        str(source_root),
                        "--work-dir",
                        str(root / "work"),
                        "--release-id",
                        "transport-schedule-cli-20260424T090000",
                        "--generated-at",
                        "2026-04-24T09:00:00+08:00",
                        "--service-horizon-days",
                        "3",
                    ]
                )

        self.assertEqual(len(publisher.calls), 1)
        self.assertEqual(publisher.calls[0]["collection"], "transport_schedule")

    def test_main_can_build_from_all_ready_transport_candidates(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            manifest_path = root / "consumer-admission-manifest.json"
            _write_consumer_manifest(manifest_path)
            object_store = _FakeObjectStore()
            publisher = _FakeStructuredProjectionPublisher()
            registry, projection_entry = _notice_projection_runtime(object_store)
            projection_store = _FakeProjectionStore((projection_entry,))

            with (
                patch(
                    "campus_ingestion_worker.build_transport_schedule_projection.load_worker_env"
                ),
                patch(
                    "campus_ingestion_worker.build_transport_schedule_projection.ObjectStoreSettings.from_env",
                    return_value=SimpleNamespace(
                        bucket_source="campus-rag-source",
                        bucket_derived="campus-rag-derived",
                    ),
                ),
                patch(
                    "campus_ingestion_worker.build_transport_schedule_projection.S3ObjectStoreAdmin",
                    return_value=object_store,
                ),
                patch(
                    "campus_ingestion_worker.build_transport_schedule_projection.build_document_registry_from_env",
                    return_value=registry,
                ),
                patch(
                    "campus_ingestion_worker.build_transport_schedule_projection.build_notice_consumption_projection_store_from_env",
                    return_value=projection_store,
                ),
                patch(
                    "campus_ingestion_worker.build_transport_schedule_projection.build_structured_projection_publisher_from_env",
                    return_value=publisher,
                ),
                patch("sys.stdout", new_callable=io.StringIO),
            ):
                worker.main(
                    [
                        "--from-consumption-projection",
                        "--all-ready-transport-candidates",
                        "--consumer-admission-manifest-path",
                        str(manifest_path),
                        "--work-dir",
                        str(root / "work"),
                        "--release-id",
                        "transport-schedule-cli-all-ready",
                        "--generated-at",
                        "2026-03-20T09:00:00+08:00",
                        "--service-horizon-days",
                        "3",
                    ]
                )

        self.assertEqual(projection_store.list_notice_ids, ())
        self.assertEqual(len(publisher.calls), 1)
        bundle = publisher.calls[0]["bundle"]
        self.assertEqual(len(bundle["transport_schedule_snapshots"]), 1)  # type: ignore[index]


def _write_json(path: Path, payload: dict[str, object]) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _write_jsonl(path: Path, rows: list[dict[str, object]]) -> None:
    path.write_text(
        "\n".join(json.dumps(row, ensure_ascii=False) for row in rows) + "\n",
        encoding="utf-8",
    )


def _write_consumer_manifest(path: Path) -> None:
    manifest = InternalNoticeConsumerAdmissionManifest(
        admission_run_id="transport-schedule-355122-test",
        source_channel="authenticated_notice_portal",
        corpus="campus_notices",
        collection="internal_notice",
        selection_source="explicit_notice_ids",
        selection_path="",
        selection_sha256=compute_consumer_admission_selection_sha256(("355122",)),
        scope_write_mode=CONSUMER_ADMISSION_SCOPE_WRITE_MODE_UPSERT_SELECTED,
        selected_notice_ids=("355122",),
        decision_records=(
            ConsumerAdmissionDecisionRecord(
                notice_id="355122",
                source_notice_id="355122",
                site_id="muc_internal_portal",
                raw_asset_id="raw:notice:355122",
                raw_version_id="sha256:test",
                notice_family="transport_service_status",
                suggested_consumption_route="campus_services",
                target_surface=NOTICE_TARGET_SURFACE_SERVICE_STATUS_CANDIDATE,
                consumption_status=NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET,
                admission_decision=CONSUMER_ADMISSION_DECISION_ADMIT,
                admission_reason_codes=("transport_schedule_candidate",),
                body_quality=CONSUMER_ADMISSION_BODY_QUALITY_PRESENT,
                attachment_ref_count=1,
                reference_only_attachment_ref_count=0,
                owner_expectation_count=0,
                pending_multimodal_attachment_count=0,
                attachment_document_count=1,
                unsupported_binary_count=0,
            ),
        ),
        created_at="2026-04-28T08:30:00Z",
    )
    write_internal_notice_consumer_admission_manifest(path, manifest)


def _notice_projection_runtime(
    object_store: _FakeObjectStore,
) -> tuple[InMemoryDocumentRegistry, NoticeConsumptionProjectionEntry]:
    parent = _record(
        notice_id="355122",
        title_slug="student-commute",
        content_hash="sha256:student-commute",
        body_key="campus_notices/documents/internal_notice/355122/canonical.md",
        units_key="campus_notices/documents/internal_notice/355122/document-units.jsonl",
        is_current=True,
    )
    attachment = _attachment_record(
        notice_id="355122",
        attachment_ref_id="attachment-0001",
        units_key=(
            "campus_notices/documents/internal_notice/355122/attachment-0001/document-units.jsonl"
        ),
    )
    object_store.objects[
        (
            "campus-rag-derived",
            parent.canonical_markdown_object_key,
        )
    ] = _canonical_markdown(
        "# 关于两校区学生通勤班车增加班次的通知\n\n"
        "新增班次自2026年3月20日起执行，具体见附件班次表。\n"
    )
    object_store.objects[
        (
            "campus-rag-derived",
            parent.document_units_object_key,
        )
    ] = _document_units([])
    object_store.objects[
        (
            "campus-rag-derived",
            attachment.document_units_object_key,
        )
    ] = _document_units(
        [
            {
                "unit_id": "table-1",
                "unit_type": "table_unit",
                "table_cells": [
                    ["适用日期", "运行方向", "发车时间", "乘车人员"],
                    ["工作日", "海淀校区至丰台校区", "19:30", "学生"],
                    ["", "丰台校区至海淀校区", "7:30", "学生"],
                ],
            }
        ]
    )
    projection_entry = NoticeConsumptionProjectionEntry(
        source_family="internal_notice_restricted",
        source_corpus="campus_notices",
        source_collection="internal_notice",
        source_notice_id="355122",
        unit_id="notice_unit:notice:muc_internal_portal:355122:service_status_override",
        primary_role=NOTICE_PRIMARY_ROLE_SERVICE_STATUS_OVERRIDE,
        semantic_owner=NOTICE_SEMANTIC_OWNER_NOTICE_BODY,
        default_agent=NOTICE_DEFAULT_AGENT_CAMPUS_SERVICES,
        target_surface=NOTICE_TARGET_SURFACE_SERVICE_STATUS_CANDIDATE,
        temporal_policy=NOTICE_TEMPORAL_POLICY_CURRENT_OVERRIDE,
        completeness_status=NOTICE_COMPLETENESS_COMPLETE,
        answerability=NOTICE_ANSWERABILITY_BODY_ONLY_ANSWERABLE,
        consumption_status=NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET,
        source_notice_document_id="notice:muc_internal_portal:355122",
        source_document_id="notice:muc_internal_portal:355122",
        source_attachment_ref_ids=("attachment-0001",),
        source_notice_release_time="2026-03-18 10:00",
        role_metadata={
            "service_status_candidate_kind": "transport_schedule",
            "attachment_document_ids": (
                "notice_attachment:muc_internal_portal:355122:attachment-0001",
            ),
        },
    )
    return InMemoryDocumentRegistry((parent, attachment)), projection_entry


def _attachment_record(
    *,
    notice_id: str,
    attachment_ref_id: str,
    units_key: str,
) -> DocumentRegistryRecord:
    parent = _record(
        notice_id=notice_id,
        title_slug=f"{notice_id}-{attachment_ref_id}",
        content_hash=f"sha256:{notice_id}:{attachment_ref_id}",
        body_key=units_key.replace("document-units.jsonl", "canonical.md"),
        units_key=units_key,
        is_current=True,
    )
    attachment_document_id = (
        f"notice_attachment:muc_internal_portal:{notice_id}:{attachment_ref_id}"
    )
    return replace(
        parent,
        document_id=attachment_document_id,
        version_id=f"sha256:{notice_id}:{attachment_ref_id}:source-faithful",
        source_uri=f"https://portal.example.edu/notices/{notice_id}/attachments/{attachment_ref_id}",
    )


if __name__ == "__main__":
    unittest.main()
