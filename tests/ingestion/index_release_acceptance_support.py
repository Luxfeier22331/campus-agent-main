from __future__ import annotations

import json
from pathlib import Path
from tempfile import TemporaryDirectory

from campus_contracts import EvidenceBundle
from campus_ingestion_core.index_release_acceptance import ReleaseRetrievalAcceptanceExecutor
from campus_ingestion_core.models import DocumentRegistryRecord
from campus_ingestion_core.process import IndexableChunk
from campus_ingestion_core.settings import ObjectStoreSettings


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


_CASE_DIRS: list[TemporaryDirectory[str]] = []


def _write_cases(payload: dict[str, object]) -> Path:
    temp_dir = TemporaryDirectory()
    path = Path(temp_dir.name) / "cases.json"
    path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    _CASE_DIRS.append(temp_dir)
    return path


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
