from __future__ import annotations

from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from campus_contracts import EvidenceBundle
from campus_ingestion_core.chunking import ChunkProfile
from campus_ingestion_core.embed import MockEmbeddingSettings, build_mock_embedding_model
from campus_ingestion_core.models import DocumentRegistryRecord
from campus_ingestion_core.process import build_indexable_chunks_from_jsonl, index_chunks_to_qdrant
from campus_ingestion_core.registry import FileDocumentRegistry
from campus_retrieval_core.backend_qdrant import (
    CorpusQueryDisabledError,
    QdrantRetrievalBackend,
    RetrievalBackendError,
    _build_metadata_filters,
)
from campus_retrieval_core.models import RetrievalRequest
from campus_retrieval_core.settings import RetrievalSettings
from llama_index.core.schema import TextNode
from qdrant_client import QdrantClient


def _make_registry_record(*, document_id: str, version_id: str, acl_groups: tuple[str, ...]) -> DocumentRegistryRecord:
    return DocumentRegistryRecord(
        document_id=document_id,
        revision_track="source-faithful",
        version_id=version_id,
        source_uri=f"https://campus.example/handbook/{document_id}",
        content_hash=f"sha256:{document_id}",
        corpus="regulations",
        collection="student_handbook",
        acl_groups=acl_groups,
        campus_scope=None,
        status="active",
        ingestion_timestamp="2026-03-22T10:00:00+00:00",
        parser_version="campusrag-import-v1",
        embedding_model="mock-embedding-8d",
        source_channel="pdf_ocr",
        document_units_object_key=(
            "regulations/documents/student_handbook/"
            f"{document_id.replace(':', '-')}/source-faithful/undated/document-units.jsonl"
        ),
        processed_object_keys=(
            "regulations/documents/student_handbook/"
            f"{document_id.replace(':', '-')}/source-faithful/undated/document-units.jsonl",
        ),
        import_source="raw_online_ocr",
    )


def _make_structured_jsonl(*, document_id: str, version_id: str, text: str) -> bytes:
    return (
        f'{{"doc_id":"{document_id}","version_id":"{version_id}","chunk_id":"legacy-{document_id}",'
        f'"clean_text":{text!r},"anchor":{{"section_path":["Student Handbook","Library"],"page_start":5,"page_end":5}},'
        f'"acl":{{"level":"public","allow_groups":[]}}}}'
        .replace("'", '"')
        .encode("utf-8")
    )


def _make_structured_jsonl_with_acl(
    *,
    document_id: str,
    version_id: str,
    text: str,
    acl_level: str,
) -> bytes:
    return (
        f'{{"doc_id":"{document_id}","version_id":"{version_id}","chunk_id":"legacy-{document_id}",'
        f'"clean_text":{text!r},"anchor":{{"section_path":["Student Handbook","Library"],"page_start":5,"page_end":5}},'
        f'"acl":{{"level":"{acl_level}","allow_groups":[]}}}}'
        .replace("'", '"')
        .encode("utf-8")
    )


def _make_structured_jsonl_with_acl_groups(
    *,
    document_id: str,
    version_id: str,
    text: str,
    acl_level: str,
    acl_groups: tuple[str, ...],
) -> bytes:
    allow_groups = ",".join(f'"{group}"' for group in acl_groups)
    return (
        f'{{"doc_id":"{document_id}","version_id":"{version_id}","chunk_id":"legacy-{document_id}",'
        f'"clean_text":{text!r},"anchor":{{"section_path":["Student Handbook","Library"],"page_start":5,"page_end":5}},'
        f'"acl":{{"level":"{acl_level}","allow_groups":[{allow_groups}]}}}}'
        .replace("'", '"')
        .encode("utf-8")
    )


class BackendQdrantTest(unittest.TestCase):
    def test_build_metadata_filters_treats_public_acl_as_public_level(self) -> None:
        filters = _build_metadata_filters(
            RetrievalRequest(
                query_text="library hours",
                corpus="regulations",
                collection="student_handbook",
                acl_groups=("students",),
            )
        )

        self.assertEqual(filters.condition.value, "and")
        self.assertEqual(len(filters.filters), 3)
        self.assertEqual(filters.filters[0].key, "corpus")
        self.assertEqual(filters.filters[0].value, "regulations")
        self.assertEqual(filters.filters[1].key, "collection")
        self.assertEqual(filters.filters[1].value, "student_handbook")
        acl_filter = filters.filters[2]
        self.assertEqual(acl_filter.condition.value, "or")
        self.assertEqual(len(acl_filter.filters), 2)
        self.assertEqual(acl_filter.filters[0].key, "acl_level")
        self.assertEqual(acl_filter.filters[0].value, "public")
        self.assertEqual(acl_filter.filters[1].key, "acl_groups")
        self.assertEqual(acl_filter.filters[1].operator.value, "in")
        self.assertEqual(acl_filter.filters[1].value, ["students"])

    def test_index_chunks_to_qdrant_skips_payload_indexes_for_local_backend(self) -> None:
        record = _make_registry_record(
            document_id="handbook:test-001",
            version_id="v1:test-001",
            acl_groups=("students",),
        )
        embedding_model = build_mock_embedding_model(MockEmbeddingSettings(embed_dim=8))
        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=_make_structured_jsonl(
                document_id=record.document_id,
                version_id=record.version_id,
                text="Local qdrant indexing should not create payload indexes.",
            ),
            chunk_profile=ChunkProfile(chunk_size=128, chunk_overlap=16),
            embedding_model=embedding_model,
        )
        qdrant_client = QdrantClient(location=":memory:")
        qdrant_client.create_payload_index = Mock(side_effect=AssertionError("should not be called"))  # type: ignore[method-assign]

        ids = index_chunks_to_qdrant(
            chunks=chunks,
            qdrant_client=qdrant_client,
            collection_name="student_handbook_test",
        )

        self.assertEqual(len(ids), 1)

    def test_index_chunks_to_qdrant_creates_acl_level_payload_index_for_remote_backend(self) -> None:
        record = _make_registry_record(
            document_id="handbook:test-remote",
            version_id="v1:test-remote",
            acl_groups=("students",),
        )
        embedding_model = build_mock_embedding_model(MockEmbeddingSettings(embed_dim=8))
        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=_make_structured_jsonl(
                document_id=record.document_id,
                version_id=record.version_id,
                text="Remote qdrant indexing should create acl_level payload indexes.",
            ),
            chunk_profile=ChunkProfile(chunk_size=128, chunk_overlap=16),
            embedding_model=embedding_model,
        )
        qdrant_client = QdrantClient(location=":memory:")
        qdrant_client.collection_exists = Mock(return_value=True)  # type: ignore[method-assign]
        qdrant_client.create_payload_index = Mock()  # type: ignore[method-assign]
        with patch("campus_ingestion_core.process._is_local_qdrant_backend", return_value=False):
            with patch("campus_ingestion_core.process.QdrantVectorStore") as vector_store_cls:
                vector_store_cls.return_value.add.return_value = ["point-1"]

                ids = index_chunks_to_qdrant(
                    chunks=chunks,
                    qdrant_client=qdrant_client,
                    collection_name="student_handbook_test",
                )

        self.assertEqual(ids, ("point-1",))
        indexed_fields = [call.kwargs["field_name"] for call in qdrant_client.create_payload_index.call_args_list]
        self.assertEqual(
            indexed_fields,
            [
                "document_id",
                "revision_track",
                "representation",
                "version_id",
                "corpus",
                "collection",
                "campus_scope",
                "acl_groups",
                "acl_level",
                "source_channel",
                "is_current",
            ],
        )

    def test_backend_rejects_query_disabled_corpus(self) -> None:
        backend = QdrantRetrievalBackend(
            settings=RetrievalSettings(
                qdrant_url=":memory:",
                qdrant_collection="student_handbook_test",
                document_registry_database_url="postgresql://registry.example/postgres",
            ),
            registry=FileDocumentRegistry(Path(TemporaryDirectory().name) / "registry.json"),
            qdrant_client=QdrantClient(location=":memory:"),
            embedding_model=build_mock_embedding_model(MockEmbeddingSettings(embed_dim=8)),
        )

        with self.assertRaisesRegex(CorpusQueryDisabledError, "curriculum/curriculum_plan"):
            backend.retrieve(
                RetrievalRequest(
                    query_text="培养方案要求",
                    corpus="curriculum",
                    collection="curriculum_plan",
                )
            )

    def test_retrieval_settings_from_env_reads_registry_database_url(self) -> None:
        settings = RetrievalSettings.from_env(
            {
                "QDRANT_URL": ":memory:",
                "DOCUMENT_REGISTRY_DATABASE_URL": "postgresql://registry.example/postgres",
                "EMBEDDING_MODEL": "mock-embedding-8d",
            }
        )

        self.assertEqual(settings.qdrant_url, ":memory:")
        self.assertEqual(
            settings.document_registry_database_url,
            "postgresql://registry.example/postgres",
        )

    def test_backend_returns_evidence_bundle_with_source_locator(self) -> None:
        with TemporaryDirectory() as temp_dir:
            registry_path = Path(temp_dir) / "registry.json"
            registry = FileDocumentRegistry(registry_path)
            record = _make_registry_record(
                document_id="handbook:test-001",
                version_id="v1:test-001",
                acl_groups=("students",),
            )
            registry.upsert(record)

            embedding_model = build_mock_embedding_model(MockEmbeddingSettings(embed_dim=8))
            chunks = build_indexable_chunks_from_jsonl(
                record=record,
                structured_jsonl_bytes=_make_structured_jsonl(
                    document_id=record.document_id,
                    version_id=record.version_id,
                    text="Library hours are from 08:00 to 22:00 for students.",
                ),
                chunk_profile=ChunkProfile(chunk_size=128, chunk_overlap=16),
                embedding_model=embedding_model,
            )

            backend = QdrantRetrievalBackend(
                settings=RetrievalSettings(
                    qdrant_url=":memory:",
                    qdrant_collection="student_handbook_test",
                    document_registry_database_url="postgresql://registry.example/postgres",
                ),
                registry=registry,
                qdrant_client=QdrantClient(location=":memory:"),
                embedding_model=embedding_model,
            )
            index_chunks_to_qdrant(
                chunks=chunks,
                qdrant_client=backend.qdrant_client,
                collection_name=backend.settings.qdrant_collection,
            )

            result = backend.retrieve(
                RetrievalRequest(
                    query_text="What are the library hours?",
                    corpus="regulations",
                    collection="student_handbook",
                    acl_groups=("students",),
                )
            )

            self.assertIsInstance(result, EvidenceBundle)
            self.assertEqual(result.corpus, "regulations")
            self.assertEqual(result.collection, "student_handbook")
            self.assertEqual(len(result.sources), 1)
            source = result.sources[0]
            self.assertEqual(source.doc_id, "handbook:test-001")
            self.assertEqual(source.revision_track, "source-faithful")
            self.assertEqual(source.version_id, "v1:test-001")
            self.assertEqual(source.source_channel, "pdf_ocr")
            self.assertEqual(source.collection, "student_handbook")
            self.assertFalse(source.is_current)
            self.assertEqual(source.canonical_url, "https://campus.example/handbook/handbook:test-001")
            self.assertEqual(source.latest_url, source.canonical_url)
            self.assertEqual(source.anchor["page_start"], 5)
            self.assertIn("08:00", source.snippet)

    def test_backend_accepts_representation_payload_alias_for_revision_track(self) -> None:
        with TemporaryDirectory() as temp_dir:
            registry_path = Path(temp_dir) / "registry.json"
            registry = FileDocumentRegistry(registry_path)
            record = _make_registry_record(
                document_id="handbook:test-alias",
                version_id="v1:test-alias",
                acl_groups=("students",),
            )
            registry.upsert(record)

            node = TextNode(
                text="Library hours remain visible through representation alias metadata.",
                metadata={
                    "document_id": record.document_id,
                    "representation": record.revision_track,
                    "version_id": record.version_id,
                    "chunk_id": "chunk-alias-001",
                    "anchor": {"page_start": 5, "page_end": 5},
                    "acl_level": "public",
                    "source_channel": "pdf_ocr",
                    "collection": "student_handbook",
                    "is_current": False,
                },
            )
            backend = QdrantRetrievalBackend(
                settings=RetrievalSettings(
                    qdrant_url=":memory:",
                    qdrant_collection="student_handbook_test",
                    document_registry_database_url="postgresql://registry.example/postgres",
                ),
                registry=registry,
                qdrant_client=QdrantClient(location=":memory:"),
                embedding_model=build_mock_embedding_model(MockEmbeddingSettings(embed_dim=8)),
            )
            backend.qdrant_client.collection_exists = Mock(return_value=True)  # type: ignore[method-assign]
            backend._vector_store = SimpleNamespace(
                _legacy_vector_format=True,
                query=Mock(return_value=SimpleNamespace(nodes=[node], similarities=[0.91])),
            )

            result = backend.retrieve(
                RetrievalRequest(
                    query_text="library hours",
                    corpus="regulations",
                    collection="student_handbook",
                    acl_groups=("students",),
                )
            )

            self.assertEqual(len(result.sources), 1)
            self.assertEqual(result.sources[0].revision_track, "source-faithful")

    def test_backend_skips_sources_with_missing_registry_or_representation_metadata(self) -> None:
        with TemporaryDirectory() as temp_dir:
            registry_path = Path(temp_dir) / "registry.json"
            registry = FileDocumentRegistry(registry_path)
            record = _make_registry_record(
                document_id="handbook:test-skip",
                version_id="v1:test-skip",
                acl_groups=("students",),
            )
            registry.upsert(record)

            backend = QdrantRetrievalBackend(
                settings=RetrievalSettings(
                    qdrant_url=":memory:",
                    qdrant_collection="student_handbook_test",
                    document_registry_database_url="postgresql://registry.example/postgres",
                ),
                registry=registry,
                qdrant_client=QdrantClient(location=":memory:"),
                embedding_model=build_mock_embedding_model(MockEmbeddingSettings(embed_dim=8)),
            )
            backend.qdrant_client.collection_exists = Mock(return_value=True)  # type: ignore[method-assign]
            backend._vector_store = SimpleNamespace(
                _legacy_vector_format=True,
                query=Mock(return_value=SimpleNamespace(
                    nodes=[
                        TextNode(
                            text="Missing representation metadata should be skipped.",
                            metadata={
                                "document_id": record.document_id,
                                "version_id": record.version_id,
                                "chunk_id": "chunk-missing-001",
                            },
                        ),
                        TextNode(
                            text="Unknown registry record should also be skipped.",
                            metadata={
                                "document_id": "handbook:missing-record",
                                "representation": "source-faithful",
                                "version_id": "v1:missing-record",
                                "chunk_id": "chunk-missing-002",
                            },
                        ),
                    ],
                    similarities=[0.8, 0.7],
                )),
            )

            result = backend.retrieve(
                RetrievalRequest(
                    query_text="library hours",
                    corpus="regulations",
                    collection="student_handbook",
                    acl_groups=("students",),
                )
            )

            self.assertEqual(result.sources, ())

    def test_backend_applies_acl_filter_before_returning_sources(self) -> None:
        with TemporaryDirectory() as temp_dir:
            registry_path = Path(temp_dir) / "registry.json"
            registry = FileDocumentRegistry(registry_path)
            allowed = _make_registry_record(
                document_id="handbook:students",
                version_id="v1:students",
                acl_groups=("students",),
            )
            blocked = _make_registry_record(
                document_id="handbook:staff",
                version_id="v1:staff",
                acl_groups=("staff",),
            )
            registry.upsert(allowed)
            registry.upsert(blocked)

            embedding_model = build_mock_embedding_model(MockEmbeddingSettings(embed_dim=8))
            allowed_chunks = build_indexable_chunks_from_jsonl(
                record=allowed,
                structured_jsonl_bytes=_make_structured_jsonl(
                    document_id=allowed.document_id,
                    version_id=allowed.version_id,
                    text="Students can enter the library until 22:00.",
                ),
                chunk_profile=ChunkProfile(chunk_size=128, chunk_overlap=16),
                embedding_model=embedding_model,
            )
            blocked_chunks = build_indexable_chunks_from_jsonl(
                record=blocked,
                structured_jsonl_bytes=_make_structured_jsonl_with_acl(
                    document_id=blocked.document_id,
                    version_id=blocked.version_id,
                    text="Staff office hours are private.",
                    acl_level="restricted",
                ),
                chunk_profile=ChunkProfile(chunk_size=128, chunk_overlap=16),
                embedding_model=embedding_model,
            )

            backend = QdrantRetrievalBackend(
                settings=RetrievalSettings(
                    qdrant_url=":memory:",
                    qdrant_collection="student_handbook_test",
                    document_registry_database_url="postgresql://registry.example/postgres",
                ),
                registry=registry,
                qdrant_client=QdrantClient(location=":memory:"),
                embedding_model=embedding_model,
            )
            index_chunks_to_qdrant(
                chunks=[*allowed_chunks, *blocked_chunks],
                qdrant_client=backend.qdrant_client,
                collection_name=backend.settings.qdrant_collection,
            )

            result = backend.retrieve(
                RetrievalRequest(
                    query_text="Tell me about office or library hours",
                    corpus="regulations",
                    collection="student_handbook",
                    acl_groups=("students",),
                    top_k=5,
                )
            )

            self.assertEqual([source.doc_id for source in result.sources], ["handbook:students"])

    def test_backend_fail_closes_when_document_has_acl_groups_even_if_structured_acl_level_is_public(self) -> None:
        with TemporaryDirectory() as temp_dir:
            registry_path = Path(temp_dir) / "registry.json"
            registry = FileDocumentRegistry(registry_path)
            restricted = _make_registry_record(
                document_id="handbook:staff-only",
                version_id="v1:staff-only",
                acl_groups=("staff",),
            )
            registry.upsert(restricted)

            embedding_model = build_mock_embedding_model(MockEmbeddingSettings(embed_dim=8))
            restricted_chunks = build_indexable_chunks_from_jsonl(
                record=restricted,
                structured_jsonl_bytes=_make_structured_jsonl_with_acl_groups(
                    document_id=restricted.document_id,
                    version_id=restricted.version_id,
                    text="Staff office hours are private.",
                    acl_level="public",
                    acl_groups=("staff",),
                ),
                chunk_profile=ChunkProfile(chunk_size=128, chunk_overlap=16),
                embedding_model=embedding_model,
            )

            backend = QdrantRetrievalBackend(
                settings=RetrievalSettings(
                    qdrant_url=":memory:",
                    qdrant_collection="student_handbook_test",
                    document_registry_database_url="postgresql://registry.example/postgres",
                ),
                registry=registry,
                qdrant_client=QdrantClient(location=":memory:"),
                embedding_model=embedding_model,
            )
            index_chunks_to_qdrant(
                chunks=restricted_chunks,
                qdrant_client=backend.qdrant_client,
                collection_name=backend.settings.qdrant_collection,
            )

            result = backend.retrieve(
                RetrievalRequest(
                    query_text="Tell me about office hours",
                    corpus="regulations",
                    collection="student_handbook",
                    acl_groups=("students",),
                    top_k=5,
                )
            )

            self.assertEqual(result.sources, ())

    def test_backend_returns_empty_bundle_on_no_hit(self) -> None:
        with TemporaryDirectory() as temp_dir:
            registry_path = Path(temp_dir) / "registry.json"
            registry = FileDocumentRegistry(registry_path)
            embedding_model = build_mock_embedding_model(MockEmbeddingSettings(embed_dim=8))
            backend = QdrantRetrievalBackend(
                settings=RetrievalSettings(
                    qdrant_url=":memory:",
                    qdrant_collection="student_handbook_test",
                    document_registry_database_url="postgresql://registry.example/postgres",
                ),
                registry=registry,
                qdrant_client=QdrantClient(location=":memory:"),
                embedding_model=embedding_model,
            )

            result = backend.retrieve(
                RetrievalRequest(
                    query_text="unknown question",
                    corpus="regulations",
                    collection="student_handbook",
                    acl_groups=("students",),
                )
            )

            self.assertEqual(
                result,
                EvidenceBundle(
                    query_text="unknown question",
                    corpus="regulations",
                    collection="student_handbook",
                ),
            )

    def test_backend_maps_qdrant_errors(self) -> None:
        with TemporaryDirectory() as temp_dir:
            registry_path = Path(temp_dir) / "registry.json"
            registry = FileDocumentRegistry(registry_path)
            embedding_model = build_mock_embedding_model(MockEmbeddingSettings(embed_dim=8))
            record = _make_registry_record(
                document_id="handbook:error-case",
                version_id="v1:error-case",
                acl_groups=("students",),
            )
            registry.upsert(record)
            backend = QdrantRetrievalBackend(
                settings=RetrievalSettings(
                    qdrant_url=":memory:",
                    qdrant_collection="student_handbook_test",
                    document_registry_database_url="postgresql://registry.example/postgres",
                ),
                registry=registry,
                qdrant_client=QdrantClient(location=":memory:"),
                embedding_model=embedding_model,
            )
            chunks = build_indexable_chunks_from_jsonl(
                record=record,
                structured_jsonl_bytes=_make_structured_jsonl(
                    document_id=record.document_id,
                    version_id=record.version_id,
                    text="Library hours are from 08:00 to 22:00.",
                ),
                chunk_profile=ChunkProfile(chunk_size=128, chunk_overlap=16),
                embedding_model=embedding_model,
            )
            index_chunks_to_qdrant(
                chunks=chunks,
                qdrant_client=backend.qdrant_client,
                collection_name=backend.settings.qdrant_collection,
            )

            backend._vector_store = object()  # type: ignore[attr-defined]

            with self.assertRaises(RetrievalBackendError):
                backend.retrieve(
                    RetrievalRequest(
                        query_text="library hours",
                        corpus="regulations",
                        collection="student_handbook",
                        acl_groups=("students",),
                    )
                )

    def test_backend_builds_registry_from_database_url_when_not_injected(self) -> None:
        with patch("campus_retrieval_core.backend_qdrant.build_document_registry_from_env") as builder:
            builder.return_value = FileDocumentRegistry(Path("/tmp/unused-registry.json"))

            backend = QdrantRetrievalBackend(
                settings=RetrievalSettings(
                    qdrant_url=":memory:",
                    qdrant_collection="student_handbook_test",
                    document_registry_database_url="postgresql://registry.example/postgres",
                    embedding_model="mock-embedding-8d",
                ),
                qdrant_client=QdrantClient(location=":memory:"),
                embedding_model=build_mock_embedding_model(MockEmbeddingSettings(embed_dim=8)),
            )

            builder.assert_called_once_with(
                {"DOCUMENT_REGISTRY_DATABASE_URL": "postgresql://registry.example/postgres"}
            )
            self.assertIsNotNone(backend.registry)


if __name__ == "__main__":
    unittest.main()
