from __future__ import annotations

import importlib
import io
import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import patch

from campus_ingestion_core.internal_notice_consumer_admission_manifest import (
    CONSUMER_ADMISSION_DECISION_ADMIT,
    CONSUMER_ADMISSION_SCOPE_WRITE_MODE_UPSERT_SELECTED,
    CONSUMER_ADMISSION_STATUS_CANDIDATE_FOR_TYPED_MATERIALIZATION,
    ConsumerAdmissionDecisionRecord,
    InternalNoticeConsumerAdmissionManifest,
    compute_consumer_admission_selection_sha256,
    write_internal_notice_consumer_admission_manifest,
)
from campus_ingestion_core.notice_consumption_projection import (
    NOTICE_TARGET_SURFACE_SERVICE_STATUS_CANDIDATE,
)

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

    def test_main_requires_consumer_admission_manifest_for_projection_mode(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            with (
                patch("campus_ingestion_worker.build_service_status_projection.load_worker_env"),
                self.assertRaisesRegex(ValueError, "consumer admission manifest"),
            ):
                worker.main(
                    [
                        "--from-consumption-projection",
                        "--notice-id",
                        "353903",
                        "--work-dir",
                        str(root / "work"),
                        "--release-id",
                        "service-status-20260427T120000",
                    ]
                )

    def test_main_blocks_when_consumer_manifest_gate_rejects_target_surface(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            manifest_path = root / "consumer-admission-manifest.json"
            _write_consumer_manifest(
                manifest_path,
                notice_ids=("353903",),
                target_surface="campus_services/special_service_candidate",
                scope_write_mode=CONSUMER_ADMISSION_SCOPE_WRITE_MODE_UPSERT_SELECTED,
            )
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
            projection_store = _FakeProjectionStore((entry,))
            with (
                patch("campus_ingestion_worker.build_service_status_projection.load_worker_env"),
                patch(
                    "campus_ingestion_worker.build_service_status_projection.ObjectStoreSettings.from_env",
                    return_value=SimpleNamespace(bucket_derived="campus-rag-derived"),
                ),
                patch(
                    "campus_ingestion_worker.build_service_status_projection.S3ObjectStoreAdmin",
                    return_value=object_store,
                ),
                patch(
                    "campus_ingestion_worker.build_service_status_projection.build_notice_consumption_projection_store_from_env",
                    return_value=projection_store,
                ),
                patch(
                    "campus_ingestion_worker.build_service_status_projection.build_document_registry_from_env",
                    return_value=registry,
                ),
                patch("sys.stdout", new_callable=io.StringIO),
                self.assertRaisesRegex(ValueError, "consumer admission manifest gate blocked"),
            ):
                worker.main(
                    [
                        "--from-consumption-projection",
                        "--notice-id",
                        "353903",
                        "--consumer-admission-manifest-path",
                        str(manifest_path),
                        "--work-dir",
                        str(root / "work"),
                        "--release-id",
                        "service-status-20260427T120000",
                        "--generated-at",
                        "2026-04-27T12:00:00+08:00",
                    ]
                )

    def test_main_blocks_all_ready_without_replace_scope_manifest(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            manifest_path = root / "consumer-admission-manifest.json"
            _write_consumer_manifest(
                manifest_path,
                notice_ids=("353903",),
                target_surface=NOTICE_TARGET_SURFACE_SERVICE_STATUS_CANDIDATE,
                scope_write_mode=CONSUMER_ADMISSION_SCOPE_WRITE_MODE_UPSERT_SELECTED,
            )
            with (
                patch("campus_ingestion_worker.build_service_status_projection.load_worker_env"),
                self.assertRaisesRegex(ValueError, "replace_scope"),
            ):
                worker.main(
                    [
                        "--from-consumption-projection",
                        "--all-ready-service-status-candidates",
                        "--consumer-admission-manifest-path",
                        str(manifest_path),
                        "--work-dir",
                        str(root / "work"),
                        "--release-id",
                        "service-status-20260427T120000",
                    ]
                )


class _FakeProjectionStore:
    def __init__(self, entries):
        self.entries = tuple(entries)
        self.calls: list[dict[str, object]] = []

    def list_by_scope(
        self,
        source_corpus: str,
        source_collection: str,
        *,
        notice_ids=(),
    ):
        self.calls.append(
            {
                "source_corpus": source_corpus,
                "source_collection": source_collection,
                "notice_ids": tuple(notice_ids),
            }
        )
        selected = set(notice_ids)
        if not selected:
            return self.entries
        return tuple(entry for entry in self.entries if entry.source_notice_id in selected)


def _write_consumer_manifest(
    path: Path,
    *,
    notice_ids: tuple[str, ...],
    target_surface: str,
    scope_write_mode: str,
) -> None:
    manifest = InternalNoticeConsumerAdmissionManifest(
        admission_run_id="consumer-admission-test",
        source_channel="authenticated_notice_portal",
        corpus="campus_notices",
        collection="internal_notice",
        selection_source="bundle_dry_run",
        selection_path="bundle.json",
        selection_sha256=compute_consumer_admission_selection_sha256(notice_ids),
        scope_write_mode=scope_write_mode,
        selected_notice_ids=notice_ids,
        decision_records=tuple(
            ConsumerAdmissionDecisionRecord(
                notice_id=notice_id,
                source_notice_id=notice_id,
                site_id="muc_internal_portal",
                raw_asset_id=f"asset:authenticated-notice:muc_internal_portal:{notice_id}",
                raw_version_id=f"sha256:bundle:{notice_id}",
                notice_family="service_status_override",
                suggested_consumption_route="service_status_candidate",
                target_surface=target_surface,
                consumption_status=CONSUMER_ADMISSION_STATUS_CANDIDATE_FOR_TYPED_MATERIALIZATION,
                admission_decision=CONSUMER_ADMISSION_DECISION_ADMIT,
                admission_reason_codes=("service_status_candidate",),
                body_quality="body_present",
                attachment_ref_count=0,
                reference_only_attachment_ref_count=0,
                owner_expectation_count=0,
                pending_multimodal_attachment_count=0,
            )
            for notice_id in notice_ids
        ),
        created_at="2026-04-27T00:00:00+00:00",
    )
    write_internal_notice_consumer_admission_manifest(path, manifest)
