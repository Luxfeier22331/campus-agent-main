from __future__ import annotations

import importlib
import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

worker = importlib.import_module("campus_ingestion_worker.build_service_guide_projection")


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

            report = worker.build_service_guide_projection_release_from_source_truth_manifest(
                source_truth_manifest_path=source_truth_manifest_path,
                work_dir=root / "work",
                generated_at="2026-04-25T10:00:00+08:00",
                object_store=object_store,
                derived_bucket="campus-rag-derived",
            )

        self.assertEqual(report.release_id, "service-guide-handbook-20260425T100000")
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
            )

        self.assertEqual(report.release_id, "service-guide-handbook-20260425T100000")
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


if __name__ == "__main__":
    unittest.main()
