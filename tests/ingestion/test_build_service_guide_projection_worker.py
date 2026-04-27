from __future__ import annotations

import importlib
import io
import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import patch

from campus_ingestion_core.notice_consumption_projection import (
    NOTICE_ANSWERABILITY_BODY_ONLY_ANSWERABLE,
    NOTICE_COMPLETENESS_COMPLETE,
    NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET,
    NOTICE_DEFAULT_AGENT_CAMPUS_SERVICES,
    NOTICE_PRIMARY_ROLE_SPECIAL_SERVICE_NOTICE,
    NOTICE_SEMANTIC_OWNER_NOTICE_BODY,
    NOTICE_TARGET_SURFACE_SPECIAL_SERVICE_CANDIDATE,
    NOTICE_TEMPORAL_POLICY_TIME_WINDOWED,
    NoticeConsumptionProjectionEntry,
)
from campus_ingestion_core.service_guide_projection import (
    build_service_guide_projection_bundle_from_curated_service_guide,
)

from tests.ingestion.internal_notice_scoped_rule_materialization_test_support import (
    _canonical_markdown,
    _record,
)
from tests.support.in_memory_registry import InMemoryDocumentRegistry

worker = importlib.import_module("campus_ingestion_worker.build_service_guide_projection")


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
        return {"current": True}


class BuildServiceGuideProjectionWorkerTest(unittest.TestCase):
    def test_worker_builds_projection_release_from_source_truth_manifest(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            curated_flow_graph_path = root / "curated-flow-graph.json"
            curated_service_guide_path = Path(
                "configs/ingestion/regulations/student_rules/curated-service-guides/"
                "central-minzu-student-public-medical.v1.json"
            ).resolve()
            source_truth_manifest_path = root / "source-truth.v1.json"
            _write_json(curated_flow_graph_path, _curated_handbook_flow_graph_artifact())
            _write_json(
                source_truth_manifest_path,
                {
                    "schema_version": "campus_services_service_guide_source_truth_manifest.v1",
                    "target_corpus": "campus_services",
                    "target_collection": "service_guide",
                    "upstream_corpus": "regulations",
                    "upstream_collection": "student_rules",
                    "release_id_prefix": "service-guide-handbook",
                    "effective_from": "2018-09-01T00:00:00+08:00",
                    "effective_until": "2099-12-31T23:59:59+08:00",
                    "expected_ready_records": 5,
                    "curated_flow_graphs": [{"path": "curated-flow-graph.json"}],
                    "curated_service_guides": [{"path": str(curated_service_guide_path)}],
                },
            )
            object_store = _FakeObjectStore()
            publisher = _FakeStructuredProjectionPublisher()

            report = worker.build_service_guide_projection_release_from_source_truth_manifest(
                source_truth_manifest_path=source_truth_manifest_path,
                work_dir=root / "work",
                generated_at="2026-04-25T10:00:00+08:00",
                object_store=object_store,
                derived_bucket="campus-rag-derived",
                structured_projection_publisher=publisher,
            )

        self.assertEqual(report.release_id, "service-guide-handbook-20260425T100000")
        self.assertEqual(len(publisher.calls), 1)
        publish_call = publisher.calls[0]
        self.assertEqual(publish_call["corpus"], "campus_services")
        self.assertEqual(publish_call["collection"], "service_guide")
        self.assertEqual(publish_call["release_id"], "service-guide-handbook-20260425T100000")
        self.assertEqual(
            publish_call["schema_version"],
            "campus_services_service_guide_projection.v1",
        )
        self.assertEqual(publish_call["validation_status"], "valid")
        self.assertEqual(publish_call["artifact_object_key"], report.release_object_key)
        self.assertTrue(str(publish_call["artifact_checksum"]).startswith("sha256:"))
        self.assertEqual(
            len(publish_call["bundle"]["service_guide_records"]),  # type: ignore[index]
            5,
        )
        current_payload = json.loads(
            object_store.objects[
                (
                    "campus-rag-derived",
                    "campus_services/releases/service_guide/current/service-guide-projection.json",
                )
            ].decode("utf-8")
        )
        self.assertEqual(len(current_payload["service_guide_records"]), 5)
        self.assertEqual(
            {record["display_name"] for record in current_payload["service_guide_records"]},
            {
                "公寓楼新生办理入住手续流程",
                "公寓楼毕业生办理离校手续流程",
                "公费医疗资格与就医规则",
                "公费医疗报销办理指南",
                "公费医疗不予报销范围",
            },
        )

    def test_worker_builds_projection_release_from_curated_handbook_flow_graph(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            curated_path = root / "curated-flow-graph.json"
            _write_json(curated_path, _curated_handbook_flow_graph_artifact())
            object_store = _FakeObjectStore()
            publisher = _FakeStructuredProjectionPublisher()

            report = worker.build_service_guide_projection_release_from_curated_handbook_flow_graph(
                curated_flow_graph_path=curated_path,
                work_dir=root / "work",
                release_id="service-guide-handbook-20260425T100000",
                generated_at="2026-04-25T10:00:00+08:00",
                effective_from="2018-09-01T00:00:00+08:00",
                effective_until="2099-12-31T23:59:59+08:00",
                object_store=object_store,
                derived_bucket="campus-rag-derived",
                expected_ready_records=2,
                structured_projection_publisher=publisher,
            )

        self.assertEqual(report.release_id, "service-guide-handbook-20260425T100000")
        self.assertEqual(len(publisher.calls), 1)
        self.assertEqual(publisher.calls[0]["collection"], "service_guide")
        current_payload = json.loads(
            object_store.objects[
                (
                    "campus-rag-derived",
                    "campus_services/releases/service_guide/current/service-guide-projection.json",
                )
            ].decode("utf-8")
        )
        self.assertEqual(len(current_payload["service_guide_records"]), 2)
        self.assertEqual(
            {record["extraction_status"] for record in current_payload["service_guide_records"]},
            {"ready"},
        )
        self.assertIn(
            (
                "campus-rag-derived",
                "campus_services/releases/service_guide/service-guide-handbook-20260425T100000/manual-review-report.json",
            ),
            object_store.objects,
        )

    def test_worker_builds_combined_projection_release_from_flow_graph_and_service_guide(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            curated_flow_graph_path = root / "curated-flow-graph.json"
            curated_service_guide_path = Path(
                "configs/ingestion/regulations/student_rules/curated-service-guides/"
                "central-minzu-student-public-medical.v1.json"
            )
            _write_json(curated_flow_graph_path, _curated_handbook_flow_graph_artifact())
            object_store = _FakeObjectStore()

            report = worker.build_service_guide_projection_release_from_curated_sources(
                curated_flow_graph_paths=[curated_flow_graph_path],
                curated_service_guide_paths=[curated_service_guide_path],
                work_dir=root / "work",
                release_id="service-guide-combined-20260425T100000",
                generated_at="2026-04-25T10:00:00+08:00",
                effective_from="2018-09-01T00:00:00+08:00",
                effective_until="2099-12-31T23:59:59+08:00",
                object_store=object_store,
                derived_bucket="campus-rag-derived",
                expected_ready_records=5,
            )

        self.assertEqual(report.release_id, "service-guide-combined-20260425T100000")
        current_payload = json.loads(
            object_store.objects[
                (
                    "campus-rag-derived",
                    "campus_services/releases/service_guide/current/service-guide-projection.json",
                )
            ].decode("utf-8")
        )
        self.assertEqual(len(current_payload["service_guide_records"]), 5)
        display_names = {
            record["display_name"] for record in current_payload["service_guide_records"]
        }
        self.assertIn("公费医疗报销办理指南", display_names)
        self.assertIn("公寓楼新生办理入住手续流程", display_names)

    def test_worker_builds_projection_release_from_notice_consumption_projection_candidates(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            object_store = _FakeObjectStore()
            publisher = _FakeStructuredProjectionPublisher()
            registry, projection_entry = _notice_projection_runtime(object_store)

            report = (
                worker.build_service_guide_projection_release_from_notice_consumption_projection(
                    projection_entries=(projection_entry,),
                    registry=registry,
                    work_dir=root / "work",
                    release_id="service-guide-notice-20260427T090000",
                    generated_at="2026-04-27T09:00:00+08:00",
                    object_store=object_store,
                    derived_bucket="campus-rag-derived",
                    structured_projection_publisher=publisher,
                )
            )

        self.assertEqual(report.release_id, "service-guide-notice-20260427T090000")
        self.assertEqual(len(publisher.calls), 1)
        self.assertEqual(publisher.calls[0]["collection"], "service_guide")
        current_payload = json.loads(
            object_store.objects[
                (
                    "campus-rag-derived",
                    "campus_services/releases/service_guide/current/service-guide-projection.json",
                )
            ].decode("utf-8")
        )
        self.assertEqual(len(current_payload["service_guide_records"]), 1)
        record = current_payload["service_guide_records"][0]
        self.assertEqual(record["service_id"], "service:transport-reservation:subway-shuttle")
        self.assertEqual(record["display_name"], "地铁接驳车预约说明")
        self.assertIn(
            (
                "campus-rag-derived",
                "campus_services/releases/service_guide/service-guide-notice-20260427T090000/manual-review-report.json",
            ),
            object_store.objects,
        )

    def test_worker_merges_notice_derived_guides_with_existing_curated_guides(
        self,
    ) -> None:
        curated_service_guide_path = Path(
            "configs/ingestion/regulations/student_rules/curated-service-guides/"
            "central-minzu-student-public-medical.v1.json"
        )
        curated_result = build_service_guide_projection_bundle_from_curated_service_guide(
            curated_service_guide_artifact=json.loads(
                curated_service_guide_path.read_text(encoding="utf-8")
            ),
            generated_at="2026-04-27T09:00:00+08:00",
            effective_from="2018-09-01T00:00:00+08:00",
            effective_until="2099-12-31T23:59:59+08:00",
        )
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            object_store = _FakeObjectStore()
            registry, projection_entry = _notice_projection_runtime(object_store)

            worker.build_service_guide_projection_release_from_notice_consumption_projection(
                projection_entries=(projection_entry,),
                registry=registry,
                work_dir=root / "work",
                release_id="service-guide-combined-notice-20260427T090000",
                generated_at="2026-04-27T09:00:00+08:00",
                object_store=object_store,
                derived_bucket="campus-rag-derived",
                extra_build_results=(curated_result,),
            )

        current_payload = json.loads(
            object_store.objects[
                (
                    "campus-rag-derived",
                    "campus_services/releases/service_guide/current/service-guide-projection.json",
                )
            ].decode("utf-8")
        )
        display_names = {
            record["display_name"] for record in current_payload["service_guide_records"]
        }
        self.assertIn("公费医疗报销办理指南", display_names)
        self.assertIn("地铁接驳车预约说明", display_names)

    def test_main_builds_notice_derived_projection_from_selection_path(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            selection_path = root / "selected-notices.json"
            selection_path.write_text(
                json.dumps({"selected_notice_ids": ["354777"]}),
                encoding="utf-8",
            )
            object_store = _FakeObjectStore()
            registry, projection_entry = _notice_projection_runtime(object_store)
            projection_store = _FakeProjectionStore((projection_entry,))
            publisher = _FakeStructuredProjectionPublisher()

            with (
                patch("campus_ingestion_worker.build_service_guide_projection.load_worker_env"),
                patch(
                    "campus_ingestion_worker.build_service_guide_projection.ObjectStoreSettings.from_env",
                    return_value=SimpleNamespace(bucket_derived="campus-rag-derived"),
                ),
                patch(
                    "campus_ingestion_worker.build_service_guide_projection.S3ObjectStoreAdmin",
                    return_value=object_store,
                ),
                patch(
                    "campus_ingestion_worker.build_service_guide_projection.build_notice_consumption_projection_store_from_env",
                    return_value=projection_store,
                ),
                patch(
                    "campus_ingestion_worker.build_service_guide_projection.build_document_registry_from_env",
                    return_value=registry,
                ),
                patch(
                    "campus_ingestion_worker.build_service_guide_projection.build_structured_projection_publisher_from_env",
                    return_value=publisher,
                ),
                patch("sys.stdout", new_callable=io.StringIO) as stdout,
            ):
                worker.main(
                    [
                        "--from-notice-consumption-projection",
                        "--selection-path",
                        str(selection_path),
                        "--work-dir",
                        str(root / "work"),
                        "--release-id",
                        "service-guide-notice-cli-20260427T090000",
                        "--generated-at",
                        "2026-04-27T09:00:00+08:00",
                    ]
                )

        self.assertEqual(
            projection_store.calls,
            [
                {
                    "source_corpus": "campus_notices",
                    "source_collection": "internal_notice",
                    "notice_ids": ("354777",),
                }
            ],
        )
        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["release_id"], "service-guide-notice-cli-20260427T090000")
        self.assertEqual(len(publisher.calls), 1)
        self.assertEqual(publisher.calls[0]["collection"], "service_guide")
        current_payload = json.loads(
            object_store.objects[
                (
                    "campus-rag-derived",
                    "campus_services/releases/service_guide/current/service-guide-projection.json",
                )
            ].decode("utf-8")
        )
        self.assertEqual(
            current_payload["service_guide_records"][0]["service_id"],
            "service:transport-reservation:subway-shuttle",
        )


def _curated_handbook_flow_graph_artifact() -> dict[str, object]:
    return {
        "schemaVersion": "handbook_curated_service_flow_graph.v1",
        "projectionName": "handbook_navigation_service_catalog",
        "targetDocumentId": "campus_services:service_catalog:student-dorm-workflows",
        "sourceDocumentId": "handbook:student_rules:2018",
        "documentData": {
            "title": "中央民族大学学生公寓管理工作流程",
            "sourceHandbookSection": "中央民族大学公寓及公费医疗管理规定",
            "sourcePageStart": 252,
            "sourcePageEnd": 255,
            "manualReviewRequired": False,
            "extractionStatus": "ready",
            "pageFindings": [
                {
                    "sourcePage": 253,
                    "pageHeading": "中央民族大学学生公寓管理工作流程",
                    "flows": [
                        {
                            "flowHeading": "公寓楼新生办理入住手续流程",
                            "audienceScope": "新生",
                            "manualReviewNotes": [],
                            "steps": [
                                {
                                    "stepId": "p253-f1-s1",
                                    "stepText": "持通知书到院系注册，领取校园一卡通。",
                                    "nextStepIds": [],
                                }
                            ],
                        },
                        {
                            "flowHeading": "公寓楼毕业生办理离校手续流程",
                            "audienceScope": "毕业生",
                            "manualReviewNotes": [],
                            "steps": [
                                {
                                    "stepId": "p253-f2-s1",
                                    "stepText": "到楼长办公室。",
                                    "nextStepIds": [],
                                }
                            ],
                        },
                    ],
                }
            ],
        },
    }


def _write_json(path: Path, payload: dict[str, object]) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _notice_projection_runtime(
    object_store: _FakeObjectStore,
) -> tuple[InMemoryDocumentRegistry, NoticeConsumptionProjectionEntry]:
    parent = _record(
        notice_id="354777",
        title_slug="weekend-subway-shuttle-reservation",
        content_hash="sha256:weekend-subway-shuttle-reservation",
        body_key="campus_notices/documents/internal_notice/354777/canonical.md",
        units_key="campus_notices/documents/internal_notice/354777/document-units.jsonl",
        is_current=True,
    )
    object_store.objects[("campus-rag-derived", parent.canonical_markdown_object_key)] = (
        _canonical_markdown(
            "# 关于近期丰台校区周末地铁接驳车运营安排的通知\n\n"
            "“接驳车预约”系统可预约班次将于发车前一天9:00开放预约，"
            "约满即止。请通过服务门户或企业微信进入接驳车预约系统。"
        )
    )
    return InMemoryDocumentRegistry((parent,)), _projection_entry()


def _projection_entry() -> NoticeConsumptionProjectionEntry:
    return NoticeConsumptionProjectionEntry(
        source_family="internal_notice_restricted",
        source_corpus="campus_notices",
        source_collection="internal_notice",
        source_notice_id="354777",
        unit_id="notice_unit:notice:muc_internal_portal:354777:special_service_notice",
        primary_role=NOTICE_PRIMARY_ROLE_SPECIAL_SERVICE_NOTICE,
        semantic_owner=NOTICE_SEMANTIC_OWNER_NOTICE_BODY,
        default_agent=NOTICE_DEFAULT_AGENT_CAMPUS_SERVICES,
        target_surface=NOTICE_TARGET_SURFACE_SPECIAL_SERVICE_CANDIDATE,
        temporal_policy=NOTICE_TEMPORAL_POLICY_TIME_WINDOWED,
        completeness_status=NOTICE_COMPLETENESS_COMPLETE,
        answerability=NOTICE_ANSWERABILITY_BODY_ONLY_ANSWERABLE,
        consumption_status=NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET,
        source_notice_document_id="notice:muc_internal_portal:354777",
        source_document_id="notice:muc_internal_portal:354777",
        source_notice_release_time="2026-02-27 10:00",
        role_metadata={
            "notice_title": "关于近期丰台校区周末地铁接驳车运营安排的通知",
            "special_service_candidate_kind": "transport_reservation_instruction",
        },
    )


class _FakeProjectionStore:
    def __init__(self, entries: tuple[NoticeConsumptionProjectionEntry, ...]) -> None:
        self.entries = entries
        self.calls: list[dict[str, object]] = []

    def list_by_scope(
        self,
        source_corpus: str,
        source_collection: str,
        *,
        notice_ids: tuple[str, ...] = (),
    ) -> tuple[NoticeConsumptionProjectionEntry, ...]:
        self.calls.append(
            {
                "source_corpus": source_corpus,
                "source_collection": source_collection,
                "notice_ids": notice_ids,
            }
        )
        selected = set(notice_ids)
        return tuple(entry for entry in self.entries if entry.source_notice_id in selected)


if __name__ == "__main__":
    unittest.main()
