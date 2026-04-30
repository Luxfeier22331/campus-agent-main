from __future__ import annotations

import hashlib

from tests.retrieval.backend_qdrant_test_support import (
    InMemoryDocumentRegistry,
    Mock,
    QdrantRetrievalBackend,
    RetrievalBackendError,
    RetrievalRequest,
    RetrievalSettings,
    _make_runtime_profile,
    patch,
    qdrant_models,
    unittest,
)


class _FakeEmbeddingModel:
    def get_query_embedding(self, query_text: str) -> tuple[float, ...]:
        return (0.1, 0.2, 0.3)


class _NoSparseModel:
    def build_query(self, query_text: str) -> object | None:
        return None


class _ReleaseGuardQdrantClient:
    def __init__(self, payload: dict[str, object]) -> None:
        self.payload = payload
        self.scroll_calls = 0
        self.query_calls = 0

    def collection_exists(self, collection_name: str, **kwargs: object) -> bool:
        return True

    def scroll(self, **kwargs: object) -> tuple[list[qdrant_models.Record], None]:
        self.scroll_calls += 1
        return (
            [
                qdrant_models.Record(
                    id="point-release-metadata",
                    payload=self.payload,
                    vector=None,
                )
            ],
            None,
        )

    def query_points(self, **kwargs: object) -> qdrant_models.QueryResponse:
        self.query_calls += 1
        return qdrant_models.QueryResponse(points=[])


class BackendQdrantReleaseGuardTest(unittest.TestCase):
    def test_release_guard_allows_matching_alias_metadata_and_caches_result(self) -> None:
        profile = _make_runtime_profile()
        qdrant_client = _ReleaseGuardQdrantClient(
            _release_payload(profile=profile, settings=_settings())
        )
        backend = _backend(qdrant_client=qdrant_client)

        with patch(
            "campus_retrieval_core.backend_qdrant.load_runtime_profile",
            return_value=profile,
        ):
            backend.retrieve(_request())
            backend.retrieve(_request())

        self.assertEqual(qdrant_client.scroll_calls, 1)
        self.assertEqual(qdrant_client.query_calls, 2)

    def test_release_guard_fails_closed_on_dense_embedding_model_mismatch(self) -> None:
        profile = _make_runtime_profile()
        payload = _release_payload(profile=profile, settings=_settings())
        payload["embedding_model"] = "stale-model"
        qdrant_client = _ReleaseGuardQdrantClient(payload)
        backend = _backend(qdrant_client=qdrant_client)

        with (
            patch(
                "campus_retrieval_core.backend_qdrant.load_runtime_profile",
                return_value=profile,
            ),
            self.assertRaisesRegex(RetrievalBackendError, "release metadata drift"),
        ):
            backend.retrieve(_request())

        self.assertEqual(qdrant_client.query_calls, 0)

    def test_release_guard_fails_closed_on_missing_release_metadata_field(self) -> None:
        profile = _make_runtime_profile()
        payload = _release_payload(profile=profile, settings=_settings())
        del payload["sparse_model"]
        qdrant_client = _ReleaseGuardQdrantClient(payload)
        backend = _backend(qdrant_client=qdrant_client)

        with (
            patch(
                "campus_retrieval_core.backend_qdrant.load_runtime_profile",
                return_value=profile,
            ),
            self.assertRaisesRegex(RetrievalBackendError, "missing release metadata"),
        ):
            backend.retrieve(_request())

        self.assertEqual(qdrant_client.query_calls, 0)


def _settings() -> RetrievalSettings:
    return RetrievalSettings(
        qdrant_url=":memory:",
        embedding_provider="mock",
        embedding_model="mock-embedding-8d",
        embedding_dimensions=3,
        sparse_provider="mock",
    )


def _backend(*, qdrant_client: _ReleaseGuardQdrantClient) -> QdrantRetrievalBackend:
    return QdrantRetrievalBackend(
        settings=_settings(),
        registry=InMemoryDocumentRegistry(),
        qdrant_client=qdrant_client,
        embedding_model=_FakeEmbeddingModel(),
        sparse_embedding_model=_NoSparseModel(),
    )


def _request() -> RetrievalRequest:
    return RetrievalRequest(
        query_text="library hours",
        corpus="regulations",
        collection="student_rules",
    )


def _release_payload(*, profile, settings: RetrievalSettings) -> dict[str, object]:
    return {
        "index_release_id": "r20260430_120000_release_guard",
        "index_validation_status": "passed",
        "embedding_provider": settings.embedding_provider,
        "embedding_model": settings.embedding_model,
        "embedding_dimensions": settings.embedding_dimensions,
        "sparse_provider": settings.sparse_provider,
        "sparse_model": settings.sparse_model,
        "sparse_tokenizer": settings.sparse_tokenizer,
        "sparse_language": settings.sparse_language,
        "cleaning_policy_version": profile.cleaning_policy_version,
        "chunk_policy_version": profile.chunk_profile_version,
        "dense_vector_name": profile.qdrant_index_binding.dense_vector_name,
        "sparse_vector_name": profile.qdrant_index_binding.sparse_vector_name,
        "dense_prefetch_limit": profile.dense_prefetch_limit,
        "sparse_prefetch_limit": profile.sparse_prefetch_limit,
        "rrf_k": profile.rrf_k,
        "rrf_dense_weight": profile.rrf_dense_weight,
        "rrf_sparse_weight": profile.rrf_sparse_weight,
        "embedding_query_instruction_hash": hashlib.sha256(
            profile.embedding_query_instruction.encode("utf-8")
        ).hexdigest(),
    }


if __name__ == "__main__":
    unittest.main()
