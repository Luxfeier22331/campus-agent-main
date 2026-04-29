from __future__ import annotations

from tests.retrieval.backend_qdrant_test_support import (
    STUDENT_HANDBOOK_QDRANT_COLLECTION,
    ChunkProfile,
    CorpusQueryDisabledError,
    InMemoryDocumentRegistry,
    Mock,
    MockEmbeddingSettings,
    MockSparseEmbeddingSettings,
    QdrantClient,
    QdrantRetrievalBackend,
    ResponseHandlingException,
    RetrievalBackendError,
    RetrievalRequest,
    RetrievalSettings,
    SparseEmbeddingSettings,
    _authorized_filter,
    _build_hybrid_prefetch,
    _build_qdrant_client,
    _build_rrf_query,
    _make_registry_record,
    _make_runtime_profile,
    _make_structured_jsonl,
    build_indexable_chunks_from_jsonl,
    build_mock_embedding_model,
    build_mock_sparse_embedding_model,
    build_sparse_embedding_model,
    index_chunks_to_qdrant,
    patch,
    qdrant_models,
    unittest,
    uuid,
)


class BackendQdrantClientSettingsTest(unittest.TestCase):
    def test_index_chunks_to_qdrant_skips_payload_indexes_for_local_backend(self) -> None:
        record = _make_registry_record(
            document_id="handbook:test-001",
            version_id="v1:test-001",
            entitlement_groups=("students",),
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
        qdrant_client.create_payload_index = Mock(
            side_effect=AssertionError("should not be called")
        )  # type: ignore[method-assign]

        ids = index_chunks_to_qdrant(
            chunks=chunks,
            qdrant_client=qdrant_client,
            collection_name=STUDENT_HANDBOOK_QDRANT_COLLECTION,
            sparse_embedding_model=build_mock_sparse_embedding_model(MockSparseEmbeddingSettings()),
        )

        self.assertEqual(len(ids), 1)

    def test_index_chunks_to_qdrant_creates_named_dense_and_sparse_vectors_for_remote_backend(
        self,
    ) -> None:
        record = _make_registry_record(
            document_id="handbook:test-remote",
            version_id="v1:test-remote",
            entitlement_groups=("students",),
        )
        embedding_model = build_mock_embedding_model(MockEmbeddingSettings(embed_dim=8))
        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=_make_structured_jsonl(
                document_id=record.document_id,
                version_id=record.version_id,
                text="Remote qdrant indexing should create visibility payload indexes.",
            ),
            chunk_profile=ChunkProfile(chunk_size=128, chunk_overlap=16),
            embedding_model=embedding_model,
        )
        qdrant_client = QdrantClient(location=":memory:")
        qdrant_client.collection_exists = Mock(side_effect=[False, True])  # type: ignore[method-assign]
        qdrant_client.create_collection = Mock()  # type: ignore[method-assign]
        qdrant_client.upsert = Mock()  # type: ignore[method-assign]
        qdrant_client.create_payload_index = Mock()  # type: ignore[method-assign]
        with patch("campus_ingestion_core.process._is_local_qdrant_backend", return_value=False):
            ids = index_chunks_to_qdrant(
                chunks=chunks,
                qdrant_client=qdrant_client,
                collection_name=STUDENT_HANDBOOK_QDRANT_COLLECTION,
                sparse_embedding_model=build_sparse_embedding_model(SparseEmbeddingSettings()),
            )

        self.assertEqual(ids, (str(uuid.uuid5(uuid.NAMESPACE_URL, chunks[0].chunk_id)),))
        qdrant_client.create_collection.assert_called_once()
        create_kwargs = qdrant_client.create_collection.call_args.kwargs
        self.assertIn("dense", create_kwargs["vectors_config"])
        self.assertIn("sparse", create_kwargs["sparse_vectors_config"])
        qdrant_client.upsert.assert_called_once()
        point = qdrant_client.upsert.call_args.kwargs["points"][0]
        self.assertIn("dense", point.vector)
        self.assertIn("sparse", point.vector)
        self.assertIsInstance(point.vector["sparse"], qdrant_models.Document)
        self.assertEqual(point.vector["sparse"].model, "qdrant/bm25")
        indexed_fields = [
            call.kwargs["field_name"] for call in qdrant_client.create_payload_index.call_args_list
        ]
        self.assertEqual(
            indexed_fields,
            [
                "document_id",
                "revision_track",
                "version_id",
                "corpus",
                "collection",
                "canonical_course_id",
                "canonical_course_family_id",
                "canonical_program_family_id",
                "visibility_scope",
                "entitlement_groups",
                "visibility_level",
                "policy_projection_version",
                "status",
                "source_channel",
                "is_current",
            ],
        )
        indexed_schemas = {
            call.kwargs["field_name"]: call.kwargs["field_schema"]
            for call in qdrant_client.create_payload_index.call_args_list
        }
        self.assertTrue(
            all(
                indexed_schemas[field_name] == qdrant_models.PayloadSchemaType.KEYWORD
                for field_name in indexed_fields
                if field_name != "is_current"
            )
        )
        self.assertEqual(indexed_schemas["is_current"], qdrant_models.PayloadSchemaType.BOOL)

    def test_backend_rejects_query_disabled_corpus(self) -> None:
        backend = QdrantRetrievalBackend(
            settings=RetrievalSettings(
                qdrant_url=":memory:",
                document_registry_database_url="postgresql://registry.example/postgres",
            ),
            registry=InMemoryDocumentRegistry(),
            qdrant_client=QdrantClient(location=":memory:"),
            embedding_model=build_mock_embedding_model(MockEmbeddingSettings(embed_dim=8)),
        )

        with self.assertRaisesRegex(CorpusQueryDisabledError, "campus_services/service_catalog"):
            backend.retrieve(
                RetrievalRequest(
                    query_text="宿舍报修流程",
                    corpus="campus_services",
                    collection="service_catalog",
                )
            )

    def test_retrieval_settings_from_env_reads_registry_database_url(self) -> None:
        settings = RetrievalSettings.from_env(
            {
                "QDRANT_URL": ":memory:",
                "DOCUMENT_REGISTRY_DATABASE_URL": "postgresql://registry.example/postgres",
            }
        )

        self.assertEqual(settings.qdrant_url, ":memory:")
        self.assertEqual(
            settings.document_registry_database_url,
            "postgresql://registry.example/postgres",
        )
        self.assertEqual(settings.embedding_provider, "gitee")
        self.assertEqual(settings.embedding_model, "Qwen3-Embedding-4B")
        self.assertEqual(settings.embedding_dimensions, 2560)
        self.assertEqual(settings.sparse_provider, "qdrant")
        self.assertEqual(settings.sparse_model, "qdrant/bm25")
        self.assertEqual(settings.sparse_tokenizer, "multilingual")
        self.assertEqual(settings.sparse_language, "none")

    def test_retrieval_settings_from_env_falls_back_to_shared_postgres_url(self) -> None:
        settings = RetrievalSettings.from_env(
            {
                "QDRANT_URL": ":memory:",
                "CAMPUS_SHARED_POSTGRES_URL": "postgresql://shared.example/postgres",
            }
        )

        self.assertEqual(
            settings.document_registry_database_url, "postgresql://shared.example/postgres"
        )

    def test_retrieval_settings_from_env_requires_explicit_qdrant_url(self) -> None:
        with self.assertRaisesRegex(ValueError, "QDRANT_URL is required"):
            RetrievalSettings.from_env({})

    def test_retrieval_settings_from_env_no_longer_requires_qdrant_collection(self) -> None:
        settings = RetrievalSettings.from_env({"QDRANT_URL": ":memory:"})

        self.assertEqual(settings.qdrant_url, ":memory:")

    def test_retrieval_settings_default_qwen3_dimensions_to_native_width(self) -> None:
        settings = RetrievalSettings(
            qdrant_url=":memory:",
            document_registry_database_url="postgresql://registry.example/postgres",
        )

        self.assertEqual(settings.embedding_model, "Qwen3-Embedding-4B")
        self.assertEqual(settings.embedding_dimensions, 2560)
        self.assertEqual(settings.sparse_model, "qdrant/bm25")

    def test_sparse_embedding_settings_default_to_qdrant_bm25_for_handbook(self) -> None:
        settings = SparseEmbeddingSettings.from_env({})

        self.assertEqual(settings.provider, "qdrant")
        self.assertEqual(settings.model, "qdrant/bm25")
        self.assertEqual(settings.tokenizer, "multilingual")
        self.assertEqual(settings.language, "none")

    def test_build_hybrid_prefetch_uses_sparse_vector_query_for_native_hybrid(self) -> None:
        class _DenseEmbeddingModel:
            def get_query_embedding(self, query: str) -> list[float]:
                self.query = query
                return [0.1] * 8

        class _SparseEmbeddingModel:
            def __init__(self) -> None:
                self.query_calls: list[str] = []

            def build_document(
                self, text: str
            ) -> qdrant_models.Document | qdrant_models.SparseVector:
                raise AssertionError(
                    "document embedding should not be used during retrieval query prefetch"
                )

            def build_query(
                self, text: str
            ) -> qdrant_models.Document | qdrant_models.SparseVector | None:
                self.query_calls.append(text)
                return qdrant_models.Document(
                    text=text,
                    model="qdrant/bm25",
                    options=qdrant_models.Bm25Config(
                        tokenizer=qdrant_models.TokenizerType.MULTILINGUAL,
                        language="none",
                        lowercase=True,
                        ascii_folding=False,
                    ),
                )

        dense_embedding_model = _DenseEmbeddingModel()
        sparse_embedding_model = _SparseEmbeddingModel()
        profile = _make_runtime_profile(
            dense_prefetch_limit=11,
            sparse_prefetch_limit=13,
            embedding_query_instruction="Retrieve handbook passages about the requested office or schedule.",
        )

        prefetch = _build_hybrid_prefetch(
            request=RetrievalRequest(
                query_text="scholarship office hours",
                corpus="regulations",
                collection="student_rules",
                authorized_filter=_authorized_filter(),
                top_k=3,
            ),
            profile=profile,
            embedding_model=dense_embedding_model,
            sparse_embedding_model=sparse_embedding_model,
        )

        self.assertEqual(
            dense_embedding_model.query,
            (
                "Instruct: Retrieve handbook passages about the requested office or schedule.\n"
                "Query: scholarship office hours"
            ),
        )
        self.assertEqual(sparse_embedding_model.query_calls, ["scholarship office hours"])
        self.assertEqual(len(prefetch), 2)
        self.assertEqual(prefetch[0].using, "dense")
        self.assertEqual(prefetch[1].using, "sparse")
        self.assertEqual(prefetch[0].limit, 11)
        self.assertEqual(prefetch[1].limit, 13)
        self.assertIsInstance(prefetch[1].query, qdrant_models.Document)
        self.assertEqual(prefetch[1].query.model, "qdrant/bm25")
        self.assertEqual(prefetch[1].query.text, "scholarship office hours")
        dense_filter = prefetch[0].filter
        self.assertIsNotNone(dense_filter)
        dense_conditions = dense_filter.must or []
        self.assertTrue(
            any(
                getattr(condition, "key", None) == "status"
                and getattr(getattr(condition, "match", None), "value", None) == "active"
                for condition in dense_conditions
            )
        )
        self.assertTrue(
            any(
                getattr(condition, "key", None) == "is_current"
                and getattr(getattr(condition, "match", None), "value", None) is True
                for condition in dense_conditions
            )
        )
        self.assertTrue(
            any(
                getattr(condition, "key", None) == "revision_track"
                and getattr(getattr(condition, "match", None), "any", None)
                == ["current-effective", "source-faithful"]
                for condition in dense_conditions
            )
        )

    def test_build_rrf_query_uses_runtime_profile_weights(self) -> None:
        query = _build_rrf_query(
            _make_runtime_profile(
                rrf_k=37,
                rrf_dense_weight=1.6,
                rrf_sparse_weight=0.7,
            )
        )

        self.assertEqual(query.rrf.k, 37)
        self.assertEqual(query.rrf.weights, [1.6, 0.7])

    def test_backend_caches_dense_query_embedding_within_ttl(self) -> None:
        class _CountingDenseEmbeddingModel:
            def __init__(self) -> None:
                self.calls: list[str] = []

            def get_query_embedding(self, query: str) -> list[float]:
                self.calls.append(query)
                return [0.1] * 8

        registry = InMemoryDocumentRegistry()
        embedding_model = _CountingDenseEmbeddingModel()
        backend = QdrantRetrievalBackend(
            settings=RetrievalSettings(
                qdrant_url=":memory:",
                document_registry_database_url="postgresql://registry.example/postgres",
            ),
            registry=registry,
            qdrant_client=QdrantClient(location=":memory:"),
            embedding_model=embedding_model,
            sparse_embedding_model=build_mock_sparse_embedding_model(MockSparseEmbeddingSettings()),
        )
        backend.qdrant_client.collection_exists = Mock(return_value=True)  # type: ignore[method-assign]
        backend.qdrant_client.query_points = Mock(  # type: ignore[method-assign]
            return_value=qdrant_models.QueryResponse(points=[])
        )

        request = RetrievalRequest(
            query_text="library hours",
            corpus="regulations",
            collection="student_rules",
            authorized_filter=_authorized_filter(),
        )
        backend.retrieve(request)
        backend.retrieve(request)

        self.assertEqual(
            embedding_model.calls,
            [
                "Instruct: Given a campus policy or handbook question, retrieve relevant passages that answer "
                "the query.\nQuery: library hours"
            ],
        )

    def test_build_qdrant_client_uses_plain_remote_configuration(self) -> None:
        settings = RetrievalSettings(
            qdrant_url="https://example-cloud.qdrant.io",
            qdrant_api_key="secret",
        )
        fake_client = object()

        with patch(
            "campus_retrieval_core.backend_qdrant.QdrantClient", return_value=fake_client
        ) as client_ctor:
            result = _build_qdrant_client(settings)

        self.assertIs(result, fake_client)
        client_ctor.assert_called_once_with(
            url="https://example-cloud.qdrant.io",
            api_key="secret",
            timeout=settings.qdrant_timeout_seconds,
            cloud_inference=True,
            check_compatibility=False,
            trust_env=False,
        )

    def test_backend_uses_collection_exists_without_alias_listing_precheck(self) -> None:
        qdrant_client = Mock()
        qdrant_client.collection_exists = Mock(return_value=True)
        qdrant_client.get_aliases = Mock(
            side_effect=AssertionError("alias listing should not be called")
        )
        qdrant_client.query_points = Mock(return_value=qdrant_models.QueryResponse(points=[]))
        embedding_model = build_mock_embedding_model(MockEmbeddingSettings(embed_dim=8))
        backend = QdrantRetrievalBackend(
            settings=RetrievalSettings(
                qdrant_url=":memory:",
                document_registry_database_url="postgresql://registry.example/postgres",
            ),
            registry=InMemoryDocumentRegistry(),
            qdrant_client=qdrant_client,
            embedding_model=embedding_model,
            sparse_embedding_model=build_mock_sparse_embedding_model(MockSparseEmbeddingSettings()),
        )

        result = backend.retrieve(
            RetrievalRequest(
                query_text="学生证丢了怎么办",
                corpus="regulations",
                collection="student_rules",
                authorized_filter=_authorized_filter(),
                top_k=5,
            )
        )

        self.assertEqual(result.sources, ())
        qdrant_client.collection_exists.assert_called_once_with("student_rules")
        qdrant_client.query_points.assert_called_once()
        qdrant_client.get_aliases.assert_not_called()

    def test_backend_caches_positive_collection_existence_checks(self) -> None:
        qdrant_client = Mock()
        qdrant_client.collection_exists = Mock(return_value=True)
        qdrant_client.query_points = Mock(return_value=qdrant_models.QueryResponse(points=[]))
        embedding_model = build_mock_embedding_model(MockEmbeddingSettings(embed_dim=8))
        backend = QdrantRetrievalBackend(
            settings=RetrievalSettings(
                qdrant_url=":memory:",
                document_registry_database_url="postgresql://registry.example/postgres",
            ),
            registry=InMemoryDocumentRegistry(),
            qdrant_client=qdrant_client,
            embedding_model=embedding_model,
            sparse_embedding_model=build_mock_sparse_embedding_model(MockSparseEmbeddingSettings()),
        )
        request = RetrievalRequest(
            query_text="学生证丢了怎么办",
            corpus="regulations",
            collection="student_rules",
            authorized_filter=_authorized_filter(),
            top_k=5,
        )

        backend.retrieve(request)
        backend.retrieve(request)

        qdrant_client.collection_exists.assert_called_once_with("student_rules")
        self.assertEqual(qdrant_client.query_points.call_count, 2)

    def test_backend_retries_transient_collection_exists_failures(self) -> None:
        qdrant_client = Mock()
        qdrant_client.collection_exists = Mock(
            side_effect=[
                ResponseHandlingException(
                    RuntimeError("_ssl.c:983: The handshake operation timed out")
                ),
                ResponseHandlingException(
                    RuntimeError("_ssl.c:983: The handshake operation timed out")
                ),
                True,
            ]
        )
        qdrant_client.query_points = Mock(return_value=qdrant_models.QueryResponse(points=[]))
        embedding_model = build_mock_embedding_model(MockEmbeddingSettings(embed_dim=8))
        backend = QdrantRetrievalBackend(
            settings=RetrievalSettings(
                qdrant_url=":memory:",
                document_registry_database_url="postgresql://registry.example/postgres",
            ),
            registry=InMemoryDocumentRegistry(),
            qdrant_client=qdrant_client,
            embedding_model=embedding_model,
            sparse_embedding_model=build_mock_sparse_embedding_model(MockSparseEmbeddingSettings()),
        )

        result = backend.retrieve(
            RetrievalRequest(
                query_text="学生证丢了怎么办",
                corpus="regulations",
                collection="student_rules",
                authorized_filter=_authorized_filter(),
                top_k=5,
            )
        )

        self.assertEqual(result.sources, ())
        self.assertEqual(qdrant_client.collection_exists.call_count, 3)
        qdrant_client.query_points.assert_called_once()

    def test_backend_retries_transient_query_points_failures(self) -> None:
        qdrant_client = Mock()
        qdrant_client.collection_exists = Mock(return_value=True)
        qdrant_client.query_points = Mock(
            side_effect=[
                ResponseHandlingException(
                    RuntimeError("_ssl.c:983: The handshake operation timed out")
                ),
                ResponseHandlingException(
                    RuntimeError("_ssl.c:983: The handshake operation timed out")
                ),
                qdrant_models.QueryResponse(points=[]),
            ]
        )
        embedding_model = build_mock_embedding_model(MockEmbeddingSettings(embed_dim=8))
        backend = QdrantRetrievalBackend(
            settings=RetrievalSettings(
                qdrant_url=":memory:",
                document_registry_database_url="postgresql://registry.example/postgres",
            ),
            registry=InMemoryDocumentRegistry(),
            qdrant_client=qdrant_client,
            embedding_model=embedding_model,
            sparse_embedding_model=build_mock_sparse_embedding_model(MockSparseEmbeddingSettings()),
        )

        result = backend.retrieve(
            RetrievalRequest(
                query_text="学生证丢了怎么办",
                corpus="regulations",
                collection="student_rules",
                authorized_filter=_authorized_filter(),
                top_k=5,
            )
        )

        self.assertEqual(result.sources, ())
        self.assertEqual(qdrant_client.query_points.call_count, 3)

    def test_backend_raises_when_transient_query_points_failures_exhaust_retries(self) -> None:
        qdrant_client = Mock()
        qdrant_client.collection_exists = Mock(return_value=True)
        qdrant_client.query_points = Mock(
            side_effect=[
                ResponseHandlingException(
                    RuntimeError("_ssl.c:983: The handshake operation timed out")
                ),
                ResponseHandlingException(
                    RuntimeError("_ssl.c:983: The handshake operation timed out")
                ),
                ResponseHandlingException(
                    RuntimeError("_ssl.c:983: The handshake operation timed out")
                ),
            ]
        )
        embedding_model = build_mock_embedding_model(MockEmbeddingSettings(embed_dim=8))
        backend = QdrantRetrievalBackend(
            settings=RetrievalSettings(
                qdrant_url=":memory:",
                document_registry_database_url="postgresql://registry.example/postgres",
            ),
            registry=InMemoryDocumentRegistry(),
            qdrant_client=qdrant_client,
            embedding_model=embedding_model,
            sparse_embedding_model=build_mock_sparse_embedding_model(MockSparseEmbeddingSettings()),
        )

        with self.assertRaises(RetrievalBackendError):
            backend.retrieve(
                RetrievalRequest(
                    query_text="学生证丢了怎么办",
                    corpus="regulations",
                    collection="student_rules",
                    authorized_filter=_authorized_filter(),
                    top_k=5,
                )
            )

        self.assertEqual(qdrant_client.query_points.call_count, 3)

    def test_backend_builds_registry_from_database_url_when_not_injected(self) -> None:
        with patch(
            "campus_retrieval_core.backend_qdrant.build_document_registry_from_env"
        ) as builder:
            builder.return_value = InMemoryDocumentRegistry()

            backend = QdrantRetrievalBackend(
                settings=RetrievalSettings(
                    qdrant_url=":memory:",
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
