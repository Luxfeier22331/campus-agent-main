from __future__ import annotations

from unittest.mock import Mock

from campus_contracts import EvidenceBundle, EvidenceSource
from campus_ingestion_core.corpus_profiles import load_runtime_profile
from campus_ingestion_core.index_release_acceptance import (
    QdrantPhysicalCollectionAcceptanceExecutor,
    load_release_retrieval_acceptance_cases,
    run_release_retrieval_acceptance,
)
from campus_ingestion_core.process_indexing import index_chunks_to_qdrant
from campus_ingestion_core.sparse import build_mock_sparse_embedding_model
from campus_retrieval_core.settings import RetrievalSettings
from qdrant_client import QdrantClient
from qdrant_client.http import models as qdrant_models

from tests.ingestion.index_release_acceptance_test_support import (
    _FakeAcceptanceExecutor,
    _FakeCurriculumTitleMissQdrantClient,
    _FakeEmbeddingModel,
    _FakeLowSignalQdrantClient,
    _FakeRemoteQdrantClient,
    _make_chunk,
    _make_record,
    _write_cases,
)


class IndexReleaseAcceptanceRuntimeSuite:
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

    def test_run_release_retrieval_acceptance_passes_case_authorization_to_executor(
        self,
    ) -> None:
        source = EvidenceSource(
            doc_id="curriculum:restricted",
            revision_track="source-faithful",
            version_id="v1:restricted",
            chunk_id="curriculum:restricted:chunk-0001",
            anchor={},
            canonical_url="https://campus.example/curriculum/restricted",
            latest_url="https://campus.example/curriculum/restricted",
            source_channel="pdf_ocr",
            collection="curriculum_plan",
            is_current=True,
            snippet="受限培养方案正文",
            score=0.91,
        )
        executor = _FakeAcceptanceExecutor(
            bundles={
                "受限培养方案": EvidenceBundle(
                    query_text="受限培养方案",
                    corpus="curriculum",
                    collection="curriculum_plan",
                    sources=(source,),
                )
            }
        )
        cases = load_release_retrieval_acceptance_cases(
            _write_cases(
                {
                    "cases": [
                        {
                            "case_id": "restricted-curriculum-hit",
                            "corpus": "curriculum",
                            "collection": "curriculum_plan",
                            "query": "受限培养方案",
                            "expected_document_ids": ["curriculum:restricted"],
                            "entitlement_groups": ["campus_members"],
                            "visibility_level": "restricted",
                            "visibility_scope": "campus",
                        }
                    ]
                }
            ),
            corpus="curriculum",
            collection="curriculum_plan",
        )

        result = run_release_retrieval_acceptance(
            cases=cases,
            executor=executor,
            physical_collection_name="curriculum_plan__r20260503_test",
        )

        self.assertEqual(result.status, "passed")
        self.assertEqual(
            executor.authorized_requests,
            [
                {
                    "query": "受限培养方案",
                    "entitlement_groups": ("campus_members",),
                    "visibility_level": "restricted",
                    "visibility_scope": "campus",
                }
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

    def test_run_release_retrieval_acceptance_fails_when_condition_subject_contract_missing(
        self,
    ) -> None:
        source_without_subject = EvidenceSource(
            doc_id="student_rules:attendance-discipline",
            revision_track="source-faithful",
            version_id="v1:attendance-discipline",
            chunk_id="student_rules:attendance-discipline:chunk-0033",
            anchor={
                "_retrieval_evidence_attributes": {
                    "answer_role": "supporting_detail",
                    "evidence_contract_version": "answer_ready_evidence.v3",
                    "parent_unit_id": "article-0033",
                }
            },
            canonical_url="https://docs.example/attendance-discipline",
            latest_url="https://docs.example/attendance-discipline",
            source_channel="manual_curated",
            collection="student_rules",
            is_current=True,
            snippet="一学期累计旷课16节以下者，给予学院通报批评处分。",
            score=0.91,
        )
        cases = load_release_retrieval_acceptance_cases(
            _write_cases(
                {
                    "cases": [
                        {
                            "case_id": "attendance-threshold",
                            "corpus": "regulations",
                            "collection": "student_rules",
                            "query": "旷课多少学时会按违纪处理",
                            "expected_document_ids": ["student_rules:attendance-discipline"],
                            "expected_condition_subjects": ["attendance_absence_threshold"],
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
                    "旷课多少学时会按违纪处理": EvidenceBundle(
                        query_text="旷课多少学时会按违纪处理",
                        corpus="regulations",
                        collection="student_rules",
                        sources=(source_without_subject,),
                    )
                }
            ),
            physical_collection_name="student_rules__r20260512_test",
        )

        self.assertEqual(result.status, "failed")
        self.assertEqual(result.summary["failed_case_ids"], ["attendance-threshold"])
        self.assertIn("expected_condition_subjects", result.summary["cases"][0]["failures"])

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

    def test_physical_collection_executor_uses_runtime_document_support_limit_for_candidate_width(
        self,
    ) -> None:
        qdrant_client = _FakeRemoteQdrantClient()
        executor = QdrantPhysicalCollectionAcceptanceExecutor(
            qdrant_client=qdrant_client,  # type: ignore[arg-type]
            settings=RetrievalSettings(
                qdrant_url="https://qdrant.example",
                embedding_provider="mock",
                embedding_model="mock-embedding-8d",
                embedding_dimensions=3,
                sparse_provider="mock",
            ),
            runtime_profile=load_runtime_profile("curriculum", "curriculum_plan"),
            embedding_model=_FakeEmbeddingModel(),
            sparse_embedding_model=build_mock_sparse_embedding_model(),
        )

        executor.retrieve(
            physical_collection_name="curriculum_plan__r20260504_acceptance",
            corpus="curriculum",
            collection="curriculum_plan",
            query="教育学本科人才培养方案",
            top_k=3,
            target_document_ids=(),
            target_version_ids=(),
            target_revision_track="",
            entitlement_groups=(),
            visibility_level="public",
            visibility_scope=None,
        )

        self.assertEqual(qdrant_client.limit, 24)

    def test_physical_collection_executor_applies_no_hit_policy(self) -> None:
        profile = load_runtime_profile("regulations", "student_rules")
        executor = QdrantPhysicalCollectionAcceptanceExecutor(
            qdrant_client=_FakeLowSignalQdrantClient(),  # type: ignore[arg-type]
            settings=RetrievalSettings(
                qdrant_url="https://qdrant.example",
                embedding_provider="mock",
                embedding_model="mock-embedding-8d",
                embedding_dimensions=3,
                sparse_provider="mock",
            ),
            runtime_profile=profile,
            embedding_model=_FakeEmbeddingModel(),
            sparse_embedding_model=build_mock_sparse_embedding_model(),
        )

        bundle = executor.retrieve(
            physical_collection_name="student_rules__r20260430_acceptance",
            corpus="regulations",
            collection="student_rules",
            query="校内宇宙签证办理处",
            top_k=3,
            target_document_ids=(),
            target_version_ids=(),
            target_revision_track="",
            entitlement_groups=(),
            visibility_level="public",
            visibility_scope=None,
        )

        self.assertEqual(bundle.sources, ())

    def test_physical_collection_executor_prioritizes_curriculum_title_match_before_top_k_truncation(
        self,
    ) -> None:
        profile = load_runtime_profile("curriculum", "curriculum_plan")
        qdrant_client = Mock()
        qdrant_client.query_points.return_value = qdrant_models.QueryResponse(
            points=[
                qdrant_models.ScoredPoint(
                    id="point-ethnic",
                    version=0,
                    score=0.82,
                    payload={
                        "document_id": "curriculum:信息与计算科学（民族实验班）本科人才培养方案",
                        "revision_track": "source-faithful",
                        "version_id": "v1:ics-ethnic",
                        "chunk_id": "curriculum:信息与计算科学（民族实验班）本科人才培养方案:chunk-0001",
                        "corpus": "curriculum",
                        "collection": "curriculum_plan",
                        "visibility_level": "public",
                        "status": "active",
                        "source_uri": "https://campus.example/curriculum/ics-ethnic",
                        "canonical_url": "https://campus.example/curriculum/ics-ethnic",
                        "latest_url": "https://campus.example/curriculum/ics-ethnic",
                        "source_channel": "pdf_ocr",
                        "is_current": True,
                        "anchor": {
                            "section_path": [
                                "信息与计算科学（民族实验班）本科人才培养方案",
                                "一、培养目标",
                            ]
                        },
                        "text": "信息与计算科学（民族实验班）本科人才培养方案 一、培养目标。",
                    },
                ),
                qdrant_models.ScoredPoint(
                    id="point-target",
                    version=0,
                    score=0.49,
                    payload={
                        "document_id": "curriculum:信息与计算科学本科人才培养方案",
                        "revision_track": "source-faithful",
                        "version_id": "v1:ics",
                        "chunk_id": "curriculum:信息与计算科学本科人才培养方案:chunk-0001",
                        "corpus": "curriculum",
                        "collection": "curriculum_plan",
                        "visibility_level": "public",
                        "status": "active",
                        "source_uri": "https://campus.example/curriculum/ics",
                        "canonical_url": "https://campus.example/curriculum/ics",
                        "latest_url": "https://campus.example/curriculum/ics",
                        "source_channel": "pdf_ocr",
                        "is_current": True,
                        "anchor": {
                            "section_path": [
                                "信息与计算科学本科人才培养方案",
                                "一、培养目标",
                            ]
                        },
                        "text": "信息与计算科学本科人才培养方案 一、培养目标。",
                    },
                ),
            ]
        )
        executor = QdrantPhysicalCollectionAcceptanceExecutor(
            qdrant_client=qdrant_client,  # type: ignore[arg-type]
            settings=RetrievalSettings(
                qdrant_url="https://qdrant.example",
                embedding_provider="mock",
                embedding_model="mock-embedding-8d",
                embedding_dimensions=3,
                sparse_provider="mock",
            ),
            runtime_profile=profile,
            embedding_model=_FakeEmbeddingModel(),
            sparse_embedding_model=build_mock_sparse_embedding_model(),
        )

        bundle = executor.retrieve(
            physical_collection_name="curriculum_plan__r20260427_000952",
            corpus="curriculum",
            collection="curriculum_plan",
            query="信息与计算科学本科人才培养方案",
            top_k=1,
            target_document_ids=(),
            target_version_ids=(),
            target_revision_track="",
            entitlement_groups=(),
            visibility_level="public",
            visibility_scope=None,
        )

        self.assertEqual(
            [source.doc_id for source in bundle.sources],
            ["curriculum:信息与计算科学本科人才培养方案"],
        )

    def test_physical_collection_executor_rescues_curriculum_title_match_when_initial_candidates_miss_exact_title(
        self,
    ) -> None:
        qdrant_client = _FakeCurriculumTitleMissQdrantClient()
        executor = QdrantPhysicalCollectionAcceptanceExecutor(
            qdrant_client=qdrant_client,  # type: ignore[arg-type]
            settings=RetrievalSettings(
                qdrant_url="https://qdrant.example",
                embedding_provider="mock",
                embedding_model="mock-embedding-8d",
                embedding_dimensions=3,
                sparse_provider="mock",
            ),
            runtime_profile=load_runtime_profile("curriculum", "curriculum_plan"),
            embedding_model=_FakeEmbeddingModel(),
            sparse_embedding_model=build_mock_sparse_embedding_model(),
        )

        bundle = executor.retrieve(
            physical_collection_name="curriculum_plan__r20260503_acceptance",
            corpus="curriculum",
            collection="curriculum_plan",
            query="中央民族大学大学生社会实践环节实施方案",
            top_k=3,
            target_document_ids=(),
            target_version_ids=(),
            target_revision_track="",
            entitlement_groups=(),
            visibility_level="public",
            visibility_scope=None,
        )

        self.assertEqual(
            [source.doc_id for source in bundle.sources],
            ["curriculum:中央民族大学大学生社会实践环节实施方案"],
        )
        self.assertEqual(len(qdrant_client.scroll_calls), 1)
