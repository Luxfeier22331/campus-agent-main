from __future__ import annotations

from campus_retrieval_core.backend_qdrant_embeddings import get_dense_query_embedding
from campus_retrieval_core.backend_qdrant_evidence import build_evidence_sources

from tests.retrieval.backend_qdrant_test_support import (
    InMemoryDocumentRegistry,
    Mock,
    QdrantRetrievalBackend,
    RetrievalRequest,
    RetrievalSettings,
    _make_registry_record,
    _make_runtime_profile,
    patch,
    qdrant_models,
    unittest,
)


class _FakeEmbeddingModel:
    def __init__(self) -> None:
        self.calls: list[str] = []

    def get_query_embedding(self, query_text: str) -> tuple[float, ...]:
        self.calls.append(query_text)
        return (float(len(self.calls)), 0.0, 0.0)


class _NoSparseModel:
    def build_query(self, query_text: str) -> object | None:
        return None


class _FakeQdrantClient:
    def __init__(self) -> None:
        self.captured_timeouts: list[int | None] = []

    def collection_exists(self, collection_name: str, **kwargs: object) -> bool:
        self.captured_timeouts.append(kwargs.get("timeout"))  # type: ignore[arg-type]
        return True

    def query_points(self, **kwargs: object) -> object:
        self.captured_timeouts.append(kwargs.get("timeout"))  # type: ignore[arg-type]

        class Response:
            points: tuple[object, ...] = ()

        return Response()


class _CountingRegistry(InMemoryDocumentRegistry):
    def __init__(self, *args: object, **kwargs: object) -> None:
        super().__init__(*args, **kwargs)
        self.get_calls = 0
        self.current_version_calls = 0

    def get(self, document_id: str, revision_track: str, version_id: str):
        self.get_calls += 1
        return super().get(document_id, revision_track, version_id)

    def current_version(
        self,
        document_id: str,
        preferred_revision_tracks: tuple[str, ...] = (),
    ):
        self.current_version_calls += 1
        return super().current_version(document_id, preferred_revision_tracks)


class BackendQdrantHotPathTest(unittest.TestCase):
    def test_dense_query_cache_is_bounded_and_reuses_cached_embeddings(self) -> None:
        embedding_model = _FakeEmbeddingModel()
        backend = QdrantRetrievalBackend(
            RetrievalSettings(qdrant_url=":memory:"),
            registry=InMemoryDocumentRegistry(),
            qdrant_client=Mock(),
            embedding_model=embedding_model,
            sparse_embedding_model=_NoSparseModel(),
            dense_query_cache_ttl_seconds=60,
            dense_query_cache_max_entries=2,
        )
        profile = _make_runtime_profile()

        get_dense_query_embedding(backend, "first", profile=profile)
        get_dense_query_embedding(backend, "second", profile=profile)
        get_dense_query_embedding(backend, "first", profile=profile)
        get_dense_query_embedding(backend, "third", profile=profile)

        self.assertLessEqual(len(backend._dense_query_cache), 2)
        self.assertEqual(len(embedding_model.calls), 3)
        self.assertNotIn(
            "Instruct: " + profile.embedding_query_instruction + "\nQuery: second",
            backend._dense_query_cache,
        )

    def test_retrieve_threads_timeout_budget_to_qdrant_reads(self) -> None:
        qdrant_client = _FakeQdrantClient()
        backend = QdrantRetrievalBackend(
            RetrievalSettings(qdrant_url=":memory:"),
            registry=InMemoryDocumentRegistry(),
            qdrant_client=qdrant_client,
            embedding_model=_FakeEmbeddingModel(),
            sparse_embedding_model=_NoSparseModel(),
        )
        profile = _make_runtime_profile()

        with patch(
            "campus_retrieval_core.backend_qdrant.load_runtime_profile",
            return_value=profile,
        ):
            backend.retrieve(
                RetrievalRequest(
                    query_text="library hours",
                    corpus="regulations",
                    collection="student_rules",
                    timeout_ms=2500,
                )
            )

        self.assertTrue(qdrant_client.captured_timeouts)
        bounded_timeouts = [
            timeout for timeout in qdrant_client.captured_timeouts if timeout is not None
        ]
        self.assertTrue(bounded_timeouts)
        self.assertTrue(all(1 <= timeout <= 3 for timeout in bounded_timeouts))

    def test_registry_lookup_metadata_is_memoized_for_repeated_source_records(self) -> None:
        record = _make_registry_record(
            document_id="regulations:student:library",
            version_id="v1:student:library",
            entitlement_groups=(),
        )
        registry = _CountingRegistry((record,))
        backend = QdrantRetrievalBackend(
            RetrievalSettings(qdrant_url=":memory:"),
            registry=registry,
            qdrant_client=Mock(),
            embedding_model=_FakeEmbeddingModel(),
            sparse_embedding_model=_NoSparseModel(),
        )
        payload = {
            "text": "Library hours are 08:00 to 22:00.",
            "document_id": record.document_id,
            "revision_track": record.revision_track,
            "version_id": record.version_id,
            "chunk_id": "chunk-library",
        }

        sources = build_evidence_sources(
            backend,
            (
                qdrant_models.ScoredPoint(
                    id="point-1",
                    version=0,
                    score=0.9,
                    payload=payload,
                    vector=None,
                ),
                qdrant_models.ScoredPoint(
                    id="point-2",
                    version=0,
                    score=0.8,
                    payload={**payload, "chunk_id": "chunk-library-2"},
                    vector=None,
                ),
            ),
        )

        self.assertEqual(len(sources), 2)
        self.assertEqual(registry.get_calls, 1)
        self.assertEqual(registry.current_version_calls, 1)
