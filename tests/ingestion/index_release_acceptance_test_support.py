from __future__ import annotations

import json
import unittest
from dataclasses import replace
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
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
from campus_ingestion_core.models import DocumentRegistryRecord
from campus_ingestion_core.process import IndexableChunk
from campus_ingestion_core.process_indexing import index_chunks_to_qdrant
from campus_ingestion_core.registry_scope_release_support import (
    _validate_default_qrels_coverage_for_scope,
)
from campus_ingestion_core.regulation_rag_release_admission import (
    RegulationRagReleaseAdmissionError,
    build_regulation_rag_release_admission_manifest,
    validate_regulation_rag_release_admission_for_release,
    validate_regulation_rag_release_admission_manifest_shape,
    write_regulation_rag_release_admission_manifest,
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
                        "anchor": {"section_path": ["中央民族大学大学生社会实践环节实施方案"]},
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
            "source_document_ids": [record.document_id],
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


__all__ = [
    "_CASE_DIRS",
    "_INSTITUTIONAL_RULES_RELEASE_ACCEPTANCE_PATH",
    "_INSTITUTIONAL_RULES_RETRIEVAL_EVAL_MANIFEST_PATH",
    "_QUERY_ENABLED_RELEASE_ACCEPTANCE_FIXTURES",
    "_REPO_ROOT",
    "_STUDENT_RULES_RELEASE_ACCEPTANCE_PATH",
    "_FakeAcceptanceExecutor",
    "_FakeCurriculumTitleMissQdrantClient",
    "_FakeEmbeddingModel",
    "_FakeLowSignalQdrantClient",
    "_FakeObjectStore",
    "_FakeRemoteQdrantClient",
    "_first_uploaded_json",
    "_make_chunk",
    "_make_record",
    "_object_store_settings",
    "_write_cases",
]
