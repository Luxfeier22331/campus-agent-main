from __future__ import annotations

from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from campus_contracts import EvidenceBundle
from campus_ingestion_core.chunking import ChunkProfile
from campus_ingestion_core.embed import MockEmbeddingSettings, build_mock_embedding_model
from campus_ingestion_core.models import DocumentRegistryRecord
from campus_ingestion_core.process import build_indexable_chunks_from_jsonl, index_chunks_to_qdrant
from campus_ingestion_core.registry import FileDocumentRegistry
from campus_retrieval_core.backend_qdrant import QdrantRetrievalBackend, RetrievalBackendError
from campus_retrieval_core.models import RetrievalRequest
from campus_retrieval_core.settings import RetrievalSettings
from qdrant_client import QdrantClient


def _make_registry_record(*, document_id: str, version_id: str, acl_groups: tuple[str, ...]) -> DocumentRegistryRecord:
    return DocumentRegistryRecord(
        document_id=document_id,
        version_id=version_id,
        source_uri=f"https://campus.example/handbook/{document_id}",
        content_hash=f"sha256:{document_id}",
        corpus="student_handbook",
        acl_groups=acl_groups,
        campus_scope=None,
        status="active",
        ingestion_timestamp="2026-03-22T10:00:00+00:00",
        parser_version="campusrag-import-v1",
        embedding_model="mock-embedding-8d",
        structured_object_key=f"student_handbook/{document_id}/{version_id}/structured.jsonl",
        processed_object_keys=(
            f"student_handbook/{document_id}/{version_id}/structured.jsonl",
        ),
        import_source="campusrag_existing_ocr",
    )


def _make_structured_jsonl(*, document_id: str, version_id: str, text: str) -> bytes:
    return (
        f'{{"doc_id":"{document_id}","version_id":"{version_id}","chunk_id":"legacy-{document_id}",'
        f'"clean_text":{text!r},"anchor":{{"section_path":["Student Handbook","Library"],"page_start":5,"page_end":5}},'
        f'"acl":{{"level":"public","allow_groups":[]}}}}'
        .replace("'", '"')
        .encode("utf-8")
    )


class BackendQdrantTest(unittest.TestCase):
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
                    document_registry_path=registry_path,
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
                    corpus="student_handbook",
                    acl_groups=("students",),
                )
            )

            self.assertIsInstance(result, EvidenceBundle)
            self.assertEqual(result.corpus, "student_handbook")
            self.assertEqual(len(result.sources), 1)
            source = result.sources[0]
            self.assertEqual(source.doc_id, "handbook:test-001")
            self.assertEqual(source.version_id, "v1:test-001")
            self.assertEqual(source.canonical_url, "https://campus.example/handbook/handbook:test-001")
            self.assertEqual(source.latest_url, source.canonical_url)
            self.assertEqual(source.anchor["page_start"], 5)
            self.assertIn("08:00", source.snippet)

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
                structured_jsonl_bytes=_make_structured_jsonl(
                    document_id=blocked.document_id,
                    version_id=blocked.version_id,
                    text="Staff office hours are private.",
                ),
                chunk_profile=ChunkProfile(chunk_size=128, chunk_overlap=16),
                embedding_model=embedding_model,
            )

            backend = QdrantRetrievalBackend(
                settings=RetrievalSettings(
                    qdrant_url=":memory:",
                    qdrant_collection="student_handbook_test",
                    document_registry_path=registry_path,
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
                    corpus="student_handbook",
                    acl_groups=("students",),
                    top_k=5,
                )
            )

            self.assertEqual([source.doc_id for source in result.sources], ["handbook:students"])

    def test_backend_returns_empty_bundle_on_no_hit(self) -> None:
        with TemporaryDirectory() as temp_dir:
            registry_path = Path(temp_dir) / "registry.json"
            registry = FileDocumentRegistry(registry_path)
            embedding_model = build_mock_embedding_model(MockEmbeddingSettings(embed_dim=8))
            backend = QdrantRetrievalBackend(
                settings=RetrievalSettings(
                    qdrant_url=":memory:",
                    qdrant_collection="student_handbook_test",
                    document_registry_path=registry_path,
                ),
                registry=registry,
                qdrant_client=QdrantClient(location=":memory:"),
                embedding_model=embedding_model,
            )

            result = backend.retrieve(
                RetrievalRequest(
                    query_text="unknown question",
                    corpus="student_handbook",
                    acl_groups=("students",),
                )
            )

            self.assertEqual(result, EvidenceBundle(query_text="unknown question", corpus="student_handbook"))

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
                    document_registry_path=registry_path,
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
                        corpus="student_handbook",
                        acl_groups=("students",),
                    )
                )


if __name__ == "__main__":
    unittest.main()
