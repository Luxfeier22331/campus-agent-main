from __future__ import annotations

import json
import unittest
from dataclasses import replace
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import Mock, patch

from campus_contracts import EvidenceBundle, EvidenceSource
from campus_ingestion_core.corpus_profiles import load_runtime_profile
from campus_ingestion_core.index_release_acceptance import (
    QdrantPhysicalCollectionAcceptanceExecutor,
    ReleaseRetrievalAcceptanceExecutor,
    evaluate_release_chunk_quality,
    load_release_retrieval_acceptance_cases,
    run_release_retrieval_acceptance,
)
from campus_ingestion_core.index_release import resolve_alias_target
from campus_ingestion_core.models import DocumentRegistryRecord
from campus_ingestion_core.process import IndexableChunk
from campus_ingestion_core.process_indexing import index_chunks_to_qdrant
from campus_ingestion_core.registry_scope_release import publish_scope_release
from campus_ingestion_core.settings import ObjectStoreSettings
from campus_ingestion_core.sparse import build_mock_sparse_embedding_model
from campus_retrieval_core.settings import RetrievalSettings
from qdrant_client import QdrantClient

_REPO_ROOT = Path(__file__).resolve().parents[2]
_STUDENT_RULES_RELEASE_ACCEPTANCE_PATH = (
    _REPO_ROOT / "packages/evals/fixtures/student_rules_release_acceptance.v1.json"
)


class _FakeObjectStore:
    def __init__(self) -> None:
        self.uploads: list[dict[str, object]] = []
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
        self.uploads.append(
            {
                "bucket": bucket,
                "key": key,
                "data": data,
                "content_type": content_type,
            }
        )
        self.objects[(bucket, key)] = data


class _FakeAcceptanceExecutor(ReleaseRetrievalAcceptanceExecutor):
    def __init__(self, *, bundles: dict[str, EvidenceBundle]) -> None:
        self.bundles = bundles
        self.requests: list[tuple[str, str, str]] = []

    def retrieve(
        self,
        *,
        physical_collection_name: str,
        corpus: str,
        collection: str,
        query: str,
        top_k: int,
        target_document_ids: tuple[str, ...],
        target_version_ids: tuple[str, ...],
        target_revision_track: str,
        entitlement_groups: tuple[str, ...],
        visibility_level: str,
        visibility_scope: str | None,
    ) -> EvidenceBundle:
        self.requests.append((physical_collection_name, corpus, collection))
        return self.bundles[query]


class _FakeEmbeddingModel:
    def get_query_embedding(self, _query: str) -> tuple[float, float, float]:
        return (0.1, 0.2, 0.3)


class _FakeQdrantQueryResponse:
    points: tuple[()] = ()


class _FakeRemoteQdrantClient:
    def __init__(self) -> None:
        self.timeout: object | None = None

    def query_points(self, **kwargs: object) -> _FakeQdrantQueryResponse:
        self.timeout = kwargs.get("timeout")
        return _FakeQdrantQueryResponse()


class IndexReleaseAcceptanceTest(unittest.TestCase):
    def test_student_rules_release_acceptance_fixture_loads_for_alias_publish(self) -> None:
        cases = load_release_retrieval_acceptance_cases(
            _STUDENT_RULES_RELEASE_ACCEPTANCE_PATH,
            corpus="regulations",
            collection="student_rules",
        )

        self.assertGreaterEqual(len(cases), 15)
        case_by_id = {case.case_id: case for case in cases}
        self.assertEqual(
            case_by_id["policy-title-medical"].expected_document_ids,
            ("handbook:b85de1cb327a26dc63488e247403ae3126d524be",),
        )
        self.assertEqual(
            case_by_id["policy-title-medical"].expected_version_ids,
            (),
        )
        self.assertEqual(
            case_by_id["policy-title-national-encouragement-scholarship"].forbidden_document_ids,
            ("handbook:55f7a1b27590bdc59c099f37d84cfa097356ce15",),
        )
        self.assertNotIn("no-hit-impossible-query", case_by_id)

    def test_load_release_retrieval_acceptance_cases_rejects_empty_case_file(self) -> None:
        with TemporaryDirectory() as temp_dir:
            case_path = Path(temp_dir) / "cases.json"
            case_path.write_text(json.dumps({"cases": []}), encoding="utf-8")

            with self.assertRaisesRegex(ValueError, "must contain at least one acceptance case"):
                load_release_retrieval_acceptance_cases(
                    case_path,
                    corpus="regulations",
                    collection="student_rules",
                )

    def test_run_release_retrieval_acceptance_validates_hits_no_hit_and_backlinks(self) -> None:
        hit_source = EvidenceSource(
            doc_id="student_rules:handbook",
            revision_track="current-effective",
            version_id="sha256:handbook-v1",
            chunk_id="student_rules:handbook:chunk-0001",
            anchor={"section_path": ["总则"]},
            canonical_url="https://docs.example/handbook",
            latest_url="https://docs.example/handbook",
            source_channel="manual_curated",
            collection="student_rules",
            is_current=True,
            snippet="学生手册正文",
            score=0.99,
        )
        executor = _FakeAcceptanceExecutor(
            bundles={
                "学生手册": EvidenceBundle(
                    query_text="学生手册",
                    corpus="regulations",
                    collection="student_rules",
                    sources=(hit_source,),
                ),
                "不存在的制度": EvidenceBundle(
                    query_text="不存在的制度",
                    corpus="regulations",
                    collection="student_rules",
                    sources=(),
                ),
            }
        )
        cases = load_release_retrieval_acceptance_cases(
            _write_cases(
                {
                    "cases": [
                        {
                            "case_id": "student-rules-hit",
                            "corpus": "regulations",
                            "collection": "student_rules",
                            "query": "学生手册",
                            "expected_document_ids": ["student_rules:handbook"],
                            "expected_version_ids": ["sha256:handbook-v1"],
                            "expected_chunk_ids": ["student_rules:handbook:chunk-0001"],
                            "top_k": 3,
                        },
                        {
                            "case_id": "student-rules-negative",
                            "corpus": "regulations",
                            "collection": "student_rules",
                            "query": "不存在的制度",
                            "expected_no_hit": True,
                            "top_k": 3,
                        },
                    ]
                }
            ),
            corpus="regulations",
            collection="student_rules",
        )

        result = run_release_retrieval_acceptance(
            cases=cases,
            executor=executor,
            physical_collection_name="student_rules__r20260430_test",
        )

        self.assertEqual(result.status, "passed")
        self.assertEqual(result.summary["case_count"], 2)
        self.assertEqual(result.summary["failed_case_ids"], [])
        self.assertEqual(
            executor.requests,
            [
                ("student_rules__r20260430_test", "regulations", "student_rules"),
                ("student_rules__r20260430_test", "regulations", "student_rules"),
            ],
        )

    def test_run_release_retrieval_acceptance_fails_on_forbidden_hit(self) -> None:
        forbidden = EvidenceSource(
            doc_id="student_rules:forbidden",
            revision_track="current-effective",
            version_id="sha256:forbidden",
            chunk_id="student_rules:forbidden:chunk-0001",
            anchor={},
            canonical_url="https://docs.example/forbidden",
            latest_url="https://docs.example/forbidden",
            source_channel="manual_curated",
            collection="student_rules",
            is_current=True,
            snippet="不应命中的正文",
            score=0.91,
        )
        cases = load_release_retrieval_acceptance_cases(
            _write_cases(
                {
                    "cases": [
                        {
                            "case_id": "forbidden-hit",
                            "corpus": "regulations",
                            "collection": "student_rules",
                            "query": "学生手册",
                            "forbidden_document_ids": ["student_rules:forbidden"],
                        }
                    ]
                }
            ),
            corpus="regulations",
            collection="student_rules",
        )

        result = run_release_retrieval_acceptance(
            cases=cases,
            executor=_FakeAcceptanceExecutor(
                bundles={
                    "学生手册": EvidenceBundle(
                        query_text="学生手册",
                        corpus="regulations",
                        collection="student_rules",
                        sources=(forbidden,),
                    )
                }
            ),
            physical_collection_name="student_rules__r20260430_test",
        )

        self.assertEqual(result.status, "failed")
        self.assertEqual(result.summary["failed_case_ids"], ["forbidden-hit"])
        self.assertIn("forbidden_document_ids", result.summary["cases"][0]["failures"])

    def test_physical_collection_executor_reads_new_collection_without_alias(self) -> None:
        record = _make_record()
        chunk = _make_chunk(record=record)
        qdrant_client = QdrantClient(location=":memory:")
        sparse_embedding_model = build_mock_sparse_embedding_model()
        profile = load_runtime_profile("regulations", "student_rules")
        physical_collection_name = "student_rules__r20260430_acceptance"
        index_chunks_to_qdrant(
            chunks=(chunk,),
            qdrant_client=qdrant_client,
            collection_name=physical_collection_name,
            sparse_embedding_model=sparse_embedding_model,
        )
        executor = QdrantPhysicalCollectionAcceptanceExecutor(
            qdrant_client=qdrant_client,
            settings=RetrievalSettings(
                qdrant_url=":memory:",
                embedding_provider="mock",
                embedding_model="mock-embedding-8d",
                embedding_dimensions=3,
                sparse_provider="mock",
            ),
            runtime_profile=profile,
            sparse_embedding_model=sparse_embedding_model,
        )

        bundle = executor.retrieve(
            physical_collection_name=physical_collection_name,
            corpus="regulations",
            collection="student_rules",
            query="学生手册",
            top_k=3,
            target_document_ids=(),
            target_version_ids=(),
            target_revision_track="",
            entitlement_groups=(),
            visibility_level="public",
            visibility_scope=None,
        )

        self.assertEqual([source.chunk_id for source in bundle.sources], [chunk.chunk_id])

    def test_physical_collection_executor_normalizes_float_qdrant_timeout(self) -> None:
        qdrant_client = _FakeRemoteQdrantClient()
        executor = QdrantPhysicalCollectionAcceptanceExecutor(
            qdrant_client=qdrant_client,  # type: ignore[arg-type]
            settings=RetrievalSettings(
                qdrant_url="https://qdrant.example",
                qdrant_timeout_seconds=10.0,
                embedding_provider="mock",
                embedding_model="mock-embedding-8d",
                embedding_dimensions=3,
                sparse_provider="mock",
            ),
            runtime_profile=load_runtime_profile("regulations", "student_rules"),
            embedding_model=_FakeEmbeddingModel(),
            sparse_embedding_model=build_mock_sparse_embedding_model(),
        )

        executor.retrieve(
            physical_collection_name="student_rules__r20260430_acceptance",
            corpus="regulations",
            collection="student_rules",
            query="学生手册",
            top_k=3,
            target_document_ids=(),
            target_version_ids=(),
            target_revision_track="",
            entitlement_groups=(),
            visibility_level="public",
            visibility_scope=None,
        )

        self.assertIsInstance(qdrant_client.timeout, int)
        self.assertEqual(qdrant_client.timeout, 10)


class RegistryScopeReleaseAcceptanceWiringTest(unittest.TestCase):
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

    def test_evaluate_release_chunk_quality_rejects_incomplete_segment_coverage(self) -> None:
        record = _make_record()
        first = replace(
            _make_chunk(record=record),
            chunk_id="student_rules:handbook:chunk-segment-1",
            chunk_order=1,
            metadata={
                "unit_type": "section_text",
                "root_unit_id": "student_rules:handbook:root-segmented",
                "segment_index": 1,
                "segment_total": 3,
                "final_token_count": 32,
                "chunk_policy_version": "student_rules_semantic_v3",
            },
        )
        third = replace(
            _make_chunk(record=record),
            chunk_id="student_rules:handbook:chunk-segment-3",
            chunk_order=2,
            metadata={
                "unit_type": "section_text",
                "root_unit_id": "student_rules:handbook:root-segmented",
                "segment_index": 3,
                "segment_total": 3,
                "final_token_count": 32,
                "chunk_policy_version": "student_rules_semantic_v3",
            },
        )

        report = evaluate_release_chunk_quality(
            chunks=(first, third),
            max_token_count=512,
        )

        self.assertEqual(report.status, "failed")
        self.assertIn(
            "segment_coverage_gap",
            report.summary["issues_by_chunk_id"]["student_rules:handbook:chunk-segment-1"],
        )
        self.assertIn(
            "segment_coverage_gap",
            report.summary["issues_by_chunk_id"]["student_rules:handbook:chunk-segment-3"],
        )

    def test_evaluate_release_chunk_quality_rejects_table_chunks_without_context_or_header(
        self,
    ) -> None:
        record = _make_record()
        report = evaluate_release_chunk_quality(
            chunks=(
                replace(
                    _make_chunk(record=record),
                    chunk_id="student_rules:handbook:chunk-table",
                    text="本科生 | 按学期注册",
                    metadata={
                        "unit_type": "table_unit",
                        "root_unit_id": "student_rules:handbook:table-0001",
                        "table_group_id": "student_rules:handbook:table-0001",
                        "table_row_count": 1,
                        "table_row_lines": ["本科生 | 按学期注册"],
                        "final_token_count": 16,
                        "chunk_policy_version": "student_rules_semantic_v3",
                    },
                ),
            ),
            max_token_count=512,
        )

        self.assertEqual(report.status, "failed")
        self.assertIn(
            "missing_table_context_or_header",
            report.summary["issues_by_chunk_id"]["student_rules:handbook:chunk-table"],
        )


def _write_cases(payload: dict[str, object]) -> Path:
    temp_dir = TemporaryDirectory()
    path = Path(temp_dir.name) / "cases.json"
    path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    _CASE_DIRS.append(temp_dir)
    return path


_CASE_DIRS: list[TemporaryDirectory[str]] = []


def _first_uploaded_json(object_store: _FakeObjectStore, *, filename: str) -> dict[str, object]:
    for upload in object_store.uploads:
        if str(upload["key"]).endswith(filename):
            return json.loads(bytes(upload["data"]).decode("utf-8"))
    raise AssertionError(f"missing upload ending with {filename}")


def _make_record() -> DocumentRegistryRecord:
    return DocumentRegistryRecord(
        document_id="student_rules:handbook",
        revision_track="current-effective",
        version_id="sha256:handbook-v1",
        source_uri="https://docs.example/handbook",
        content_hash="sha256:handbook-v1",
        corpus="regulations",
        collection="student_rules",
        cleaning_policy_version="student_rules_cleaning_v1",
        entitlement_groups=(),
        visibility_scope=None,
        visibility_level="public",
        status="active",
        ingestion_timestamp="2026-04-30T00:00:00+00:00",
        parser_version="test_parser_v1",
        embedding_model="mock-embedding-8d",
        source_channel="manual_curated",
        is_current=True,
        document_units_object_key="regulations/student_rules/handbook/document-units.jsonl",
        processed_object_keys=("regulations/student_rules/handbook/document-units.jsonl",),
        import_source="test",
    )


def _make_chunk(*, record: DocumentRegistryRecord) -> IndexableChunk:
    return IndexableChunk(
        document_id=record.document_id,
        revision_track=record.revision_track,
        version_id=record.version_id,
        chunk_id="student_rules:handbook:chunk-0001",
        chunk_order=1,
        corpus=record.corpus,
        collection=record.collection,
        entitlement_groups=record.entitlement_groups,
        visibility_scope=record.visibility_scope,
        visibility_level="public",
        source_uri=record.source_uri,
        source_chunk_id=None,
        anchor={"section_path": ["总则"]},
        text="学生手册正文",
        source_channel=record.source_channel,
        is_current=True,
        parser_version=record.parser_version,
        embedding_model="mock-embedding-8d",
        embedding=(0.1, 0.2, 0.3),
        metadata={
            "unit_type": "section_text",
            "final_token_count": 32,
            "root_unit_id": "student_rules:handbook:root-0001",
            "chunk_policy_version": "student_rules_semantic_v3",
            "cleaning_policy_version": "student_rules_cleaning_v1",
        },
    )


def _object_store_settings() -> ObjectStoreSettings:
    return ObjectStoreSettings(
        endpoint="http://localhost:9000",
        access_key="minioadmin",
        secret_key="minioadmin",
        bucket_derived="campus-rag-derived",
    )


if __name__ == "__main__":
    unittest.main()
