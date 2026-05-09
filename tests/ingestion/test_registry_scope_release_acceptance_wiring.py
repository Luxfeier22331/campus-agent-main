from __future__ import annotations

import unittest
from dataclasses import replace
from unittest.mock import Mock, patch

from campus_contracts import EvidenceBundle
from campus_ingestion_core.corpus_profiles import load_runtime_profile
from campus_ingestion_core.index_release import resolve_alias_target
from campus_ingestion_core.index_release_acceptance import evaluate_release_chunk_quality
from campus_ingestion_core.registry_scope_release import publish_scope_release
from campus_ingestion_core.sparse import build_mock_sparse_embedding_model
from campus_retrieval_core.settings import RetrievalSettings
from qdrant_client import QdrantClient

from tests.ingestion.index_release_acceptance_support import (
    _FakeAcceptanceExecutor,
    _FakeObjectStore,
    _first_uploaded_json,
    _make_chunk,
    _make_record,
    _object_store_settings,
    _write_cases,
)
from tests.ingestion.registry_scope_release_acceptance_quality_suite import (
    RegistryScopeReleaseAcceptanceQualitySuite,
)


class RegistryScopeReleaseAcceptanceWiringTest(
    RegistryScopeReleaseAcceptanceQualitySuite,
    unittest.TestCase,
):
    def test_publish_scope_release_requires_case_path_for_default_query_enabled_alias_publish(
        self,
    ) -> None:
        record = _make_record()
        qdrant_client = Mock()
        qdrant_client.get_aliases.return_value.aliases = []
        qdrant_client.collection_exists.return_value = False

        with (
            patch("campus_ingestion_core.registry_scope_release.index_chunks_to_qdrant") as index,
            patch("campus_ingestion_core.registry_scope_release.publish_release_alias") as alias,
            self.assertRaisesRegex(ValueError, "retrieval acceptance case path is required"),
        ):
            publish_scope_release(
                corpus="regulations",
                collection="student_rules",
                records=(record,),
                chunks=(_make_chunk(record=record),),
                object_store=_FakeObjectStore(),
                qdrant_client=qdrant_client,
                object_store_settings=_object_store_settings(),
                runtime_profile=load_runtime_profile("regulations", "student_rules"),
                sparse_embedding_model=object(),
                publish_alias=True,
                upsert_batch_size=128,
            )

        index.assert_not_called()
        alias.assert_not_called()

    def test_publish_scope_release_allows_no_alias_preview_without_acceptance_cases(self) -> None:
        record = _make_record()
        qdrant_client = Mock()
        qdrant_client.get_aliases.return_value.aliases = []
        qdrant_client.collection_exists.return_value = False
        object_store = _FakeObjectStore()

        with patch("campus_ingestion_core.registry_scope_release.index_chunks_to_qdrant"):
            report = publish_scope_release(
                corpus="regulations",
                collection="student_rules",
                records=(record,),
                chunks=(_make_chunk(record=record),),
                object_store=object_store,
                qdrant_client=qdrant_client,
                object_store_settings=_object_store_settings(),
                runtime_profile=load_runtime_profile("regulations", "student_rules"),
                sparse_embedding_model=object(),
                publish_alias=False,
                upsert_batch_size=128,
            )

        self.assertIsNone(report.published_at)

    def test_publish_scope_release_blocks_alias_when_acceptance_fails_and_writes_artifact(
        self,
    ) -> None:
        record = _make_record()
        qdrant_client = Mock()
        qdrant_client.get_aliases.return_value.aliases = []
        qdrant_client.collection_exists.return_value = True
        object_store = _FakeObjectStore()
        case_path = _write_cases(
            {
                "cases": [
                    {
                        "case_id": "expected-hit",
                        "corpus": "regulations",
                        "collection": "student_rules",
                        "query": "学生手册",
                        "expected_document_ids": ["student_rules:handbook"],
                    }
                ]
            }
        )

        with (
            patch("campus_ingestion_core.registry_scope_release.index_chunks_to_qdrant"),
            patch("campus_ingestion_core.registry_scope_release.publish_release_alias") as alias,
            patch(
                "campus_ingestion_core.registry_scope_release.build_release_retrieval_acceptance_executor"
            ) as build_executor,
            self.assertRaisesRegex(ValueError, "retrieval acceptance failed"),
        ):
            build_executor.return_value = _FakeAcceptanceExecutor(
                bundles={
                    "学生手册": EvidenceBundle(
                        query_text="学生手册",
                        corpus="regulations",
                        collection="student_rules",
                        sources=(),
                    )
                }
            )
            publish_scope_release(
                corpus="regulations",
                collection="student_rules",
                records=(record,),
                chunks=(_make_chunk(record=record),),
                object_store=object_store,
                qdrant_client=qdrant_client,
                object_store_settings=_object_store_settings(),
                runtime_profile=load_runtime_profile("regulations", "student_rules"),
                sparse_embedding_model=object(),
                publish_alias=True,
                upsert_batch_size=128,
                acceptance_case_path=str(case_path),
            )

        alias.assert_not_called()
        qdrant_client.delete_collection.assert_called_once()
        upload_keys = [str(item["key"]) for item in object_store.uploads]
        self.assertTrue(
            any(key.endswith("retrieval-acceptance-summary.json") for key in upload_keys)
        )

    def test_publish_scope_release_refreshes_qdrant_payload_with_final_acceptance_metadata(
        self,
    ) -> None:
        record = _make_record()
        object_store = _FakeObjectStore()
        qdrant_client = QdrantClient(location=":memory:")

        report = publish_scope_release(
            corpus="regulations",
            collection="student_rules",
            records=(record,),
            chunks=(_make_chunk(record=record),),
            object_store=object_store,
            qdrant_client=qdrant_client,
            object_store_settings=_object_store_settings(),
            runtime_profile=load_runtime_profile("regulations", "student_rules"),
            sparse_embedding_model=build_mock_sparse_embedding_model(),
            publish_alias=True,
            upsert_batch_size=128,
            qrels_coverage_issues=(),
            acceptance_case_path=str(
                _write_cases(
                    {
                        "cases": [
                            {
                                "case_id": "expected-hit",
                                "corpus": "regulations",
                                "collection": "student_rules",
                                "query": "学生手册",
                                "expected_document_ids": [record.document_id],
                            }
                        ]
                    }
                )
            ),
            retrieval_settings=RetrievalSettings(
                qdrant_url=":memory:",
                embedding_provider="mock",
                embedding_model="mock-embedding-8d",
                embedding_dimensions=3,
                sparse_provider="mock",
            ),
        )

        points, _ = qdrant_client.scroll(
            collection_name=report.physical_collection_name,
            limit=1,
            with_payload=True,
            with_vectors=False,
        )
        payload = points[0].payload or {}

        self.assertEqual(payload["retrieval_acceptance_status"], "passed")
        self.assertIsInstance(payload["retrieval_acceptance_summary_object_key"], str)
        self.assertTrue(
            str(payload["retrieval_acceptance_summary_object_key"]).endswith(
                "retrieval-acceptance-summary.json"
            )
        )
        self.assertEqual(payload["quality_gate_status"], "passed")
        self.assertIsInstance(payload["quality_gate_summary_object_key"], str)

    def test_publish_scope_release_attaches_component_eval_summary_to_manifest_report_and_payload(
        self,
    ) -> None:
        record = _make_record()
        object_store = _FakeObjectStore()
        qdrant_client = QdrantClient(location=":memory:")
        component_eval_summary = {
            "schema_version": 1,
            "case_family": "answer_ready_component_eval.v1",
            "summary": {
                "total": 4,
                "passed": 4,
                "failed": 0,
                "overall_passed": True,
                "primary_failure_stage_counts": {},
                "secondary_failure_stage_counts": {},
                "scope_failure_counts": {},
                "gate_failure_counts": {},
            },
            "results": [],
        }

        report = publish_scope_release(
            corpus="regulations",
            collection="student_rules",
            records=(record,),
            chunks=(_make_chunk(record=record),),
            object_store=object_store,
            qdrant_client=qdrant_client,
            object_store_settings=_object_store_settings(),
            runtime_profile=load_runtime_profile("regulations", "student_rules"),
            sparse_embedding_model=build_mock_sparse_embedding_model(),
            publish_alias=True,
            upsert_batch_size=128,
            qrels_coverage_issues=(),
            acceptance_case_path=str(
                _write_cases(
                    {
                        "cases": [
                            {
                                "case_id": "expected-hit",
                                "corpus": "regulations",
                                "collection": "student_rules",
                                "query": "学生手册",
                                "expected_document_ids": [record.document_id],
                            }
                        ]
                    }
                )
            ),
            retrieval_settings=RetrievalSettings(
                qdrant_url=":memory:",
                embedding_provider="mock",
                embedding_model="mock-embedding-8d",
                embedding_dimensions=3,
                sparse_provider="mock",
            ),
            component_eval_summary=component_eval_summary,
        )

        points, _ = qdrant_client.scroll(
            collection_name=report.physical_collection_name,
            limit=1,
            with_payload=True,
            with_vectors=False,
        )
        payload = points[0].payload or {}

        self.assertEqual(report.component_eval_status, "passed")
        self.assertIsInstance(report.component_eval_summary_object_key, str)
        self.assertTrue(
            str(report.component_eval_summary_object_key).endswith("component-eval-summary.json")
        )
        self.assertEqual(payload["component_eval_status"], "passed")
        self.assertEqual(
            payload["component_eval_summary_object_key"],
            report.component_eval_summary_object_key,
        )
        component_eval_upload = _first_uploaded_json(
            object_store,
            filename="component-eval-summary.json",
        )
        self.assertEqual(component_eval_upload["summary"]["overall_passed"], True)

    def test_publish_scope_release_rolls_back_alias_when_post_publish_audit_fails(
        self,
    ) -> None:
        class _MissingManifestObjectStore(_FakeObjectStore):
            def put_bytes(
                self,
                *,
                bucket: str,
                key: str,
                data: bytes,
                content_type: str,
            ) -> None:
                super().put_bytes(bucket=bucket, key=key, data=data, content_type=content_type)
                if key.endswith("index-release.json"):
                    self.objects.pop((bucket, key), None)

        record = _make_record()
        object_store = _MissingManifestObjectStore()
        qdrant_client = QdrantClient(location=":memory:")

        with self.assertRaisesRegex(ValueError, "post-publish release audit failed"):
            publish_scope_release(
                corpus="regulations",
                collection="student_rules",
                records=(record,),
                chunks=(_make_chunk(record=record),),
                object_store=object_store,
                qdrant_client=qdrant_client,
                object_store_settings=_object_store_settings(),
                runtime_profile=load_runtime_profile("regulations", "student_rules"),
                sparse_embedding_model=build_mock_sparse_embedding_model(),
                publish_alias=True,
                upsert_batch_size=128,
                qrels_coverage_issues=(),
                acceptance_case_path=str(
                    _write_cases(
                        {
                            "cases": [
                                {
                                    "case_id": "expected-hit",
                                    "corpus": "regulations",
                                    "collection": "student_rules",
                                    "query": "学生手册",
                                    "expected_document_ids": [record.document_id],
                                }
                            ]
                        }
                    )
                ),
                retrieval_settings=RetrievalSettings(
                    qdrant_url=":memory:",
                    embedding_provider="mock",
                    embedding_model="mock-embedding-8d",
                    embedding_dimensions=3,
                    sparse_provider="mock",
                ),
            )

        self.assertIsNone(
            resolve_alias_target(qdrant_client=qdrant_client, alias_name="student_rules")
        )

    def test_publish_scope_release_blocks_query_serving_alias_when_chunk_quality_fails(
        self,
    ) -> None:
        record = _make_record()
        qdrant_client = Mock()
        qdrant_client.get_aliases.return_value.aliases = []
        qdrant_client.collection_exists.return_value = False
        object_store = _FakeObjectStore()
        bad_chunk = replace(
            _make_chunk(record=record),
            metadata={
                "unit_type": "section_text",
                "final_token_count": 32,
                "chunk_policy_version": "student_rules_semantic_v3",
                "cleaning_policy_version": "student_rules_cleaning_v1",
            },
        )

        with (
            patch("campus_ingestion_core.registry_scope_release.index_chunks_to_qdrant") as index,
            patch("campus_ingestion_core.registry_scope_release.publish_release_alias") as alias,
            self.assertRaisesRegex(ValueError, "release quality gate failed"),
        ):
            publish_scope_release(
                corpus="regulations",
                collection="student_rules",
                records=(record,),
                chunks=(bad_chunk,),
                object_store=object_store,
                qdrant_client=qdrant_client,
                object_store_settings=_object_store_settings(),
                runtime_profile=load_runtime_profile("regulations", "student_rules"),
                sparse_embedding_model=object(),
                publish_alias=True,
                upsert_batch_size=128,
                qrels_coverage_issues=(),
                acceptance_case_path=str(
                    _write_cases(
                        {
                            "cases": [
                                {
                                    "case_id": "expected-hit",
                                    "corpus": "regulations",
                                    "collection": "student_rules",
                                    "query": "学生手册",
                                    "expected_document_ids": ["student_rules:handbook"],
                                }
                            ]
                        }
                    )
                ),
            )

        index.assert_not_called()
        alias.assert_not_called()
        upload_keys = [str(item["key"]) for item in object_store.uploads]
        self.assertTrue(any(key.endswith("quality-gate-summary.json") for key in upload_keys))

    def test_publish_scope_release_blocks_student_rules_when_answer_ready_contract_missing(
        self,
    ) -> None:
        record = _make_record()
        qdrant_client = Mock()
        qdrant_client.get_aliases.return_value.aliases = []
        qdrant_client.collection_exists.return_value = False
        object_store = _FakeObjectStore()
        bad_chunk = replace(
            _make_chunk(record=record),
            text="学习成绩排名与综合考评成绩排名原则上均应位于前10%。",
            metadata={
                "unit_type": "article_body",
                "root_unit_id": "student_rules:handbook:article-rank",
                "parent_unit_id": "student_rules:handbook:article-rank",
                "display_text": "学习成绩排名与综合考评成绩排名原则上均应位于前10%。",
                "final_token_count": 32,
                "chunk_policy_version": "student_rules_semantic_v3",
                "answer_role": "eligibility_condition",
                "content_role": "eligibility",
                "claim_type": "condition",
                "role_confidence": "high",
                "is_answer_bearing": True,
            },
        )

        with (
            patch("campus_ingestion_core.registry_scope_release.index_chunks_to_qdrant") as index,
            patch("campus_ingestion_core.registry_scope_release.publish_release_alias") as alias,
            self.assertRaisesRegex(ValueError, "answer_ready_contract_status"),
        ):
            publish_scope_release(
                corpus="regulations",
                collection="student_rules",
                records=(record,),
                chunks=(bad_chunk,),
                object_store=object_store,
                qdrant_client=qdrant_client,
                object_store_settings=_object_store_settings(),
                runtime_profile=load_runtime_profile("regulations", "student_rules"),
                sparse_embedding_model=object(),
                publish_alias=True,
                upsert_batch_size=128,
                qrels_coverage_issues=(),
                acceptance_case_path=str(
                    _write_cases(
                        {
                            "cases": [
                                {
                                    "case_id": "expected-hit",
                                    "corpus": "regulations",
                                    "collection": "student_rules",
                                    "query": "学生手册",
                                    "expected_document_ids": ["student_rules:handbook"],
                                }
                            ]
                        }
                    )
                ),
            )

        index.assert_not_called()
        alias.assert_not_called()
        quality_summary = _first_uploaded_json(object_store, filename="quality-gate-summary.json")
        self.assertEqual(quality_summary["answer_ready_contract_status"], "failed")
        self.assertEqual(
            quality_summary["answer_ready_contract_version"],
            "answer_ready_evidence.v3",
        )
        self.assertIn("chunk_contract_missing", quality_summary["failure_classes"])
        self.assertIn(
            "answer_ready_condition_subject_missing",
            quality_summary["answer_ready_required_field_failures"],
        )
        self.assertEqual(quality_summary["answer_ready_semantic_failures"], [])
        self.assertEqual(quality_summary["fallback_budget_status"], "not_applicable")
        self.assertIn(
            "answer_ready_condition_subject_missing",
            quality_summary["issues_by_chunk_id"]["student_rules:handbook:chunk-0001"],
        )

    def test_publish_scope_release_uses_collection_chunk_profile_budget(self) -> None:
        record = replace(
            _make_record(),
            document_id="institutional_regulation:muc:procurement",
            corpus="regulations",
            collection="institutional_rules",
            cleaning_policy_version="institutional_rules_cleaning_v1",
            document_units_object_key="regulations/institutional_rules/procurement/document-units.jsonl",
            processed_object_keys=(
                "regulations/institutional_rules/procurement/document-units.jsonl",
            ),
        )
        qdrant_client = Mock()
        qdrant_client.get_aliases.return_value.aliases = []
        qdrant_client.collection_exists.return_value = False
        oversized_chunk = replace(
            _make_chunk(record=record),
            document_id=record.document_id,
            chunk_id="institutional_regulation:muc:procurement:chunk-0001",
            corpus="regulations",
            collection="institutional_rules",
            metadata={
                "unit_type": "section_text",
                "root_unit_id": "institutional_regulation:muc:procurement:root-0001",
                "final_token_count": 361,
                "chunk_policy_version": "institutional_rules_semantic_v1",
                "cleaning_policy_version": "institutional_rules_cleaning_v1",
            },
        )
        object_store = _FakeObjectStore()

        with (
            patch("campus_ingestion_core.registry_scope_release.index_chunks_to_qdrant") as index,
            patch("campus_ingestion_core.registry_scope_release.publish_release_alias") as alias,
            self.assertRaisesRegex(ValueError, "token_count_exceeds_budget"),
        ):
            publish_scope_release(
                corpus="regulations",
                collection="institutional_rules",
                records=(record,),
                chunks=(oversized_chunk,),
                object_store=object_store,
                qdrant_client=qdrant_client,
                object_store_settings=_object_store_settings(),
                runtime_profile=load_runtime_profile("regulations", "institutional_rules"),
                sparse_embedding_model=object(),
                publish_alias=True,
                upsert_batch_size=128,
                qrels_coverage_issues=(),
                acceptance_case_path=str(
                    _write_cases(
                        {
                            "cases": [
                                {
                                    "case_id": "expected-hit",
                                    "corpus": "regulations",
                                    "collection": "institutional_rules",
                                    "query": "采购工作管理办法",
                                    "expected_document_ids": [record.document_id],
                                }
                            ]
                        }
                    )
                ),
            )

        index.assert_not_called()
        alias.assert_not_called()
        quality_summary = _first_uploaded_json(object_store, filename="quality-gate-summary.json")
        self.assertEqual(quality_summary["max_token_count"], 360)
        self.assertEqual(quality_summary["max_token_count_source"], "collection_chunk_profile")

    def test_publish_scope_release_blocks_query_serving_alias_when_qrels_coverage_fails(
        self,
    ) -> None:
        record = _make_record()
        qdrant_client = Mock()
        qdrant_client.get_aliases.return_value.aliases = []
        qdrant_client.collection_exists.return_value = False
        object_store = _FakeObjectStore()

        with (
            patch("campus_ingestion_core.registry_scope_release.index_chunks_to_qdrant") as index,
            patch("campus_ingestion_core.registry_scope_release.publish_release_alias") as alias,
            self.assertRaisesRegex(ValueError, "qrels_coverage_status"),
        ):
            publish_scope_release(
                corpus="regulations",
                collection="student_rules",
                records=(record,),
                chunks=(_make_chunk(record=record),),
                object_store=object_store,
                qdrant_client=qdrant_client,
                object_store_settings=_object_store_settings(),
                runtime_profile=load_runtime_profile("regulations", "student_rules"),
                sparse_embedding_model=object(),
                publish_alias=True,
                upsert_batch_size=128,
                qrels_coverage_issues=("regulations/student_rules: missing qrels scenario no_hit",),
                acceptance_case_path=str(
                    _write_cases(
                        {
                            "cases": [
                                {
                                    "case_id": "expected-hit",
                                    "corpus": "regulations",
                                    "collection": "student_rules",
                                    "query": "学生手册",
                                    "expected_document_ids": ["student_rules:handbook"],
                                }
                            ]
                        }
                    )
                ),
            )

        index.assert_not_called()
        alias.assert_not_called()
        quality_summary = _first_uploaded_json(object_store, filename="quality-gate-summary.json")
        self.assertEqual(quality_summary["qrels_coverage_status"], "failed")
        self.assertEqual(
            quality_summary["qrels_coverage_issues"],
            ["regulations/student_rules: missing qrels scenario no_hit"],
        )

    def test_evaluate_release_chunk_quality_reports_traceability_and_budget_issues(self) -> None:
        record = _make_record()
        report = evaluate_release_chunk_quality(
            chunks=(
                replace(
                    _make_chunk(record=record),
                    metadata={
                        "unit_type": "section_text",
                        "final_token_count": 4097,
                        "chunk_policy_version": "student_rules_semantic_v3",
                    },
                ),
            ),
            max_token_count=2048,
        )

        self.assertEqual(report.status, "failed")
        self.assertEqual(report.chunk_quality_status, "failed")
        self.assertIn("student_rules:handbook:chunk-0001", report.summary["issues_by_chunk_id"])
        self.assertIn(
            "missing_root_unit_id",
            report.summary["issues_by_chunk_id"]["student_rules:handbook:chunk-0001"],
        )
        self.assertIn(
            "token_count_exceeds_budget",
            report.summary["issues_by_chunk_id"]["student_rules:handbook:chunk-0001"],
        )

    def test_evaluate_release_chunk_quality_rejects_semantic_non_evidence_chunks(self) -> None:
        record = _make_record()
        report = evaluate_release_chunk_quality(
            chunks=(
                replace(
                    _make_chunk(record=record),
                    chunk_id="student_rules:handbook:chunk-attachment-ref",
                    metadata={
                        "unit_type": "attachment_ref",
                        "root_unit_id": "student_rules:handbook:root-attachment",
                        "final_token_count": 8,
                        "chunk_policy_version": "student_rules_semantic_v3",
                    },
                ),
                replace(
                    _make_chunk(record=record),
                    chunk_id="student_rules:handbook:chunk-heading-only",
                    text="总则",
                    anchor={"section_path": ["总则"]},
                    metadata={
                        "unit_type": "section_text",
                        "root_unit_id": "student_rules:handbook:root-heading",
                        "final_token_count": 2,
                        "chunk_policy_version": "student_rules_semantic_v3",
                    },
                ),
            ),
            max_token_count=512,
        )

        self.assertEqual(report.status, "failed")
        self.assertIn(
            "attachment_ref_not_query_serving_chunk",
            report.summary["issues_by_chunk_id"]["student_rules:handbook:chunk-attachment-ref"],
        )
        self.assertIn(
            "heading_only_chunk",
            report.summary["issues_by_chunk_id"]["student_rules:handbook:chunk-heading-only"],
        )

    def test_evaluate_release_chunk_quality_rejects_context_only_chunk_text(self) -> None:
        record = _make_record()
        report = evaluate_release_chunk_quality(
            chunks=(
                replace(
                    _make_chunk(record=record),
                    chunk_id="student_rules:handbook:chunk-context-only",
                    text="第一章 总则",
                    metadata={
                        "unit_type": "section_text",
                        "root_unit_id": "student_rules:handbook:root-context-only",
                        "display_text": "学生应当按学校规定办理注册手续。",
                        "contextualized_text": True,
                        "header_token_count": 4,
                        "final_token_count": 8,
                        "chunk_policy_version": "student_rules_semantic_v3",
                    },
                ),
            ),
            max_token_count=512,
        )

        self.assertEqual(report.status, "failed")
        self.assertIn(
            "display_text_not_in_chunk_text",
            report.summary["issues_by_chunk_id"]["student_rules:handbook:chunk-context-only"],
        )


if __name__ == "__main__":
    unittest.main()
