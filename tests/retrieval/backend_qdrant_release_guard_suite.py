from __future__ import annotations

import hashlib
import time

from campus_retrieval_core.backend_qdrant_release_guard import (
    _cached_guard_result,
    _profile_identity,
)

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
    def __init__(
        self,
        payload: dict[str, object] | None = None,
        *,
        payloads: tuple[dict[str, object], ...] | None = None,
        collection_payload: dict[str, object] | None = None,
    ) -> None:
        self.payload = payload or {}
        self.payloads = payloads or ((self.payload,) if payload is not None else ())
        self.collection_payload = collection_payload
        self.scroll_calls = 0
        self.get_collection_calls = 0
        self.query_calls = 0

    def collection_exists(self, collection_name: str, **kwargs: object) -> bool:
        return True

    def get_collection(self, collection_name: str, **kwargs: object) -> object:
        self.get_collection_calls += 1

        class CollectionInfo:
            def __init__(self, payload: dict[str, object] | None) -> None:
                self.metadata = payload

        return CollectionInfo(self.collection_payload)

    def scroll(self, **kwargs: object) -> tuple[list[qdrant_models.Record], None]:
        self.scroll_calls += 1
        return (
            [
                qdrant_models.Record(
                    id=f"point-release-metadata-{index}",
                    payload=payload,
                    vector=None,
                )
                for index, payload in enumerate(self.payloads, start=1)
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

    def test_release_guard_fails_closed_on_mixed_sampled_release_ids(self) -> None:
        profile = _make_runtime_profile()
        first_payload = _release_payload(profile=profile, settings=_settings())
        second_payload = dict(first_payload)
        second_payload["index_release_id"] = "r20260430_stale_mixed_release"
        qdrant_client = _ReleaseGuardQdrantClient(payloads=(first_payload, second_payload))
        backend = _backend(qdrant_client=qdrant_client)

        with (
            patch(
                "campus_retrieval_core.backend_qdrant.load_runtime_profile",
                return_value=profile,
            ),
            self.assertRaisesRegex(RetrievalBackendError, "inconsistent release metadata"),
        ):
            backend.retrieve(_request())

        self.assertEqual(qdrant_client.query_calls, 0)

    def test_release_guard_cache_is_invalidated_by_profile_identity_change(self) -> None:
        first_profile = _make_runtime_profile()
        second_profile = _make_runtime_profile(dense_prefetch_limit=40)
        qdrant_client = _ReleaseGuardQdrantClient(
            _release_payload(profile=first_profile, settings=_settings())
        )
        backend = _backend(qdrant_client=qdrant_client)

        with patch(
            "campus_retrieval_core.backend_qdrant.load_runtime_profile",
            return_value=first_profile,
        ):
            backend.retrieve(_request())

        with (
            patch(
                "campus_retrieval_core.backend_qdrant.load_runtime_profile",
                return_value=second_profile,
            ),
            self.assertRaisesRegex(RetrievalBackendError, "release metadata drift"),
        ):
            backend.retrieve(_request())

        self.assertEqual(qdrant_client.scroll_calls, 2)
        self.assertEqual(qdrant_client.query_calls, 1)

    def test_release_guard_expired_cache_entry_is_removed_by_composite_key(self) -> None:
        backend = _backend(
            qdrant_client=_ReleaseGuardQdrantClient(
                _release_payload(profile=_make_runtime_profile(), settings=_settings())
            )
        )
        cache_key = "student_rules:profile-hash"
        backend._release_drift_guard_cache[cache_key] = (
            time.monotonic() - 1.0,
            "r20260430_expired",
            "passed",
            "",
        )

        cached = _cached_guard_result(
            backend,
            collection_name="student_rules",
            profile_identity="profile-hash",
        )

        self.assertIsNone(cached)
        self.assertNotIn(cache_key, backend._release_drift_guard_cache)

    def test_release_guard_fails_closed_on_profile_identity_hash_mismatch(self) -> None:
        profile = _make_runtime_profile()
        payload = _release_payload(profile=profile, settings=_settings())
        payload["profile_identity_hash"] = "stale-profile-identity"
        qdrant_client = _ReleaseGuardQdrantClient(payload)
        backend = _backend(qdrant_client=qdrant_client)

        with (
            patch(
                "campus_retrieval_core.backend_qdrant.load_runtime_profile",
                return_value=profile,
            ),
            self.assertRaisesRegex(RetrievalBackendError, "profile_identity_hash"),
        ):
            backend.retrieve(_request())

        self.assertEqual(qdrant_client.query_calls, 0)

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

    def test_release_guard_fails_closed_on_empty_query_serving_alias_payload(self) -> None:
        profile = _make_runtime_profile()
        qdrant_client = _ReleaseGuardQdrantClient({})
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

    def test_release_guard_fails_closed_on_query_serving_alias_without_release_id(self) -> None:
        profile = _make_runtime_profile()
        qdrant_client = _ReleaseGuardQdrantClient(
            {"chunk_policy_version": profile.chunk_profile_version}
        )
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

    def test_release_guard_skips_non_release_managed_in_memory_test_backend(self) -> None:
        profile = _make_runtime_profile()
        qdrant_client = Mock()
        qdrant_client.collection_exists = Mock(return_value=True)
        qdrant_client.query_points = Mock(return_value=qdrant_models.QueryResponse(points=[]))
        backend = _backend(
            qdrant_client=qdrant_client,
            settings=_settings(qdrant_url=":memory:"),
        )

        with patch(
            "campus_retrieval_core.backend_qdrant.load_runtime_profile",
            return_value=profile,
        ):
            backend.retrieve(_request())

        self.assertEqual(qdrant_client.query_points.call_count, 1)


def _settings(*, qdrant_url: str = "https://qdrant.example") -> RetrievalSettings:
    return RetrievalSettings(
        qdrant_url=qdrant_url,
        embedding_provider="mock",
        embedding_model="mock-embedding-8d",
        embedding_dimensions=3,
        sparse_provider="mock",
    )


def _backend(
    *,
    qdrant_client: object,
    settings: RetrievalSettings | None = None,
) -> QdrantRetrievalBackend:
    return QdrantRetrievalBackend(
        settings=settings or _settings(),
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
        "profile_identity_hash": _profile_identity(profile=profile, settings=settings),
        "quality_gate_status": "passed",
        "chunk_quality_status": "passed",
        "qrels_coverage_status": "passed",
        "release_metadata_consistency_status": "passed",
    }


if __name__ == "__main__":
    unittest.main()
