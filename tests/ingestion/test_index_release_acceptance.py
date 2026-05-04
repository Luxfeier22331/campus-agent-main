from __future__ import annotations

import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import Mock, patch

from campus_contracts import EvidenceBundle, EvidenceSource
from campus_ingestion_core.corpus_profiles import load_runtime_profile
from campus_ingestion_core.index_release_acceptance import (
    QdrantPhysicalCollectionAcceptanceExecutor,
    ReleaseRetrievalAcceptanceExecutor,
    load_release_retrieval_acceptance_cases,
    run_release_retrieval_acceptance,
)
from campus_ingestion_core.models import DocumentRegistryRecord
from campus_ingestion_core.process import IndexableChunk
from campus_ingestion_core.process_indexing import index_chunks_to_qdrant
from campus_ingestion_core.registry_scope_release_support import (
    _validate_default_qrels_coverage_for_scope,
)
from campus_ingestion_core.settings import ObjectStoreSettings
from campus_ingestion_core.sparse import build_mock_sparse_embedding_model
from campus_retrieval_core.settings import RetrievalSettings
from qdrant_client import QdrantClient
from qdrant_client.http import models as qdrant_models

_REPO_ROOT = Path(__file__).resolve().parents[2]
_STUDENT_RULES_RELEASE_ACCEPTANCE_PATH = (
    _REPO_ROOT / "packages/evals/fixtures/student_rules_release_acceptance.v1.json"
)
_QUERY_ENABLED_RELEASE_ACCEPTANCE_FIXTURES = (
    ("regulations", "student_rules", "student_rules_release_acceptance.v1.json"),
    ("regulations", "institutional_rules", "institutional_rules_release_acceptance.v1.json"),
    ("curriculum", "curriculum_plan", "curriculum_plan_release_acceptance.v1.json"),
    (
        "official_web",
        "stable_reference",
        "official_web_stable_reference_release_acceptance.v1.json",
    ),
)
_INSTITUTIONAL_RULES_RELEASE_ACCEPTANCE_PATH = (
    _REPO_ROOT / "packages/evals/fixtures/institutional_rules_release_acceptance.v1.json"
)
_INSTITUTIONAL_RULES_RETRIEVAL_EVAL_MANIFEST_PATH = (
    _REPO_ROOT / "configs/ingestion/regulations/institutional_rules/retrieval-eval-manifest.v1.json"
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
        self.authorized_requests: list[dict[str, object]] = []

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
        self.authorized_requests.append(
            {
                "query": query,
                "entitlement_groups": entitlement_groups,
                "visibility_level": visibility_level,
                "visibility_scope": visibility_scope,
            }
        )
        return self.bundles[query]


class _FakeEmbeddingModel:
    def get_query_embedding(self, _query: str) -> tuple[float, float, float]:
        return (0.1, 0.2, 0.3)


class _FakeQdrantQueryResponse:
    points: tuple[()] = ()


class _FakeRemoteQdrantClient:
    def __init__(self) -> None:
        self.timeout: object | None = None
        self.limit: object | None = None

    def query_points(self, **kwargs: object) -> _FakeQdrantQueryResponse:
        self.timeout = kwargs.get("timeout")
        self.limit = kwargs.get("limit")
        return _FakeQdrantQueryResponse()


class _FakeCurriculumTitleMissQdrantClient:
    def __init__(self) -> None:
        self.scroll_calls: list[dict[str, object]] = []

    def query_points(self, **_kwargs: object) -> object:
        return type(
            "FakeResponse",
            (),
            {
                "points": (
                    qdrant_models.ScoredPoint(
                        id="russian",
                        version=1,
                        score=0.72,
                        payload={
                            "document_id": "curriculum:俄语（俄语、中亚语）本科人才培养方案",
                            "revision_track": "source-faithful",
                            "version_id": "v1:russian",
                            "chunk_id": "curriculum:俄语（俄语、中亚语）本科人才培养方案:chunk-0001",
                            "corpus": "curriculum",
                            "collection": "curriculum_plan",
                            "visibility_level": "public",
                            "status": "active",
                            "source_uri": "https://campus.example/curriculum/russian",
                            "canonical_url": "https://campus.example/curriculum/russian",
                            "latest_url": "https://campus.example/curriculum/russian",
                            "source_channel": "pdf_ocr",
                            "is_current": True,
                            "anchor": {"section_path": ["俄语（俄语、中亚语）本科人才培养方案"]},
                            "text": "俄语（俄语、中亚语）本科人才培养方案。",
                        },
                        vector=None,
                    ),
                )
            },
        )()

    def scroll(self, **kwargs: object) -> tuple[list[qdrant_models.Record], None]:
        self.scroll_calls.append(kwargs)
        return (
            [
                qdrant_models.Record(
                    id="social-practice",
                    payload={
                        "document_id": "curriculum:中央民族大学大学生社会实践环节实施方案",
                        "revision_track": "source-faithful",
                        "version_id": "v1:social-practice",
                        "chunk_id": "curriculum:中央民族大学大学生社会实践环节实施方案:chunk-0001",
                        "corpus": "curriculum",
                        "collection": "curriculum_plan",
                        "visibility_level": "public",
                        "status": "active",
                        "source_uri": "https://campus.example/curriculum/social-practice",
                        "canonical_url": "https://campus.example/curriculum/social-practice",
                        "latest_url": "https://campus.example/curriculum/social-practice",
                        "source_channel": "pdf_ocr",
                        "is_current": True,
                        "anchor": {
                            "section_path": ["中央民族大学大学生社会实践环节实施方案"]
                        },
                        "display_text": "中央民族大学大学生社会实践环节实施方案。",
                    },
                )
            ],
            None,
        )


class _FakeLowSignalQdrantClient:
    def query_points(self, **_kwargs: object) -> object:
        return type(
            "FakeResponse",
            (),
            {
                "points": (
                    qdrant_models.ScoredPoint(
                        id="low-signal",
                        version=1,
                        score=0.3,
                        payload={
                            "document_id": "student_rules:unrelated",
                            "revision_track": "source-faithful",
                            "version_id": "v1:unrelated",
                            "chunk_id": "student_rules:unrelated:chunk-0001",
                            "corpus": "regulations",
                            "collection": "student_rules",
                            "source_uri": "https://docs.example/unrelated",
                            "canonical_url": "https://docs.example/unrelated",
                            "latest_url": "https://docs.example/unrelated",
                            "source_channel": "manual_curated",
                            "is_current": True,
                            "text": "学生请假和宿舍管理说明",
                        },
                        vector=None,
                    ),
                    qdrant_models.ScoredPoint(
                        id="low-signal-runner-up",
                        version=1,
                        score=0.29,
                        payload={
                            "document_id": "student_rules:another-unrelated",
                            "revision_track": "source-faithful",
                            "version_id": "v1:another-unrelated",
                            "chunk_id": "student_rules:another-unrelated:chunk-0001",
                            "corpus": "regulations",
                            "collection": "student_rules",
                            "source_uri": "https://docs.example/another-unrelated",
                            "canonical_url": "https://docs.example/another-unrelated",
                            "latest_url": "https://docs.example/another-unrelated",
                            "source_channel": "manual_curated",
                            "is_current": True,
                            "text": "奖学金申请材料说明",
                        },
                        vector=None,
                    ),
                )
            },
        )()


class IndexReleaseAcceptanceTest(unittest.TestCase):
    def test_default_qrels_coverage_uses_denominator_policy_fixture(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            qrels_path = root / "qrels.json"
            qrels_path.write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "corpus": "regulations",
                        "collection": "student_rules",
                        "baseline": {},
                        "coverage_scenarios": {"no_hit": ["missing"]},
                        "cases": [
                            {
                                "case_id": "missing",
                                "split": "smoke",
                                "query": "校内宇宙签证办理处",
                                "expected_sources": [],
                            }
                        ],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            policy_path = root / "policy.json"
            policy_path.write_text(
                json.dumps(
                    {
                        "schema_version": "retrieval-qrels-denominator-policy-v1",
                        "normalized_denominator_classes": ["no_hit"],
                        "scopes": {
                            "regulations/student_rules": {
                                "fixture": str(qrels_path),
                                "min_case_count": 1,
                                "required_classes": ["no_hit"],
                                "required_scenarios": ["no_hit"],
                                "scenario_denominator_classes": {},
                            }
                        },
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            with patch(
                "campus_ingestion_core.registry_scope_release_support._default_qrels_denominator_policy_path",
                return_value=policy_path,
            ):
                issues = _validate_default_qrels_coverage_for_scope(
                    corpus="regulations",
                    collection="student_rules",
                )

        self.assertIn(
            "regulations/student_rules: qrels scenario no_hit has no denominator class mapping",
            issues,
        )

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
        self.assertTrue(case_by_id["no-hit-impossible-query"].expected_no_hit)

    def test_default_query_enabled_release_acceptance_fixtures_load(self) -> None:
        for corpus, collection, fixture_name in _QUERY_ENABLED_RELEASE_ACCEPTANCE_FIXTURES:
            with self.subTest(scope=f"{corpus}/{collection}"):
                cases = load_release_retrieval_acceptance_cases(
                    _REPO_ROOT / "packages/evals/fixtures" / fixture_name,
                    corpus=corpus,
                    collection=collection,
                )

                self.assertGreaterEqual(len(cases), 5)
                self.assertTrue(any(case.expected_no_hit for case in cases), fixture_name)
                self.assertTrue(any(case.expected_document_ids for case in cases), fixture_name)

    def test_curriculum_social_practice_release_case_uses_campus_member_authorization(
        self,
    ) -> None:
        cases = load_release_retrieval_acceptance_cases(
            _REPO_ROOT / "packages/evals/fixtures/curriculum_plan_release_acceptance.v1.json",
            corpus="curriculum",
            collection="curriculum_plan",
        )
        case_by_id = {case.case_id: case for case in cases}

        social_practice_case = case_by_id["curriculum-title-social-practice"]

        self.assertEqual(
            social_practice_case.expected_document_ids,
            ("curriculum:中央民族大学大学生社会实践环节实施方案",),
        )
        self.assertEqual(social_practice_case.entitlement_groups, ("campus_members",))
        self.assertEqual(social_practice_case.visibility_level, "restricted")

    def test_institutional_rules_release_acceptance_covers_consumption_manifest_titles(
        self,
    ) -> None:
        cases = load_release_retrieval_acceptance_cases(
            _INSTITUTIONAL_RULES_RELEASE_ACCEPTANCE_PATH,
            corpus="regulations",
            collection="institutional_rules",
        )
        manifest = json.loads(
            _INSTITUTIONAL_RULES_RETRIEVAL_EVAL_MANIFEST_PATH.read_text(encoding="utf-8")
        )
        released_docs = tuple(manifest["documents"])
        title_cases = {
            case.query: case
            for case in cases
            if case.expected_document_ids and case.case_id.startswith("institutional-title-exact-")
        }

        self.assertEqual(len(released_docs), 42)
        self.assertEqual(set(title_cases), {item["title"] for item in released_docs})
        for item in released_docs:
            case = title_cases[item["title"]]
            self.assertEqual(case.expected_document_ids, (item["document_id"],))
            self.assertEqual(case.expected_version_ids, (item["version_id"],))
            self.assertEqual(case.entitlement_groups, ("campus_members",))
            self.assertEqual(case.visibility_level, "restricted")
            self.assertEqual(case.visibility_scope, "campus")

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
